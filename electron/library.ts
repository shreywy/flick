// Scans Movies / TV Shows and builds what the renderer shows.
import fs from 'node:fs'
import path from 'node:path'
import { collectionsFor } from '../shared/collections'
import type { Episode, Library, Progress, Title } from '../shared/types'
import type { DB } from './db'
import { ART, episodeFiles, findArt, nameFromFolder, readMeta, stillPath } from './metadata'
import { isSample, isVideo } from './parse'

export interface MediaRoots {
  movies: string
  shows: string
}

function subdirs(p: string) {
  if (!fs.existsSync(p)) return []
  return fs
    .readdirSync(p, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => path.join(p, d.name))
}

function upsertTitle(db: DB, kind: 'movie' | 'show', folder: string, added: number) {
  db.prepare('INSERT INTO titles (kind, folder, added, present) VALUES (?, ?, ?, 1) ON CONFLICT(folder) DO UPDATE SET present = 1, kind = excluded.kind').run(
    kind,
    folder,
    added,
  )
  return (db.prepare('SELECT id FROM titles WHERE folder = ?').get(folder) as { id: number }).id
}

function upsertFile(db: DB, titleId: number, file: string, season: number | null, episode: number | null) {
  const st = fs.statSync(file)
  db.prepare(
    `INSERT INTO files (title_id, path, season, episode, size, mtime, present) VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(path) DO UPDATE SET title_id = excluded.title_id, season = excluded.season, episode = excluded.episode, present = 1,
       probe = CASE WHEN files.size = excluded.size AND files.mtime = excluded.mtime THEN files.probe ELSE NULL END,
       size = excluded.size, mtime = excluded.mtime`,
  ).run(titleId, file, season, episode, st.size, Math.round(st.mtimeMs))
}

const firstSeen = (file: string) => {
  const st = fs.statSync(file)
  return Math.round(Math.min(st.birthtimeMs || Infinity, st.mtimeMs))
}

/** Sync the database with what's on disk. Returns folders that still need metadata. */
export function scanLibrary(db: DB, roots: MediaRoots) {
  const needsMeta: { folder: string; kind: 'movie' | 'show' }[] = []
  db.exec('BEGIN')
  try {
    db.exec('UPDATE titles SET present = 0; UPDATE files SET present = 0;')
    for (const folder of subdirs(roots.movies)) {
      const videos = fs
        .readdirSync(folder)
        .map((n) => path.join(folder, n))
        .filter((p) => isVideo(p) && fs.statSync(p).isFile() && !isSample(p, fs.statSync(p).size))
        .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)
      if (!videos.length) continue
      const id = upsertTitle(db, 'movie', folder, firstSeen(videos[0]))
      for (const v of videos) upsertFile(db, id, v, null, null)
      if (!readMeta(folder)) needsMeta.push({ folder, kind: 'movie' })
    }
    for (const folder of subdirs(roots.shows)) {
      const eps = episodeFiles(folder)
      if (!eps.length) continue
      const id = upsertTitle(db, 'show', folder, Math.min(...eps.map((e) => firstSeen(e.path))))
      for (const e of eps) upsertFile(db, id, e.path, e.season, e.episode)
      if (!readMeta(folder)) needsMeta.push({ folder, kind: 'show' })
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return needsMeta
}

interface FileRow {
  id: number
  title_id: number
  path: string
  season: number | null
  episode: number | null
}

/** Progress is keyed by TMDB id where we have one, so a re-download keeps your place. */
export function progressKey(meta: { tmdbId?: number } | undefined, file: { path: string; season: number | null; episode: number | null }) {
  if (!meta?.tmdbId) return `p:${file.path.toLowerCase()}`
  return file.season === null ? `m:${meta.tmdbId}` : `t:${meta.tmdbId}:${file.season}:${file.episode}`
}

export function buildLibrary(db: DB, artUrl: (p: string) => string): Library {
  const titles = db.prepare('SELECT id, kind, folder, added FROM titles WHERE present = 1').all() as {
    id: number
    kind: 'movie' | 'show'
    folder: string
    added: number
  }[]
  const files = db.prepare('SELECT id, title_id, path, season, episode FROM files WHERE present = 1').all() as unknown as FileRow[]
  const progressRows = new Map(
    (db.prepare('SELECT key, position, duration, watched, updated FROM progress').all() as {
      key: string
      position: number
      duration: number
      watched: number
      updated: number
    }[]).map((r) => [r.key, r]),
  )
  const progress: Record<number, Progress> = {}
  const out: Title[] = []
  for (const t of titles) {
    const meta = readMeta(t.folder)
    const fallback = nameFromFolder(t.folder)
    const mine = files.filter((f) => f.title_id === t.id)
    for (const f of mine) {
      const p = progressRows.get(progressKey(meta, f))
      if (p) progress[f.id] = { fileId: f.id, position: p.position, duration: p.duration, watched: !!p.watched, updated: p.updated }
    }
    const art = (names: string[]) => {
      const p = findArt(t.folder, names)
      return p ? artUrl(p) : undefined
    }
    const title: Title = {
      id: t.id,
      kind: t.kind,
      folder: t.folder,
      name: meta?.title ?? fallback.title,
      year: meta?.year ?? fallback.year,
      added: t.added,
      meta,
      poster: art(ART.poster),
      backdrop: art(ART.backdrop),
      logo: art(ART.logo),
      collections: collectionsFor(meta),
    }
    if (t.kind === 'movie') {
      title.fileId = mine[0]?.id
      title.path = mine[0]?.path
    } else {
      title.episodes = mine
        .filter((f) => f.season !== null)
        .sort((a, b) => a.season! - b.season! || a.episode! - b.episode!)
        .map((f): Episode => {
          const em = meta?.episodes?.[`S${f.season}E${f.episode}`]
          const still = stillPath(f.path)
          return {
            fileId: f.id,
            path: f.path,
            season: f.season!,
            episode: f.episode!,
            name: em?.name ?? `Episode ${f.episode}`,
            overview: em?.overview,
            runtime: em?.runtime,
            still: fs.existsSync(still) ? artUrl(still) : undefined,
          }
        })
    }
    out.push(title)
  }
  return { titles: out, progress }
}

export function fileRow(db: DB, fileId: number) {
  return db.prepare('SELECT f.id, f.path, f.season, f.episode, f.probe, f.title_id, t.folder, t.kind FROM files f JOIN titles t ON t.id = f.title_id WHERE f.id = ?').get(fileId) as
    | { id: number; path: string; season: number | null; episode: number | null; probe: string | null; title_id: number; folder: string; kind: 'movie' | 'show' }
    | undefined
}
