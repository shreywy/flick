// English subtitle search and download from OpenSubtitles.com and SubDL.
import fs from 'node:fs'
import path from 'node:path'
import { unzipSync } from 'fflate'

export interface SubQuery {
  kind: 'movie' | 'episode'
  tmdbId?: number // movie id, or the show id for episodes
  title: string
  year?: number
  season?: number
  episode?: number
  hash?: string
  fileName: string
  query?: string // typed by the user in Find more subtitles
}

export interface SubCandidate {
  provider: 'opensubtitles' | 'subdl'
  id: string
  release: string
  hearingImpaired: boolean
  sameRelease: boolean
  downloads: number
}

export interface Quota {
  remaining: number
  resetAt?: string
}

export class QuotaError extends Error {
  constructor(public resetAt?: string) {
    super('Subtitle download limit reached for today')
  }
}

const UA = 'Flick v0.1.0'

/** OpenSubtitles hash: file size plus the 64-bit little-endian sum of the first and last 64 KB. */
export function openSubtitlesHash(file: string) {
  const chunk = 65536
  const size = fs.statSync(file).size
  if (size < chunk * 2) return undefined
  const fd = fs.openSync(file, 'r')
  try {
    let sum = BigInt(size)
    const buf = Buffer.alloc(chunk)
    for (const pos of [0, size - chunk]) {
      fs.readSync(fd, buf, 0, chunk, pos)
      for (let i = 0; i < chunk; i += 8) sum += buf.readBigUInt64LE(i)
    }
    return (sum & 0xffffffffffffffffn).toString(16).padStart(16, '0')
  } finally {
    fs.closeSync(fd)
  }
}

export class OpenSubtitles {
  private token?: string
  private base = 'https://api.opensubtitles.com/api/v1'
  quota?: Quota
  constructor(private key: string, private user?: string, private pass?: string) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Api-Key': this.key, 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' }
    if (this.token) h.Authorization = `Bearer ${this.token}`
    return h
  }

  private async login() {
    if (this.token || !this.user || !this.pass) return
    const res = await fetch(`${this.base}/login`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ username: this.user, password: this.pass }),
      signal: AbortSignal.timeout(20000),
    })
    if (res.ok) {
      const j = (await res.json()) as { token: string; base_url?: string }
      this.token = j.token
      if (j.base_url) this.base = `https://${j.base_url}/api/v1`
    }
  }

  async search(q: SubQuery): Promise<SubCandidate[]> {
    const p: Record<string, string> = { languages: 'en' }
    if (q.query) p.query = q.query
    else {
      if (q.hash) p.moviehash = q.hash
      if (q.kind === 'movie') {
        if (q.tmdbId) p.tmdb_id = String(q.tmdbId)
        else p.query = q.title
        if (q.year) p.year = String(q.year)
      } else {
        if (q.tmdbId) p.parent_tmdb_id = String(q.tmdbId)
        else p.query = q.title
        p.season_number = String(q.season)
        p.episode_number = String(q.episode)
      }
    }
    // the API wants parameters sorted and lower case to avoid a redirect
    const qs = Object.keys(p)
      .sort()
      .map((k) => `${k}=${encodeURIComponent(p[k].toLowerCase())}`)
      .join('&')
    const res = await fetch(`${this.base}/subtitles?${qs}`, { headers: this.headers(), signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`OpenSubtitles search failed (${res.status})`)
    type R = { data: { attributes: { release: string; hearing_impaired: boolean; moviehash_match?: boolean; download_count: number; language: string; files: { file_id: number }[] } }[] }
    const j = (await res.json()) as R
    return j.data
      .filter((d) => d.attributes.language === 'en' && d.attributes.files.length)
      .map((d) => ({
        provider: 'opensubtitles' as const,
        id: String(d.attributes.files[0].file_id),
        release: d.attributes.release,
        hearingImpaired: d.attributes.hearing_impaired,
        sameRelease: !!d.attributes.moviehash_match,
        downloads: d.attributes.download_count,
      }))
  }

  async download(c: SubCandidate): Promise<Buffer> {
    await this.login()
    const res = await fetch(`${this.base}/download`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ file_id: Number(c.id) }),
      signal: AbortSignal.timeout(20000),
    })
    const j = (await res.json().catch(() => ({}))) as { link?: string; remaining?: number; reset_time_utc?: string; message?: string }
    if (j.remaining !== undefined) this.quota = { remaining: j.remaining, resetAt: j.reset_time_utc }
    if (res.status === 406 || (!res.ok && /quota|limit/i.test(j.message ?? ''))) throw new QuotaError(j.reset_time_utc)
    if (!res.ok || !j.link) throw new Error(`OpenSubtitles download failed (${res.status})`)
    const file = await fetch(j.link, { signal: AbortSignal.timeout(30000) })
    return Buffer.from(await file.arrayBuffer())
  }
}

