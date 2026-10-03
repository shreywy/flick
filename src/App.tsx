import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
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

// ---------- page transitions ----------
// Every route change runs inside a view transition: the old page stays on screen until the new one has its
// images ready, then they cross-fade. Playing something grows the clicked artwork into the player; leaving
// the player shrinks it back into that card.

let navDone: Promise<unknown> = Promise.resolve()
/** Run fn once the current page transition has finished (resizing the window mid-transition cancels it). */
export const afterNav = (fn: () => void) => void navDone.then(fn, fn)

const scrolls = new Map<string, number>()
let popped = false
let from: DOMRect | null = null
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

/** Open the player, growing `el`'s artwork into it. */
export function play(fileId: number, el?: Element | null, startOver = false) {
  const img = el?.querySelector('img') ?? el
  if (img instanceof HTMLElement) {
    img.style.viewTransitionName = 'flick-play'
    from = img.getBoundingClientRect()
  }
  go(`#/play/${fileId}${startOver ? '/start' : ''}`)
}

function imagesReady(ms: number) {
  const imgs = [...document.images].filter((i) => {
    const r = i.getBoundingClientRect()
    return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
  })
  for (const i of imgs) i.loading = 'eager'
  return Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => undefined))), new Promise((r) => setTimeout(r, ms))])
}

function useHash() {
  const [hash, setHash] = useState(location.hash || '#/')
  useEffect(() => {
    const onPop = () => (popped = true)
    const on = (e: HashChangeEvent) => {
      const next = location.hash || '#/'
      const prev = new URL(e.oldURL).hash || '#/'
      scrolls.set(prev, scrollY)
      const back = popped
      popped = false
      const leaving = prev.startsWith('#/play/') && !next.startsWith('#/play/')
      const entering = next.startsWith('#/play/') && !prev.startsWith('#/play/')
      const update = async () => {
        flushSync(() => setHash(next))
        scrollTo(0, back ? (scrolls.get(next) ?? 0) : 0)
        if (leaving) {
          // shrink back into the card for what was playing, when it's on screen
          const id = prev.split('/')[2]
          const card = [...document.querySelectorAll(`[data-file="${id}"]`)].find((c) => {
            const r = c.getBoundingClientRect()
            return r.bottom > 0 && r.top < innerHeight
          })
          const img = card?.querySelector('img') ?? card
          if (img instanceof HTMLElement) img.style.viewTransitionName = 'flick-play'
        }
        await imagesReady(400)
      }
      if (!document.startViewTransition) return void update()
      document.documentElement.dataset.nav = entering ? 'play' : leaving ? 'leave' : 'page'
      const vt = document.startViewTransition(update)
      // a transition that gets cut short (another navigation, a resize) still lands on the new page
      vt.ready.catch(() => undefined)
      const start = from
      from = null
      if (entering && start) {
        // the card first moves to the middle of the screen, then the player opens out from it
        vt.ready
          .then(() => {
            const W = innerWidth
            const H = innerHeight
            const k = Math.min(1.6, (W * 0.42) / start.width)
            const w = start.width * k
            const h = start.height * k
            document.documentElement.animate(
              {
                transform: [`translate(${start.left}px, ${start.top}px)`, `translate(${(W - w) / 2}px, ${(H - h) / 2}px)`, 'translate(0px, 0px)'],
                width: [`${start.width}px`, `${w}px`, `${W}px`],
                height: [`${start.height}px`, `${h}px`, `${H}px`],
                borderRadius: ['6px', '8px', '0px'],
                offset: [0, 0.45, 1],
                easing: ['cubic-bezier(.3,0,.2,1)', 'cubic-bezier(.6,0,.15,1)', 'linear'],
              } as unknown as Keyframe[],
              { duration: 820, pseudoElement: '::view-transition-group(flick-play)', fill: 'both' },
            )
          })
          .catch(() => undefined)
      }
      navDone = vt.finished.finally(() => {
        delete document.documentElement.dataset.nav
        document.querySelectorAll<HTMLElement>('[style*="view-transition-name"]').forEach((el) => {
          if (!el.classList.contains('p-stage')) el.style.viewTransitionName = ''
        })
      })
    }
    addEventListener('popstate', onPop)
    addEventListener('hashchange', on)
    return () => {
      removeEventListener('popstate', onPop)
      removeEventListener('hashchange', on)
    }
  }, [])
  return hash
}

export function go(hash: string) {
  if (location.hash !== hash) location.hash = hash
}

// ---------- window buttons ----------
function WindowControls() {
  const [max, setMax] = useState(true)
  useEffect(() => {
    api.windowState().then((s) => setMax(s.maximized))
    return api.on('window:maximized', (m) => setMax(m as boolean))
  }, [])
  return (
    <div className="wctl">
      <button aria-label="Minimise" onClick={() => api.minimize()}>
        <svg viewBox="0 0 10 10" aria-hidden>
          <path d="M0 5h10" />
        </svg>
      </button>
      <button aria-label={max ? 'Restore' : 'Maximise'} onClick={() => api.maximize()}>
        <svg viewBox="0 0 10 10" aria-hidden>
          {max ? <path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" /> : <rect x=".5" y=".5" width="9" height="9" />}
        </svg>
      </button>
      <button className="close" aria-label="Close" onClick={() => api.close()}>
        <svg viewBox="0 0 10 10" aria-hidden>
          <path d="M.5.5l9 9M9.5.5l-9 9" />
        </svg>
      </button>
    </div>
  )
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

  if (!value) return <WindowControls />
  if (firstRun) {
    return (
      <AppCtx.Provider value={value}>
        <FirstRun onDone={() => setFirstRun(false)} />
        <WindowControls />
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
      <div className="dragbar" />
      {showHeader && <Header route={route || ''} />}
      {page}
      <WindowControls />
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
