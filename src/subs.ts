import type { SubStyle } from '../shared/types'

export interface Cue {
  start: number
  end: number
  html: string
}

const ts = (s: string) => {
  const m = s.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/)
  if (!m) return NaN
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Plain text with <i>, <b>, <u> kept; everything else (font tags, ASS overrides) dropped. */
export function cueHtml(raw: string) {
  const text = raw
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\\N/gi, '\n')
    .replace(/<(\/?)(i|b|u)>/gi, '\u0001$1$2\u0002')
    .replace(/<[^>]+>/g, '')
  return escape(text)
    .replace(/\u0001(\/?)(i|b|u)\u0002/gi, '<$1$2>')
    .trim()
    .replace(/\n/g, '<br>')
}

/** SRT and WebVTT. */
export function parseCues(text: string): Cue[] {
  const cues: Cue[] = []
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/)
  for (const b of blocks) {
    const lines = b.split('\n')
    const i = lines.findIndex((l) => l.includes('-->'))
    if (i < 0) continue
    const [a, z] = lines[i].split('-->')
    const start = ts(a)
    const end = ts(z)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const html = cueHtml(lines.slice(i + 1).join('\n'))
    if (html) cues.push({ start, end, html })
  }
  return cues.sort((x, y) => x.start - y.start)
}

/** Cues showing at time t (binary search, then a short walk for overlaps). */
export function activeCues(cues: Cue[], t: number) {
  let lo = 0
  let hi = cues.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= t) lo = mid + 1
    else hi = mid
  }
  const out: Cue[] = []
  for (let i = lo - 1; i >= 0 && i >= lo - 20; i--) if (cues[i].end > t) out.unshift(cues[i])
  return out
}

export function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

export function cueStyle(s: SubStyle): React.CSSProperties {
  const shadow = s.shadow === 'soft' ? '0 2px 6px rgba(0,0,0,0.85)' : s.shadow === 'strong' ? '0 0 4px #000, 2px 2px 3px #000, -1px -1px 2px #000' : 'none'
  return {
    fontFamily: `'${s.font}', sans-serif`,
    fontSize: `${s.size}px`,
    color: s.color,
    background: s.background === 'none' ? 'transparent' : hexA(s.background, s.bgOpacity),
    WebkitTextStroke: s.outline ? `${s.outline}px ${s.outlineColor}` : undefined,
    paintOrder: 'stroke fill',
    textShadow: shadow,
  }
}
