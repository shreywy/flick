// Reading release names and choosing where files go.
// Rules ported from kodi-media/organize.py.
import path from 'node:path'
import { filenameParse as rawParse } from '@ctrl/video-filename-parser'

interface Parsed {
  title: string
  year: string | null
  seasons?: number[]
  episodeNumbers?: number[]
}
const filenameParse = (name: string, tv: boolean) => rawParse(name, tv) as unknown as Parsed

export const VIDEO_EXT = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.ts', '.m2ts', '.webm', '.mpg', '.mpeg'])
export const SUB_EXT = new Set(['.srt', '.ass', '.ssa', '.sub', '.idx', '.smi', '.vtt', '.sup'])
export const PARTIAL_EXT = new Set(['.!qb', '.part', '.parts', '.crdownload', '.tmp'])
export const SAMPLE_MAX = 300 * 1024 * 1024

export const isVideo = (f: string) => VIDEO_EXT.has(path.extname(f).toLowerCase())
export const isSub = (f: string) => SUB_EXT.has(path.extname(f).toLowerCase())
export const isSample = (f: string, size: number) => /sample/i.test(path.basename(f)) && size < SAMPLE_MAX

/** Make a string safe for a Windows file name. */
export function clean(name: string) {
  return name
    .replace(/\s*-\.\s*/g, ' - ')
    .replace(/:/g, ' -')
    .replace(/[/\\]/g, '-')
    .replace(/[<>"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, '')
}

export type Guess =
  | { kind: 'movie'; title: string; year?: number }
  | { kind: 'episode'; title: string; year?: number; season: number; episodes: number[] }

function stripExt(name: string) {
  return isVideo(name) || isSub(name) ? name.slice(0, -path.extname(name).length) : name
}

/** Guess what a file is from its name, using the parent folder when the file name says too little. */
export function guess(file: string, parentName?: string): Guess | null {
  const base = stripExt(path.basename(file))
  const marker = /(^|[^a-z0-9])(s\d{1,2}[ ._-]?e\d{1,3}([ ._-]?e\d{1,3})*|\d{1,2}x\d{2,3}|s\d{1,2})([^a-z0-9]|$)/i.test(base)
  const tv = filenameParse(base, true)
  if (marker && tv.seasons?.length && tv.episodeNumbers?.length && tv.title) {
    let title = tv.title
    if (/^(s\d+e\d+|e?\d+)$/i.test(title.trim()) && parentName) title = filenameParse(parentName, true).title || title
    return {
      kind: 'episode',
      title: clean(title),
      year: tv.year ? Number(tv.year) : undefined,
      season: tv.seasons[0],
      episodes: tv.episodeNumbers,
    }
  }
  if (parentName) {
    const p = filenameParse(stripExt(parentName), true)
    const ep = filenameParse(base, true)
    // "Show.S01.1080p/03.mkv" style season packs
    if (p.seasons?.length && p.title && !ep.title && /\d/.test(base)) {
      const m = base.match(/(?:^|\D)(\d{1,3})(?:\D|$)/)
      if (m) return { kind: 'episode', title: clean(p.title), season: p.seasons[0], episodes: [Number(m[1])] }
    }
  }
  let mv = filenameParse(base, false)
  if ((!mv.year || !mv.title) && parentName) {
    const pm = filenameParse(stripExt(parentName), false)
    if (pm.title && pm.year) mv = pm
  }
  if (!mv.title) return null
  return { kind: 'movie', title: clean(mv.title), year: mv.year ? Number(mv.year) : undefined }
}

export const movieName = (g: { title: string; year?: number }) => (g.year ? `${g.title} (${g.year})` : g.title)

export const episodeTag = (season: number, episodes: number[]) =>
  `S${String(season).padStart(2, '0')}` + episodes.map((e) => `E${String(e).padStart(2, '0')}`).join('')

const LANGS: Record<string, string> = {
  english: 'eng', eng: 'eng', en: 'eng',
  spanish: 'spa', spa: 'spa', es: 'spa', esp: 'spa',
  french: 'fre', fre: 'fre', fra: 'fre', fr: 'fre',
  german: 'ger', ger: 'ger', deu: 'ger', de: 'ger',
  portuguese: 'por', por: 'por', pt: 'por', brazilian: 'por',
  italian: 'ita', ita: 'ita', it: 'ita',
  japanese: 'jpn', jpn: 'jpn', ja: 'jpn',
  korean: 'kor', kor: 'kor', ko: 'kor',
  chinese: 'chi', chi: 'chi', zho: 'chi', zh: 'chi',
  russian: 'rus', rus: 'rus', ru: 'rus',
  arabic: 'ara', ara: 'ara', ar: 'ara',
  dutch: 'dut', dut: 'dut', nld: 'dut', nl: 'dut',
  swedish: 'swe', swe: 'swe', sv: 'swe',
  norwegian: 'nor', nor: 'nor', no: 'nor',
  danish: 'dan', dan: 'dan', da: 'dan',
  finnish: 'fin', fin: 'fin', fi: 'fin',
  polish: 'pol', pol: 'pol', pl: 'pol',
  turkish: 'tur', tur: 'tur', tr: 'tur',
  hindi: 'hin', hin: 'hin', hi: 'hin',
  indonesian: 'ind', ind: 'ind', id: 'ind',
  malay: 'may', may: 'may', msa: 'may',
  thai: 'tha', tha: 'tha', th: 'tha',
  vietnamese: 'vie', vie: 'vie', vi: 'vie',
}

/** 'English(SDH).srt' -> '.eng.sdh', 'Movie.fre.forced.srt' -> '.fre.forced', '2_English.srt' -> '.eng' */
export function subSuffix(subFile: string) {
  const stem = stripExt(path.basename(subFile)).toLowerCase().replace(/^\d+_/, '')
  const words = stem.split(/[\s._()[\]-]+/).filter(Boolean)
  let lang: string | undefined
  for (const w of [...words].reverse()) {
    if (LANGS[w] && !(w.length === 2 && words.length > 3 && words.indexOf(w) < words.length - 3)) {
      lang = LANGS[w]
      break
    }
  }
  const parts = lang ? [lang] : []
  for (const flag of ['sdh', 'forced', 'cc']) if (words.includes(flag)) parts.push(flag)
  return parts.map((p) => '.' + p).join('')
}

/** Language code from a sidecar subtitle next to a video: "Movie (2015).eng.sdh.srt" -> eng */
export function sidecarLang(videoStem: string, subFile: string) {
  const rest = stripExt(path.basename(subFile)).slice(videoStem.length).toLowerCase()
  const first = rest.split('.').filter(Boolean)[0]
  return first ? LANGS[first] ?? first : undefined
}
