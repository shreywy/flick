// ffprobe wrappers and the choice between direct play, remux and audio conversion.
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import type { PlayMode, Track } from '../shared/types'

const run = promisify(execFile)

export interface ProbeStream {
  index: number
  codec_type: 'video' | 'audio' | 'subtitle' | 'attachment' | 'data'
  codec_name?: string
  profile?: string
  width?: number
  height?: number
  channels?: number
  pix_fmt?: string
  level?: number
  tags?: { language?: string; title?: string; filename?: string; mimetype?: string }
  disposition?: { default?: number; forced?: number; attached_pic?: number }
}

export interface Probe {
  format: { duration?: string; size?: string; format_name?: string; bit_rate?: string }
  streams: ProbeStream[]
}

export async function probe(ffprobe: string, file: string): Promise<Probe> {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], {
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  })
  return JSON.parse(stdout) as Probe
}

/** Time of the last video keyframe at or before t. Reads only a short window, so it's quick. */
export async function keyframeBefore(ffprobe: string, file: string, t: number): Promise<number> {
  if (t <= 0.5) return 0
  for (const back of [20, 90, 400]) {
    const from = Math.max(0, t - back)
    const { stdout } = await run(
      ffprobe,
      ['-v', 'error', '-read_intervals', `${from.toFixed(3)}%${(t + 0.05).toFixed(3)}`, '-select_streams', 'v:0', '-skip_frame', 'nokey',
        '-show_entries', 'frame=pts_time,best_effort_timestamp_time', '-of', 'csv=p=0', file],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    )
    const times = stdout
      .split(/\r?\n/)
      .map((l) => l.split(',').map(Number).find((n) => Number.isFinite(n)))
      .filter((n): n is number => n !== undefined && n <= t + 0.001)
    if (times.length) return Math.max(...times)
    if (from === 0) return 0
  }
  return 0
}

const VIDEO_OK = new Set(['h264', 'hevc', 'av1', 'vp9', 'vp8'])
const AUDIO_OK = new Set(['aac', 'mp3', 'opus', 'flac'])
const DIRECT_EXT = new Set(['.mp4', '.m4v', '.webm', '.mov'])
// Chromium decodes stereo Opus in MP4 but not reliably 5.1, so multichannel Opus gets converted
const audioOk = (a?: ProbeStream) => !!a && AUDIO_OK.has(a.codec_name ?? '') && !(a.codec_name === 'opus' && (a.channels ?? 2) > 2)
const TEXT_SUBS = new Set(['subrip', 'mov_text', 'webvtt', 'text', 'srt'])
const ASS_SUBS = new Set(['ass', 'ssa'])

export const videoStream = (p: Probe) => p.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
export const audioStreams = (p: Probe) => p.streams.filter((s) => s.codec_type === 'audio')
export const subStreams = (p: Probe) => p.streams.filter((s) => s.codec_type === 'subtitle')

export function subFormat(codec?: string): 'text' | 'ass' | 'image' {
  if (codec && ASS_SUBS.has(codec)) return 'ass'
  if (codec && TEXT_SUBS.has(codec)) return 'text'
  return 'image'
}

export interface PlayPlan {
  mode: PlayMode
  videoTranscode: boolean
  audioNeedsConvert: boolean[]
  defaultAudio: number
}

export function choosePlan(file: string, p: Probe): PlayPlan {
  const v = videoStream(p)
  const audio = audioStreams(p)
  const audioNeedsConvert = audio.map((a) => !audioOk(a))
  const englishFirst = audio.findIndex((a) => /^en/.test(a.tags?.language ?? ''))
  const flagged = audio.findIndex((a) => a.disposition?.default)
  const defaultAudio = Math.max(0, flagged >= 0 ? flagged : englishFirst)
  const videoTranscode = !!v && !VIDEO_OK.has(v.codec_name ?? '')
  let mode: PlayMode
  if (!videoTranscode && DIRECT_EXT.has(path.extname(file).toLowerCase()) && defaultAudio === 0 && !audioNeedsConvert[0]) mode = 'direct'
  else if (videoTranscode || audioNeedsConvert[defaultAudio]) mode = 'convert'
  else mode = 'remux'
  return { mode, videoTranscode, audioNeedsConvert, defaultAudio }
}

