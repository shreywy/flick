import type { Library, PlayInfo, QueueState, Settings, SubTrack, TmdbCandidate } from '../shared/types'

declare global {
  interface Window {
    flick: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: string, fn: (...args: unknown[]) => void) => () => void
    }
  }
}

export type AppSettings = Settings & { subdlKey: string; setupDone: boolean }

export interface SubCandidate {
  provider: 'opensubtitles' | 'subdl'
  id: string
  key: string
  release: string
  hearingImpaired: boolean
  sameRelease: boolean
  downloads: number
  have?: boolean
}

export interface SpriteInfo {
  every: number
  cols: number
  rows: number
  width: number
  height: number
  base: string
}

export interface Quota {
  remaining: number
  resetAt?: string
}

const call = <T,>(ch: string, ...args: unknown[]) => window.flick.invoke(ch, ...args) as Promise<T>

export const api = {
  init: () => call<{ settings: AppSettings; firstRun: boolean; version: string }>('app:init'),
  library: () => call<Library>('library:get'),
  rescan: () => call<Library>('library:rescan'),
  setSettings: (patch: Partial<AppSettings>) => call<AppSettings>('settings:set', patch),
  testTmdb: (key: string) => call<boolean>('tmdb:test', key),
  searchTmdb: (kind: 'movie' | 'show', q: string) => call<TmdbCandidate[]>('tmdb:search', kind, q),
  playInfo: (fileId: number) => call<PlayInfo>('play:info', fileId),
  keyframe: (fileId: number, t: number) => call<number>('play:keyframe', fileId, t),
  crop: (fileId: number) => call<{ w: number; h: number; x: number; y: number } | null>('play:crop', fileId),
  markers: (fileId: number) => call<{ intro?: [number, number]; credits?: number }>('play:markers', fileId),
  sprites: (fileId: number) => call<SpriteInfo | null>('play:sprites', fileId),
  saveProgress: (fileId: number, position: number, duration: number) => call<void>('progress:save', fileId, position, duration),
  markWatched: (fileIds: number[], watched: boolean) => call<void>('progress:mark', fileIds, watched),
  subPrefs: (fileId: number, prefs: { track?: string | null; delay?: number }) => call<void>('subs:prefs', fileId, prefs),
  searchSubs: (fileId: number, query?: string) => call<{ results: SubCandidate[]; error?: string; quota?: Quota }>('subs:search', fileId, query),
  downloadSub: (fileId: number, c: SubCandidate) => call<{ track?: SubTrack; quota?: Quota }>('subs:download', fileId, c),
  queue: () => call<QueueState>('queue:get'),
  pauseQueue: (p: boolean) => call<void>('queue:pause', p),
  fixQueue: (id: number, pick: { tmdbId: number; kind: 'movie' | 'show'; title: string; year?: number }) => call<void>('queue:fix', id, pick),
  retryQueue: (id: number) => call<void>('queue:retry', id),
  fixTitle: (titleId: number, pick: { tmdbId: number; kind: 'movie' | 'show'; title: string; year?: number }) => call<void>('title:fix', titleId, pick),
  setFullscreen: (on: boolean) => call<boolean>('window:fullscreen', on),
  windowState: () => call<{ maximized: boolean; fullscreen: boolean }>('window:state'),
  edit: (cmd: 'cut' | 'copy' | 'paste' | 'selectAll') => call<void>('edit', cmd),
  minimize: () => call<void>('window:minimize'),
  maximize: () => call<void>('window:maximize'),
  close: () => call<void>('window:close'),
  openLog: () => call<void>('shell:log'),
  showFile: (p: string) => call<void>('shell:folder', p),
  on: (ch: string, fn: (...a: unknown[]) => void) => window.flick.on(ch, fn),
}
