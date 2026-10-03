// Sorting finished downloads from the inbox into Movies / TV Shows.
import fs from 'node:fs'
import path from 'node:path'
import { clean, episodeTag, guess, isSample, isSub, isVideo, movieName, PARTIAL_EXT, subSuffix } from './parse'

export interface Roots {
  inbox: string
  movies: string
  shows: string
}

interface FileInfo {
  path: string
  size: number
  mtime: number
}

export function filesIn(entry: string): FileInfo[] {
  const st = fs.statSync(entry)
  if (st.isFile()) return [{ path: entry, size: st.size, mtime: st.mtimeMs }]
  const out: FileInfo[] = []
  for (const d of fs.readdirSync(entry, { withFileTypes: true, recursive: true })) {
    if (!d.isFile()) continue
    const p = path.join(d.parentPath, d.name)
    const s = fs.statSync(p)
    out.push({ path: p, size: s.size, mtime: s.mtimeMs })
  }
  return out
}

export function stillDownloading(files: FileInfo[], minAgeMs: number, now = Date.now()) {
  if (files.some((f) => PARTIAL_EXT.has(path.extname(f.path).toLowerCase()))) return true
  const newest = Math.max(0, ...files.map((f) => f.mtime))
  return now - newest < minAgeMs
}

/** Inbox entries that have something playable in them. */
export function inboxEntries(inbox: string) {
  if (!fs.existsSync(inbox)) return []
  return fs
    .readdirSync(inbox)
    .filter((n) => !n.startsWith('.'))
    .map((n) => path.join(inbox, n))
    .filter((p) => {
      try {
        return filesIn(p).some((f) => isVideo(f.path))
      } catch {
        return false
      }
    })
}

export interface Move {
  src: string
  dst: string
}

export interface Plan {
  moves: Move[]
  titleFolders: string[]
  problems: string[]
}

function findDir(parent: string, match: (name: string) => boolean) {
  if (!fs.existsSync(parent)) return undefined
  return fs
    .readdirSync(parent, { withFileTypes: true })
    .find((d) => d.isDirectory() && match(d.name))?.name
}

function showFolder(shows: string, title: string, year?: number) {
  const withYear = year ? `${title} (${year})` : title
  // reuse an existing folder if the name only differs in case or a missing year
  const hit = findDir(shows, (n) => [withYear.toLowerCase(), title.toLowerCase()].includes(n.toLowerCase()))
  return path.join(shows, hit ?? withYear)
}

function seasonFolder(show: string, season: number) {
  const hit = findDir(show, (n) => {
    const m = n.match(/^season\s*0*(\d+)$/i)
    return !!m && Number(m[1]) === season
  })
  return path.join(show, hit ?? (season === 0 ? 'Specials' : `Season ${season}`))
}

export function planEntry(entry: string, roots: Roots, force?: { kind: 'movie' | 'show'; title: string; year?: number }): Plan {
  const files = filesIn(entry)
  const videos = files.filter((f) => isVideo(f.path) && !isSample(f.path, f.size)).map((f) => f.path)
  let subs = files.filter((f) => isSub(f.path)).map((f) => f.path)
  const plan: Plan = { moves: [], titleFolders: [], problems: [] }
  const entryName = path.basename(entry)
  const used = new Set<string>()

  for (const v of videos) {
    const parent = path.dirname(v) === entry ? entryName : path.basename(path.dirname(v))
    let g = guess(v, parent === path.basename(v) ? undefined : parent) ?? guess(v, entryName)
    if (force) {
      const title = clean(force.title)
      if (force.kind === 'movie') g = { kind: 'movie', title, year: force.year }
      else if (g?.kind === 'episode') g = { ...g, title, year: undefined }
      else g = null
    }
    if (!g) {
      plan.problems.push(`Couldn't read a title from ${path.basename(v)}`)
      continue
    }
    const ext = path.extname(v).toLowerCase()
    let dst: string
    let mine: string[]
    if (g.kind === 'episode') {
      const show = showFolder(roots.shows, g.title, g.year)
      dst = path.join(seasonFolder(show, g.season), `${path.basename(show)} ${episodeTag(g.season, g.episodes)}${ext}`)
      const stem = path.basename(v, path.extname(v))
      mine =
        videos.length === 1
          ? subs
          : subs.filter((s) => {
              if (path.basename(s).startsWith(stem)) return true
              const sg = guess(s)
              return sg?.kind === 'episode' && sg.season === g.season && sg.episodes.join() === g.episodes.join()
            })
      if (!plan.titleFolders.includes(show)) plan.titleFolders.push(show)
    } else {
      const name = clean(movieName(g))
      const sameName = videos.filter((o) => {
        const og = guess(o, parent)
        return og?.kind === 'movie' && clean(movieName(og)) === name
      })
      const part = sameName.length > 1 ? ` - part${sameName.indexOf(v) + 1}` : ''
      dst = path.join(roots.movies, name, `${name}${part}${ext}`)
      const stem = path.basename(v, path.extname(v))
      mine = videos.length === 1 ? subs : subs.filter((s) => path.basename(s).startsWith(stem))
      const folder = path.join(roots.movies, name)
      if (!plan.titleFolders.includes(folder)) plan.titleFolders.push(folder)
    }
    if (fs.existsSync(dst) || used.has(dst.toLowerCase())) {
      plan.problems.push(`${path.relative(path.dirname(roots.movies), dst)} already exists`)
      continue
    }
    used.add(dst.toLowerCase())
    plan.moves.push({ src: v, dst })
    const dstStem = path.basename(dst, ext)
    const takenSubs = new Set<string>()
    for (const s of mine) {
      const base = dstStem + subSuffix(s)
      let name = base
      let n = 2
      const sext = path.extname(s).toLowerCase()
      while (takenSubs.has(name.toLowerCase()) || fs.existsSync(path.join(path.dirname(dst), name + sext))) name = `${base}.${n++}`
      takenSubs.add(name.toLowerCase())
      plan.moves.push({ src: s, dst: path.join(path.dirname(dst), name + sext) })
    }
    subs = subs.filter((s) => !mine.includes(s))
  }
  return plan
}

function moveFile(src: string, dst: string) {
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  try {
    fs.renameSync(src, dst)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    fs.copyFileSync(src, dst)
    fs.unlinkSync(src)
  }
}

/** Do the moves, then recycle the leftover folder if nothing playable is left in it. */
export async function applyPlan(entry: string, plan: Plan, trash: (p: string) => Promise<void>) {
  for (const m of plan.moves) moveFile(m.src, m.dst)
  if (plan.moves.length && fs.existsSync(entry)) {
    const left = filesIn(entry).filter((f) => isVideo(f.path) && !isSample(f.path, f.size))
    if (!left.length) await trash(entry)
  }
}