export class SubDL {
  constructor(private key: string) {}

  async search(q: SubQuery): Promise<SubCandidate[]> {
    const u = new URL('https://api.subdl.com/api/v1/subtitles')
    u.searchParams.set('api_key', this.key)
    u.searchParams.set('languages', 'EN')
    u.searchParams.set('subs_per_page', '30')
    u.searchParams.set('type', q.kind === 'movie' ? 'movie' : 'tv')
    if (q.query) u.searchParams.set('film_name', q.query)
    else if (q.tmdbId) u.searchParams.set('tmdb_id', String(q.tmdbId))
    else u.searchParams.set('film_name', q.title)
    if (!q.query && q.year && q.kind === 'movie') u.searchParams.set('year', String(q.year))
    if (q.kind === 'episode') {
      u.searchParams.set('season_number', String(q.season))
      u.searchParams.set('episode_number', String(q.episode))
    }
    const res = await fetch(u, { signal: AbortSignal.timeout(20000) })
    const j = (await res.json().catch(() => ({}))) as { status?: boolean; error?: string; subtitles?: { release_name: string; url: string; hi?: boolean; lang?: string }[] }
    if (!res.ok && !j.subtitles) throw new Error(`SubDL search failed (${res.status})`)
    return (j.subtitles ?? []).map((s) => ({
      provider: 'subdl' as const,
      id: s.url,
      release: s.release_name,
      hearingImpaired: !!s.hi,
      sameRelease: false,
      downloads: 0,
    }))
  }

  async download(c: SubCandidate): Promise<Buffer> {
    const res = await fetch(`https://dl.subdl.com${c.id}`, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) throw new Error(`SubDL download failed (${res.status})`)
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
    const name = Object.keys(files).find((n) => /\.(srt|ass|ssa|vtt)$/i.test(n))
    if (!name) throw new Error('SubDL zip had no subtitle file')
    return Buffer.from(files[name])
  }
}

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/\.[a-z0-9]{2,4}$/, '')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1),
  )

/** Same release first, then names closest to the video file, then non-SDH, then popular. */
export function rank(cands: SubCandidate[], fileName: string) {
  const ft = tokens(fileName)
  const score = (c: SubCandidate) => {
    const rt = tokens(c.release)
    let common = 0
    for (const t of rt) if (ft.has(t)) common++
    const sim = rt.size ? common / Math.max(rt.size, ft.size) : 0
    return (c.sameRelease ? 10 : 0) + sim * 3 - (c.hearingImpaired ? 0.5 : 0) + Math.log10(1 + c.downloads) * 0.1
  }
  return [...cands].sort((a, b) => score(b) - score(a))
}

/** Text as UTF-8, whatever the subtitle was encoded in. */
export function decodeSub(buf: Buffer) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

/** Save next to the video as "<stem>.eng[.sdh][.N].srt" and return the path. */
export function saveSub(video: string, text: string, ext: string, hi: boolean) {
  const stem = video.slice(0, -path.extname(video).length)
  const base = `${stem}.eng${hi ? '.sdh' : ''}`
  let p = `${base}${ext}`
  for (let n = 2; fs.existsSync(p); n++) p = `${base}.${n}${ext}`
  fs.writeFileSync(p, text, 'utf8')
  return p
}

export function guessExt(text: string) {
  if (/^\s*\[Script Info\]/i.test(text)) return '.ass'
  if (/^\s*WEBVTT/.test(text)) return '.vtt'
  return '.srt'
}
