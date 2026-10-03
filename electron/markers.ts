// Finds intros and end credits by comparing an episode's audio with its neighbours'.
// The same theme music in two episodes gives the same Chromaprint fingerprint, so a long stretch
// of matching fingerprints near the start is the intro and one near the end is the credits.
import { execFile } from 'node:child_process'
import type { DB } from './db'

const STEP = 4096 / 3 / 11025 // seconds per fingerprint item (Chromaprint's default algorithm)
const HEAD = 360 // look for intros in the first 6 minutes
const TAIL = 420 // and for credits in the last 7
const MIN_INTRO = 12
const MAX_INTRO = 150
const MIN_CREDITS = 20

export interface Markers {
  intro?: [number, number]
  credits?: number
}

type Print = Uint32Array

function fingerprint(ffmpeg: string, file: string, from: number, length: number) {
  return new Promise<Print>((resolve, reject) => {
    const args = ['-hide_banner', '-v', 'error', '-ss', from.toFixed(2), '-t', String(length), '-i', file, '-vn', '-ac', '1', '-f', 'chromaprint', '-fp_format', 'raw', '-']
    execFile(ffmpeg, args, { encoding: 'buffer', maxBuffer: 1 << 24, windowsHide: true, timeout: 120000 }, (err, out) => {
      if (err) return reject(err)
      const b = Buffer.from(out)
      resolve(new Uint32Array(b.buffer, b.byteOffset, b.length >> 2))
    })
  })
}

const bits = (x: number) => {
  x -= (x >>> 1) & 0x55555555
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return (((x + (x >>> 4)) & 0xf0f0f0f) * 0x1010101) >>> 24
}

/** Longest stretch where a and b match at some shift, as seconds into each. Short dropouts are bridged. */
export function longestMatch(a: Print, b: Print, minSeconds: number) {
  const maxGap = Math.round(3.5 / STEP)
  const minLen = Math.round(minSeconds / STEP)
  let best: { len: number; a: number; b: number } | null = null
  // ponytail: tries every shift, O(n*m); fine for a few thousand items per side
  for (let shift = -(b.length - 1); shift < a.length; shift++) {
    const lo = Math.max(0, shift)
    const hi = Math.min(a.length, b.length + shift)
    if (hi - lo < minLen) continue
    let start = -1
    let last = -1
    for (let i = lo; i <= hi; i++) {
      if (i < hi && bits(a[i] ^ b[i - shift]) <= 6) {
        if (start < 0) start = i
        last = i
      } else if (start >= 0 && (i === hi || i - last > maxGap)) {
        const len = last - start
        if (len >= minLen && (!best || len > best.len)) best = { len, a: start, b: start - shift }
        start = -1
      }
    }
  }
  return best && { a: best.a * STEP, b: best.b * STEP, len: best.len * STEP }
}

interface Ep {
  path: string
  duration: number
}

export class MarkerFinder {
  private prints = new Map<string, Promise<Print>>()
  private running = new Map<string, Promise<Markers>>()

  constructor(
    private db: DB,
    private ffmpeg: () => string,
    private log: (m: string) => void,
  ) {}

  private print(ep: Ep, part: 'head' | 'tail') {
    const key = `${part}|${ep.path}`
    let p = this.prints.get(key)
    if (!p) {
      const head = Math.min(HEAD, ep.duration * 0.4)
      const tail = Math.min(TAIL, ep.duration * 0.4)
      p = fingerprint(this.ffmpeg(), ep.path, part === 'head' ? 0 : Math.max(0, ep.duration - tail), part === 'head' ? head : tail)
      p.catch(() => this.prints.delete(key))
      if (this.prints.size > 40) this.prints.delete(this.prints.keys().next().value!)
      this.prints.set(key, p)
    }
    return p
  }

  saved(file: string): Markers | null {
    const r = this.db.prepare('SELECT intro_start, intro_end, credits FROM markers WHERE path = ?').get(file) as
      | { intro_start: number | null; intro_end: number | null; credits: number | null }
      | undefined
    if (!r) return null
    return {
      intro: r.intro_start !== null && r.intro_end !== null ? [r.intro_start, r.intro_end] : undefined,
      credits: r.credits ?? undefined,
    }
  }

  /** Markers for `ep`, worked out from the episodes either side of it (same show, in order). */
  find(ep: Ep, neighbours: Ep[]): Promise<Markers> {
    const done = this.saved(ep.path)
    if (done) return Promise.resolve(done)
    let job = this.running.get(ep.path)
    if (!job) {
      job = this.work(ep, neighbours).finally(() => this.running.delete(ep.path))
      this.running.set(ep.path, job)
    }
    return job
  }

  private async work(ep: Ep, neighbours: Ep[]): Promise<Markers> {
    if (!neighbours.length) return {}
    try {
      const intros: [number, number][] = []
      const credits: number[] = []
      const head = await this.print(ep, 'head')
      const tail = await this.print(ep, 'tail')
      const tailStart = Math.max(0, ep.duration - Math.min(TAIL, ep.duration * 0.4))
      for (const n of neighbours) {
        const m = longestMatch(head, await this.print(n, 'head'), MIN_INTRO)
        if (m && m.len <= MAX_INTRO) intros.push([m.a, m.a + m.len])
        const c = longestMatch(tail, await this.print(n, 'tail'), MIN_CREDITS)
        if (c) credits.push(tailStart + c.a)
      }
      // with two neighbours, keep only what both agree on, so a recap of last week's episode isn't taken for the intro
      let intro: [number, number] | undefined
      if (intros.length === 1 && neighbours.length === 1) intro = intros[0]
      else if (intros.length === 2) {
        const s = Math.max(intros[0][0], intros[1][0])
        const e = Math.min(intros[0][1], intros[1][1])
        if (e - s >= MIN_INTRO) intro = [s, e]
      }
      const out: Markers = { intro, credits: credits.length ? Math.min(...credits) : undefined }
      this.db
        .prepare('INSERT OR REPLACE INTO markers (path, intro_start, intro_end, credits, checked) VALUES (?, ?, ?, ?, ?)')
        .run(ep.path, intro?.[0] ?? null, intro?.[1] ?? null, out.credits ?? null, Date.now())
      return out
    } catch (e) {
      this.log(`markers failed for ${ep.path}: ${(e as Error).message}`)
      return {}
    }
  }
}
