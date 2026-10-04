// Shapes shared by the main process and the renderer.

export interface EpisodeMeta {
  name?: string
  overview?: string
  runtime?: number // minutes
  aired?: string
}

/** Contents of flick.json, saved in each title's folder. */
export interface Meta {
  source: 'tmdb' | 'import'
  tmdbId?: number
  kind: 'movie' | 'show'
  title: string
  originalTitle?: string
  year?: number
  overview?: string
  tagline?: string
  runtime?: number // minutes
  rating?: number // 0-10
  certification?: string
  genres: string[]
  studios: string[]
  collection?: string
  keywords?: string[]
  countries: string[]
  originalLanguage?: string
  cast: string[]
  directors: string[]
  episodes?: Record<string, EpisodeMeta> // key "S1E3"
  creditsAt?: Record<string, number> // key "S1E3" or "movie", seconds
}

export interface Episode {
  fileId: number
  path: string
  season: number
  episode: number
  name: string
  overview?: string
  runtime?: number
  still?: string
}

export interface Title {
  id: number
  kind: 'movie' | 'show'
  folder: string
  name: string
  year?: number
  added: number
  meta?: Meta
  poster?: string
  backdrop?: string
  logo?: string
  /** movie: the main video file */
  fileId?: number
  path?: string
  episodes?: Episode[]
  collections: string[]
}

export interface Progress {
  fileId: number
  position: number
  duration: number
  watched: boolean
  updated: number
}

export interface Library {
  titles: Title[]
  progress: Record<number, Progress>
}

export interface Track {
  index: number // index within its type (a:N / s:N)
  codec: string
  language?: string
  title?: string
  channels?: number
  default?: boolean
  forced?: boolean
}

export interface SubTrack {
  id: string // "emb:2" or "file:<path>"
  label: string
  detail?: string
  language?: string
  format: 'text' | 'ass' | 'image'
  url?: string
  sameRelease?: boolean
}

export type PlayMode = 'direct' | 'remux' | 'convert'

export interface PlayInfo {
  fileId: number
  mode: PlayMode
  duration: number
  directUrl?: string
  streamBase?: string // add ?start=&audio=
  audio: Track[]
  audioNeedsConvert: boolean[]
  mimes: string[] // MSE type per audio track
  subs: SubTrack[]
  spriteUrl?: string
  details: string
  position: number
  subPrefs: { track?: string; delay: number }
  creditsAt?: number
}

export interface SubStyle {
  size: number
  font: string
  color: string
  background: string // 'none' | hex
  bgOpacity: number // 0-1
  outline: number
  outlineColor: string
  shadow: 'none' | 'soft' | 'strong'
  position: number // percent from bottom
}

export const DEFAULT_SUB_STYLE: SubStyle = {
  size: 42,
  font: 'Schibsted Grotesk',
  color: '#FFFFFF',
  background: '#000000',
  bgOpacity: 0.55,
  outline: 0,
  outlineColor: '#000000',
  shadow: 'soft',
  position: 10,
}

export interface Settings {
  mediaRoot: string
  tmdbKey: string
  osKey: string
  osUser: string
  osPass: string
  autoSubs: boolean
  autoplayNext: boolean
  watchedAt: number // 0-1
  skipSeconds: number
  ffmpegDir: string
  subStyle: SubStyle
  sortAuto: boolean
  /** title id -> when it was taken out of Continue watching (watching again brings it back) */
  hiddenResume: Record<number, number>
  /** titles taken out of Recently added */
  hiddenRecent: number[]
}

export type QueueStatus = 'waiting' | 'working' | 'attention' | 'done' | 'downloading'
export type QueueStep = 'move' | 'meta' | 'subs' | 'done'

export interface QueueItem {
  id: number
  name: string
  target?: string
  step: QueueStep
  status: QueueStatus
  message?: string
  action?: 'fix' | 'subs'
  updated: number
}

export interface QueueState {
  items: QueueItem[]
  counts: Record<QueueStatus | 'all', number>
  paused: boolean
  doneTotal: number
}

export interface SubResult {
  fileId: number
  release: string
  hearingImpaired: boolean
  sameRelease: boolean
  downloads: number
}

export interface TmdbCandidate {
  id: number
  kind: 'movie' | 'show'
  title: string
  year?: number
  overview?: string
  poster?: string
}
