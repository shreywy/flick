import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Library, QueueState, Title } from '../shared/types'
import { api, type AppSettings } from './api'
import { Search, Sliders } from './icons'
import Browse from './pages/Browse'
import FirstRun from './pages/FirstRun'
import Home from './pages/Home'
import Player from './pages/Player'
import SearchPage from './pages/Search'
import SettingsPage from './pages/Settings'
import TitlePage from './pages/TitlePage'

interface Ctx {
  lib: Library
  byId: Map<number, Title>
  byFile: Map<number, Title>
  settings: AppSettings
  saveSettings: (p: Partial<AppSettings>) => Promise<void>
  refresh: () => Promise<void>
  queue: QueueState | null
  go: (hash: string) => void
}

const AppCtx = createContext<Ctx>(null as never)
export const useApp = () => useContext(AppCtx)

function useHash() {
  const [hash, setHash] = useState(location.hash || '#/')
  useEffect(() => {
    const on = () => setHash(location.hash || '#/')
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return hash
}

export function go(hash: string) {
  if (location.hash !== hash) location.hash = hash
}

export default function App() {
  const hash = useHash()
  const [lib, setLib] = useState<Library | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [firstRun, setFirstRun] = useState(false)
  const [queue, setQueue] = useState<QueueState | null>(null)

  const refresh = useCallback(async () => setLib(await api.library()), [])
  const loadQueue = useCallback(async () => setQueue(await api.queue()), [])

  useEffect(() => {
    api.init().then((r) => {
      setSettings(r.settings)
      setFirstRun(r.firstRun)
    })
    refresh()
    loadQueue()
    const offs = [api.on('library:changed', refresh), api.on('queue:changed', loadQueue)]
    return () => offs.forEach((o) => o())
  }, [refresh, loadQueue])

  const saveSettings = useCallback(async (p: Partial<AppSettings>) => setSettings(await api.setSettings(p)), [])

  const value = useMemo<Ctx | null>(() => {
    if (!lib || !settings) return null
    const byId = new Map(lib.titles.map((t) => [t.id, t]))
    const byFile = new Map<number, Title>()
    for (const t of lib.titles) {
      if (t.fileId) byFile.set(t.fileId, t)
      for (const e of t.episodes ?? []) byFile.set(e.fileId, t)
    }
    return { lib, byId, byFile, settings, saveSettings, refresh, queue, go }
  }, [lib, settings, saveSettings, refresh, queue])

  if (!value) return null
  if (firstRun) {
    return (
      <AppCtx.Provider value={value}>
        <FirstRun onDone={() => setFirstRun(false)} />
      </AppCtx.Provider>
    )
  }

  const [, route, arg, arg2] = hash.split('/')
  let page: ReactNode
  if (route === 'movies') page = <Browse kind="movie" />
  else if (route === 'shows') page = <Browse kind="show" />
  else if (route === 'search') page = <SearchPage />
  else if (route === 'title') page = <TitlePage key={arg} id={Number(arg)} season={arg2 ? Number(arg2) : undefined} />
  else if (route === 'play') page = <Player key={arg} fileId={Number(arg)} start={arg2 === 'start'} />
  else if (route === 'settings') page = <SettingsPage section={arg || 'library'} />
  else page = <Home />

  const showHeader = route !== 'play' && route !== 'title'
  return (
    <AppCtx.Provider value={value}>
      {showHeader && <Header route={route || ''} />}
      {page}
    </AppCtx.Provider>
  )
}

function Header({ route }: { route: string }) {
  const { queue } = useApp()
  const [solid, setSolid] = useState(false)
  useEffect(() => {
    const on = () => setSolid(scrollY > 40)
    on()
    addEventListener('scroll', on, { passive: true })
    return () => removeEventListener('scroll', on)
  }, [])
  const left = queue ? queue.counts.waiting + queue.counts.working + queue.counts.attention : 0
  return (
    <header className={`header${solid || (route && route !== 'title') ? ' solid' : ''}`}>
      <button className="wordmark" onClick={() => go('#/')}>
        Flick
      </button>
      <nav className="nav">
        <button className={!route ? 'on' : ''} onClick={() => go('#/')}>
          Home
        </button>
        <button className={route === 'movies' ? 'on' : ''} onClick={() => go('#/movies')}>
          Movies
        </button>
        <button className={route === 'shows' ? 'on' : ''} onClick={() => go('#/shows')}>
          Shows
        </button>
      </nav>
      <div className="spacer" />
      <button className={`iconbtn${route === 'search' ? ' on' : ''}`} aria-label="Search" onClick={() => go('#/search')}>
        <Search />
      </button>
      <button className={`iconbtn${route === 'settings' ? ' on' : ''}`} aria-label="Settings" onClick={() => go('#/settings')}>
        <Sliders />
        {left > 0 && <span className="badge">{left}</span>}
      </button>
    </header>
  )
}