/** ffmpeg arguments for a fragmented MP4 stream starting at a keyframe. */
export function streamArgs(file: string, start: number, audioIdx: number, p: Probe, encoder: string) {
  const v = videoStream(p)
  const a = audioStreams(p)[audioIdx]
  const args = ['-hide_banner', '-loglevel', 'error']
  if (start > 0) args.push('-ss', start.toFixed(3))
  args.push('-i', file, '-map', '0:v:0')
  if (a) args.push('-map', `0:a:${audioIdx}`)
  if (v && !VIDEO_OK.has(v.codec_name ?? '')) {
    args.push('-c:v', encoder, ...(encoder === 'h264_nvenc' ? ['-preset', 'p4', '-cq', '21'] : ['-preset', 'veryfast', '-crf', '20']), '-pix_fmt', 'yuv420p')
  } else {
    args.push('-c:v', 'copy')
    if (v?.codec_name === 'hevc') args.push('-tag:v', 'hvc1')
  }
  if (a) {
    if (audioOk(a)) args.push('-c:a', 'copy')
    else {
      const ch = Math.min(a.channels ?? 2, 6)
      args.push('-c:a', 'aac', '-ac', String(ch), '-b:a', ch > 2 ? '384k' : '192k')
    }
  }
  args.push('-sn', '-dn', '-max_muxing_queue_size', '4096', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1')
  return args
}

const LANG_NAMES: Record<string, string> = {
  eng: 'English', en: 'English', jpn: 'Japanese', ja: 'Japanese', spa: 'Spanish', fre: 'French', fra: 'French', ger: 'German', deu: 'German',
  ita: 'Italian', por: 'Portuguese', kor: 'Korean', chi: 'Chinese', zho: 'Chinese', rus: 'Russian', ara: 'Arabic', hin: 'Hindi',
}
export const langName = (code?: string) => (code ? LANG_NAMES[code.toLowerCase()] ?? code.toUpperCase() : undefined)

export function audioTracks(p: Probe): Track[] {
  return audioStreams(p).map((s, i) => ({
    index: i,
    codec: s.codec_name ?? '?',
    language: s.tags?.language,
    title: s.tags?.title,
    channels: s.channels,
    default: !!s.disposition?.default,
  }))
}

const CODEC_LABEL: Record<string, string> = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9', aac: 'AAC', ac3: 'Dolby Digital', eac3: 'Dolby Digital+', dts: 'DTS', truehd: 'TrueHD', opus: 'Opus', flac: 'FLAC', mp3: 'MP3' }
export const codecLabel = (c?: string) => (c ? CODEC_LABEL[c] ?? c.toUpperCase() : '?')
export const channelLabel = (n?: number) => (n === 6 ? '5.1' : n === 8 ? '7.1' : n === 2 ? 'stereo' : n === 1 ? 'mono' : n ? `${n}ch` : '')

/** "1080p · H.264 · DTS 5.1 · 3.0 GB" */
export function details(p: Probe) {
  const v = videoStream(p)
  const a = audioStreams(p)[0]
  const h = v?.height ?? 0
  const w = v?.width ?? 0
  const res = w >= 3200 || h >= 2000 ? '4K' : w >= 1800 || h >= 1000 ? '1080p' : w >= 1200 || h >= 700 ? '720p' : h ? `${h}p` : ''
  const hdr = /10/.test(v?.pix_fmt ?? '') ? ' 10-bit' : ''
  const size = Number(p.format.size ?? 0)
  return [res, v ? codecLabel(v.codec_name) + hdr : '', a ? `${codecLabel(a.codec_name)} ${channelLabel(a.channels)}`.trim() : '', size ? `${(size / 1e9).toFixed(1)} GB` : '']
    .filter(Boolean)
    .join(' · ')
}

export interface Crop {
  w: number
  h: number
  x: number
  y: number
}

/** Finds black bars burned into the picture by sampling three spots. Null when there are none. */
export async function detectCrop(ffmpeg: string, file: string, p: Probe): Promise<Crop | null> {
  const v = videoStream(p)
  const duration = Number(p.format.duration ?? 0)
  if (!v?.width || !v.height || !duration) return null
  const outs = await Promise.all(
    [0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.82].map((f) =>
      run(ffmpeg, ['-hide_banner', '-ss', (duration * f).toFixed(1), '-i', file, '-frames:v', '48', '-an', '-sn', '-vf', 'cropdetect=limit=24:round=2:reset=0', '-f', 'null', '-'], {
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      })
        .then((r) => r.stderr)
        .catch((e: { stderr?: string }) => e.stderr ?? ''),
    ),
  )
  // the most letterboxed shape that shows up at least twice wins: one dark scene can't trigger it,
  // but a film that switches between IMAX and letterbox still fills a wide screen
  const votes = new Map<string, { c: Crop; n: number }>()
  for (const out of outs) {
    const m = [...out.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].pop()
    if (!m) continue
    const c = { w: Number(m[1]), h: Number(m[2]), x: Number(m[3]), y: Number(m[4]) }
    if (c.w * c.h < v.width * v.height * 0.3) continue // a dark scene, not a real edge
    const key = `${Math.round(c.w / 16)}x${Math.round(c.h / 16)}`
    const hit = votes.get(key)
    if (hit) hit.n++
    else votes.set(key, { c, n: 1 })
  }
  const seen = [...votes.values()]
  const best = (seen.filter((x) => x.n >= 2).sort((a, b) => a.c.h / a.c.w - b.c.h / b.c.w)[0] ?? seen.sort((a, b) => b.n - a.n)[0])?.c
  if (!best || (best.w >= v.width * 0.98 && best.h >= v.height * 0.98)) return null
  return best
}

/** MSE type string for the stream we'll send, e.g. video/mp4; codecs="avc1.640029,mp4a.40.2". */
export function streamMime(p: Probe, audioIdx: number) {
  const v = videoStream(p)
  const a = audioStreams(p)[audioIdx]
  let vc = 'avc1.640033' // also what we encode to when the video isn't playable as is
  if (v && VIDEO_OK.has(v.codec_name ?? '')) {
    const ten = /10/.test(v.pix_fmt ?? '') || /10/.test(v.profile ?? '')
    if (v.codec_name === 'h264') {
      const prof: Record<string, string> = { Baseline: '42', 'Constrained Baseline': '42', Main: '4d', High: '64', 'High 10': '6e' }
      const level = v.level && v.level > 0 ? v.level : 51
      vc = `avc1.${prof[v.profile ?? ''] ?? '64'}00${level.toString(16).padStart(2, '0')}`
    } else if (v.codec_name === 'hevc') vc = `hvc1.${ten ? '2.4' : '1.6'}.L${v.level && v.level > 0 ? v.level : 153}.B0`
    else if (v.codec_name === 'av1') vc = `av01.0.${String(Math.min(31, Math.max(0, v.level ?? 8))).padStart(2, '0')}M.${ten ? '10' : '08'}`
    else if (v.codec_name === 'vp9') vc = `vp09.00.40.${ten ? '10' : '08'}`
    else vc = 'vp8'
  }
  const AC: Record<string, string> = { aac: 'mp4a.40.2', mp3: 'mp4a.40.34', opus: 'opus', flac: 'flac' }
  const ac = a ? (audioOk(a) ? AC[a.codec_name ?? ''] : 'mp4a.40.2') : ''
  return `video/mp4; codecs="${[vc, ac].filter(Boolean).join(',')}"`
}
