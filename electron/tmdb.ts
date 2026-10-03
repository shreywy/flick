// TMDB lookups and artwork downloads.
import fs from 'node:fs'
import path from 'node:path'
import type { Meta, TmdbCandidate } from '../shared/types'

const API = 'https://api.themoviedb.org/3'
const IMG = 'https://image.tmdb.org/t/p'

export class TmdbError extends Error {}

export class Tmdb {
  constructor(private key: string) {}

  private async get<T>(p: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(API + p)
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    const headers: Record<string, string> = { accept: 'application/json' }
    // a v4 read token is a long JWT, a v3 key is 32 hex characters
    if (this.key.length > 40) headers.authorization = `Bearer ${this.key}`
    else url.searchParams.set('api_key', this.key)
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) })
      if (res.status === 429 && attempt < 4) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
        continue
      }
      if (res.status === 401) throw new TmdbError('TMDB rejected the key')
      if (!res.ok) throw new TmdbError(`TMDB ${res.status} for ${p}`)
      return (await res.json()) as T
    }
  }

  async search(kind: 'movie' | 'show', query: string, year?: number): Promise<TmdbCandidate[]> {
    type R = { results: { id: number; title?: string; name?: string; release_date?: string; first_air_date?: string; overview?: string; poster_path?: string; popularity: number }[] }
    const p = kind === 'movie' ? '/search/movie' : '/search/tv'
    const yearKey = kind === 'movie' ? 'year' : 'first_air_date_year'
    let r = await this.get<R>(p, { query, [yearKey]: year, include_adult: 'false' })
    if (!r.results.length && year) r = await this.get<R>(p, { query, include_adult: 'false' })
    return r.results.map((x) => {
      const date = x.release_date || x.first_air_date
      return {
        id: x.id,
        kind,
        title: (x.title ?? x.name)!,
        year: date ? Number(date.slice(0, 4)) : undefined,
        overview: x.overview,
        poster: x.poster_path ? `${IMG}/w342${x.poster_path}` : undefined,
      }
    })
  }

  /** Best match for a parsed name, or null when nothing is close enough to trust. */
  async match(kind: 'movie' | 'show', title: string, year?: number) {
    const results = await this.search(kind, title, year)
    let best: { c: TmdbCandidate; score: number } | null = null
    results.slice(0, 10).forEach((c, i) => {
      let score = similarity(title, c.title)
      if (year && c.year) score += c.year === year ? 0.3 : Math.abs(c.year - year) === 1 ? 0.1 : -0.3
      score -= i * 0.02
      if (!best || score > best.score) best = { c, score }
    })
    const b = best as { c: TmdbCandidate; score: number } | null
    return b && b.score >= 0.75 ? b.c : null
  }

  async details(kind: 'movie' | 'show', id: number): Promise<{ meta: Meta; art: Art }> {
    if (kind === 'movie') {
      type M = {
        id: number; title: string; original_title: string; release_date?: string; overview?: string; tagline?: string; runtime?: number
        vote_average?: number; genres: { name: string }[]; production_companies: { name: string }[]; production_countries: { name: string }[]
        original_language?: string; belongs_to_collection?: { name: string } | null; poster_path?: string; backdrop_path?: string
        credits: { cast: { name: string }[]; crew: { name: string; job: string }[] }
        release_dates: { results: { iso_3166_1: string; release_dates: { certification: string }[] }[] }
        keywords: { keywords: { name: string }[] }
        images: { logos: { file_path: string; iso_639_1: string | null }[] }
      }
      const m = await this.get<M>(`/movie/${id}`, { append_to_response: 'credits,release_dates,keywords,images', include_image_language: 'en,null' })
      const us = m.release_dates.results.find((r) => r.iso_3166_1 === 'US')
      const meta: Meta = {
        source: 'tmdb',
        tmdbId: m.id,
        kind: 'movie',
        title: m.title,
        originalTitle: m.original_title,
        year: m.release_date ? Number(m.release_date.slice(0, 4)) : undefined,
        overview: m.overview || undefined,
        tagline: m.tagline || undefined,
        runtime: m.runtime || undefined,
        rating: m.vote_average ? Math.round(m.vote_average * 10) / 10 : undefined,
        certification: us?.release_dates.map((d) => d.certification).find(Boolean),
        genres: m.genres.map((g) => g.name),
        studios: m.production_companies.map((c) => c.name),
        collection: m.belongs_to_collection?.name,
        keywords: m.keywords.keywords.map((k) => k.name),
        countries: m.production_countries.map((c) => c.name),
        originalLanguage: m.original_language,
        cast: m.credits.cast.slice(0, 12).map((c) => c.name),
        directors: m.credits.crew.filter((c) => c.job === 'Director').map((c) => c.name),
      }
      return { meta, art: { poster: m.poster_path, backdrop: m.backdrop_path, logo: pickLogo(m.images.logos) } }
    }
    type T = {
      id: number; name: string; original_name: string; first_air_date?: string; overview?: string; tagline?: string; episode_run_time?: number[]
      vote_average?: number; genres: { name: string }[]; production_companies: { name: string }[]; networks: { name: string }[]; origin_country: string[]
      original_language?: string; poster_path?: string; backdrop_path?: string; seasons: { season_number: number }[]
      credits: { cast: { name: string }[] }; created_by: { name: string }[]
      content_ratings: { results: { iso_3166_1: string; rating: string }[] }
      keywords: { results: { name: string }[] }
      images: { logos: { file_path: string; iso_639_1: string | null }[] }
    }
    const t = await this.get<T>(`/tv/${id}`, { append_to_response: 'credits,content_ratings,keywords,images', include_image_language: 'en,null' })
    const meta: Meta = {
      source: 'tmdb',
      tmdbId: t.id,
      kind: 'show',
      title: t.name,
      originalTitle: t.original_name,
      year: t.first_air_date ? Number(t.first_air_date.slice(0, 4)) : undefined,
      overview: t.overview || undefined,
      tagline: t.tagline || undefined,
      runtime: t.episode_run_time?.[0],
      rating: t.vote_average ? Math.round(t.vote_average * 10) / 10 : undefined,
      certification: t.content_ratings.results.find((r) => r.iso_3166_1 === 'US')?.rating,
      genres: t.genres.map((g) => g.name),
      studios: [...t.production_companies.map((c) => c.name), ...t.networks.map((n) => n.name)],
      keywords: t.keywords.results.map((k) => k.name),
      countries: t.origin_country,
      originalLanguage: t.original_language,
      cast: t.credits.cast.slice(0, 12).map((c) => c.name),
      directors: t.created_by.map((c) => c.name),
      episodes: {},
    }
    return { meta, art: { poster: t.poster_path, backdrop: t.backdrop_path, logo: pickLogo(t.images.logos) } }
  }

  async season(id: number, season: number) {
    type S = { episodes: { episode_number: number; name: string; overview?: string; runtime?: number; air_date?: string; still_path?: string }[] }
    return this.get<S>(`/tv/${id}/season/${season}`)
  }

  imageUrl(p: string, size: string) {
    return `${IMG}/${size}${p}`
  }
}

export interface Art {
  poster?: string
  backdrop?: string
  logo?: string
}

function pickLogo(logos: { file_path: string; iso_639_1: string | null }[]) {
  return (logos.find((l) => l.iso_639_1 === 'en' && l.file_path.endsWith('.png')) ?? logos.find((l) => l.file_path.endsWith('.png')))?.file_path
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** 0..1 token overlap, generous to subtitles ("Star Wars - The Rise of Skywalker" vs "Star Wars: The Rise of Skywalker"). */
export function similarity(a: string, b: string) {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const ta = new Set(x.split(' '))
  const tb = new Set(y.split(' '))
  let common = 0
  for (const t of ta) if (tb.has(t)) common++
  return (2 * common) / (ta.size + tb.size)
}

export async function download(url: string, dst: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new TmdbError(`Image download failed (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  const tmp = dst + '.part'
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.writeFileSync(tmp, buf)
  fs.renameSync(tmp, dst)
}
