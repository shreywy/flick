// Writes flick.json and artwork into a title's folder.
import fs from 'node:fs'
import path from 'node:path'
import type { Meta } from '../shared/types'
import { download, Tmdb } from './tmdb'
import { isVideo } from './parse'

export const META_FILE = 'flick.json'

export function readMeta(folder: string): Meta | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(folder, META_FILE), 'utf8')) as Meta
  } catch {
    return undefined
  }
}

export function writeMeta(folder: string, meta: Meta) {
  const tmp = path.join(folder, META_FILE + '.part')
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2))
  fs.renameSync(tmp, path.join(folder, META_FILE))
}

/** Title and year from a folder name like "Dune (2021)". */
export function nameFromFolder(folder: string) {
  const base = path.basename(folder)
  const m = base.match(/^(.*?)\s*\((\d{4})\)$/)
  return m ? { title: m[1], year: Number(m[2]) } : { title: base, year: undefined }
}

export const ART = {
  poster: ['poster.jpg', 'folder.jpg', 'poster.png'],
  backdrop: ['backdrop.jpg', 'fanart.jpg', 'landscape.jpg'],
  logo: ['logo.png'],
}

export function findArt(folder: string, names: string[]) {
  for (const n of names) {
    const p = path.join(folder, n)
    if (fs.existsSync(p)) return p
  }
  return undefined
}

export const stillPath = (video: string) => video.slice(0, -path.extname(video).length) + '-thumb.jpg'

export function episodeFiles(showFolder: string) {
  const out: { path: string; season: number; episode: number }[] = []
  if (!fs.existsSync(showFolder)) return out
  for (const d of fs.readdirSync(showFolder, { withFileTypes: true, recursive: true })) {
    if (!d.isFile() || !isVideo(d.name)) continue
    const m = d.name.match(/S(\d{1,2})E(\d{1,3})/i)
    if (m) out.push({ path: path.join(d.parentPath, d.name), season: Number(m[1]), episode: Number(m[2]) })
  }
  return out
}

/**
 * Look the title up (or use a known TMDB id), save flick.json and any artwork that's missing.
 * Returns null when no confident match was found.
 */
export async function fetchMetadata(
  tmdb: Tmdb,
  folder: string,
  kind: 'movie' | 'show',
  opts: { tmdbId?: number; overwriteArt?: boolean } = {},
): Promise<Meta | null> {
  let id = opts.tmdbId ?? readMeta(folder)?.tmdbId
  if (!id) {
    const { title, year } = nameFromFolder(folder)
    const hit = await tmdb.match(kind, title, year)
    if (!hit) return null
    id = hit.id
  }
  const { meta, art } = await tmdb.details(kind, id)

  const want: [keyof typeof ART, string | undefined, string, string][] = [
    ['poster', art.poster, 'w780', 'poster.jpg'],
    ['backdrop', art.backdrop, 'original', 'backdrop.jpg'],
    ['logo', art.logo, 'w500', 'logo.png'],
  ]
  for (const [type, p, size, file] of want) {
    if (!p) continue
    if (!opts.overwriteArt && findArt(folder, ART[type])) continue
    await download(tmdb.imageUrl(p, size), path.join(folder, file))
  }

  if (kind === 'show') {
    const eps = episodeFiles(folder)
    const seasons = [...new Set(eps.map((e) => e.season))]
    for (const s of seasons) {
      const data = await tmdb.season(id, s).catch(() => null)
      if (!data) continue
      for (const e of data.episodes) {
        meta.episodes![`S${s}E${e.episode_number}`] = {
          name: e.name,
          overview: e.overview || undefined,
          runtime: e.runtime || undefined,
          aired: e.air_date || undefined,
        }
        const file = eps.find((x) => x.season === s && x.episode === e.episode_number)
        if (file && e.still_path && (opts.overwriteArt || !fs.existsSync(stillPath(file.path)))) {
          await download(tmdb.imageUrl(e.still_path, 'w780'), stillPath(file.path)).catch(() => undefined)
        }
      }
    }
  }
  writeMeta(folder, meta)
  return meta
}
