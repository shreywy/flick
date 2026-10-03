import type { Episode, Library, Progress, Title } from '../shared/types'

export function fmtRuntime(min?: number) {
  if (!min) return ''
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

export function fmtClock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor(sec / 3600)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export function timeLeft(p: Progress) {
  const left = Math.max(0, p.duration - p.position)
  return `${fmtRuntime(Math.max(1, Math.round(left / 60)))} left`
}

export const epTag = (e: { season: number; episode: number }) => `S${e.season} E${e.episode}`

export const isStarted = (p?: Progress) => !!p && !p.watched && p.duration > 0 && p.position / p.duration > 0.02

export interface Resume {
  title: Title
  fileId: number
  episode?: Episode
  progress?: Progress
  updated: number
}

/** Where to pick a show back up: the episode in progress, else the one after the last watched. */
export function showResume(t: Title, lib: Library): Resume | null {
  const eps = t.episodes ?? []
  if (!eps.length) return null
  let last: { ep: Episode; p: Progress } | null = null
  for (const ep of eps) {
    const p = lib.progress[ep.fileId]
    if (p && (!last || p.updated > last.p.updated)) last = { ep, p }
  }
  if (!last) return { title: t, fileId: eps[0].fileId, episode: eps[0], updated: 0 }
  if (isStarted(last.p)) return { title: t, fileId: last.ep.fileId, episode: last.ep, progress: last.p, updated: last.p.updated }
  const i = eps.indexOf(last.ep)
  const next = eps.slice(i + 1).find((e) => !lib.progress[e.fileId]?.watched)
  if (!next) return null
  return { title: t, fileId: next.fileId, episode: next, updated: last.p.updated }
}

export function continueWatching(lib: Library): Resume[] {
  const out: Resume[] = []
  for (const t of lib.titles) {
    if (t.kind === 'movie' && t.fileId) {
      const p = lib.progress[t.fileId]
      if (isStarted(p)) out.push({ title: t, fileId: t.fileId, progress: p, updated: p!.updated })
    } else if (t.kind === 'show') {
      const r = showResume(t, lib)
      if (r && r.updated) out.push(r)
    }
  }
  return out.sort((a, b) => b.updated - a.updated)
}

export function nextEpisode(t: Title, fileId: number) {
  const eps = t.episodes ?? []
  const i = eps.findIndex((e) => e.fileId === fileId)
  return i >= 0 ? eps[i + 1] : undefined
}

export function titleProgress(t: Title, lib: Library) {
  if (t.kind === 'movie') return t.fileId ? lib.progress[t.fileId] : undefined
  return undefined
}

export function isWatched(t: Title, lib: Library) {
  if (t.kind === 'movie') return !!(t.fileId && lib.progress[t.fileId]?.watched)
  return !!t.episodes?.length && t.episodes.every((e) => lib.progress[e.fileId]?.watched)
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')

/** Library search: title first, then cast / director / collection / year. Returns titles with where the title matched. */
export function searchLibrary(titles: Title[], q: string) {
  const query = fold(q.trim())
  if (!query) return []
  const words = query.split(/\s+/)
  const hits: { t: Title; score: number; at: number; len: number; why?: string }[] = []
  for (const t of titles) {
    const name = fold(t.name)
    const at = name.indexOf(query)
    let score = 0
    let why: string | undefined
    if (at === 0) score = 100
    else if (at > 0) score = /\W/.test(name[at - 1]) ? 80 : 50
    else if (words.every((w) => name.includes(w))) score = 40
    else {
      const m = t.meta
      const other = (label: string, vals: (string | number | undefined)[]) => {
        const hit = vals.find((v) => v !== undefined && words.every((w) => fold(String(v)).includes(w)))
        if (hit !== undefined && !why) {
          why = `${label}${String(hit)}`
          score = 20
        }
      }
      if (m) {
        other('', [m.originalTitle !== t.name ? m.originalTitle : undefined])
        other('', [m.collection?.replace(/ Collection$/, '')])
        other('', t.collections)
        other('', m.cast)
        other('', m.directors)
      }
      other('', [t.year])
    }
    if (score) hits.push({ t, score, at, len: query.length, why })
  }
  return hits.sort((a, b) => b.score - a.score || (b.t.year ?? 0) - (a.t.year ?? 0))
}
