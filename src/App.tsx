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
// images ready, then the new one comes in. Playing something flies the clicked artwork to the middle of the
// screen and opens the player out of it; leaving the player runs the same flight backwards into that card.

const scrolls = new Map<string, number>()
let popped = false
let from: DOMRect | null = null
let zoom = false
let fromButton: string | null = null // set when a Play button (not a picture) opens the player: its corner radius
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

/** Open the player, growing `el` into it: a card's picture flies to the middle then opens out, a Play button
 *  expands straight to full screen. A banner-sized picture would just jump, so those zoom the page instead. */
export function play(fileId: number, el?: Element | null, startOver = false) {
  const img = el?.querySelector('img') ?? el
  const r = img?.getBoundingClientRect()
  if (el instanceof HTMLButtonElement && !el.querySelector('img')) {
    el.style.viewTransitionName = 'flick-play'
    from = el.getBoundingClientRect()
    fromButton = getComputedStyle(el).borderRadius
  } else if (img instanceof HTMLElement && r && r.width < innerWidth * 0.4) {
    img.style.viewTransitionName = 'flick-play'
    from = r
  } else zoom = true
  go(`#/play/${fileId}${startOver ? '/start' : ''}`)
}

export const onScreen = (r: DOMRect) => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth

function imagesReady(ms: number) {
  const imgs = [...document.images].filter((i) => onScreen(i.getBoundingClientRect()))
  for (const i of imgs) i.loading = 'eager'
  return Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => undefined))), new Promise((r) => setTimeout(r, ms))])
}

type Box = { x: number; y: number; w: number; h: number }
const PLAY_MS = 820
const EXPAND_MS = 560
const LEAVE_MS = 620

/** Card -> middle of the screen -> full screen (or the reverse), on the flick-play group. */
function fly(card: DOMRect | null, dir: 'in' | 'out', button?: string) {
  const W = innerWidth
  const H = innerHeight
  const full: Box = { x: 0, y: 0, w: W, h: H }
  const base: Box = card ? { x: card.left, y: card.top, w: card.width, h: card.height } : { x: 0, y: 0, w: W * 0.24, h: W * 0.135 }
  const k = Math.min(1.6, (W * 0.42) / base.w)
  const mid: Box = { w: base.w * k, h: base.h * k, x: (W - base.w * k) / 2, y: (H - base.h * k) / 2 }
  // the way back is one continuous move into the card; with no card it settles in the middle and fades
  const direct = dir === 'out' && !!card
  const path = dir === 'in' ? [base, mid, full] : card ? [full, base] : [full, mid]
  if (button) {
    // a Play button grows straight out to the edges
    document.documentElement.animate(
      {
        transform: [`translate(${base.x}px, ${base.y}px)`, 'translate(0px, 0px)'],
        width: [`${base.w}px`, `${W}px`],
        height: [`${base.h}px`, `${H}px`],
        borderRadius: [button, '0px'],
        easing: ['cubic-bezier(.45,0,.1,1)', 'linear'],
      } as unknown as Keyframe[],
      { duration: EXPAND_MS, pseudoElement: '::view-transition-group(flick-play)', fill: 'both' },
    )
    return
  }
  const kf: Record<string, unknown> = {
    transform: path.map((b) => `translate(${b.x}px, ${b.y}px)`),
    width: path.map((b) => `${b.w}px`),
    height: path.map((b) => `${b.h}px`),
    borderRadius: dir === 'in' ? ['6px', '8px', '0px'] : ['0px', '6px'],
    offset: dir === 'in' ? [0, 0.45, 1] : [0, 1],
    easing: dir === 'in' ? ['cubic-bezier(.3,0,.2,1)', 'cubic-bezier(.6,0,.15,1)', 'linear'] : ['cubic-bezier(.32,0,.08,1)', 'linear'],
  }
  if (!direct && dir === 'out') kf.opacity = [1, 0]
  document.documentElement.animate(kf as unknown as Keyframe[], {
    duration: dir === 'in' ? PLAY_MS : LEAVE_MS,
    pseudoElement: '::view-transition-group(flick-play)',
    fill: 'both',
  })
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
      let to: DOMRect | null = null
      const titleId = document.querySelector<HTMLElement>('.player')?.dataset.title
      const update = async () => {
        flushSync(() => setHash(next))
        scrollTo(0, back ? (scrolls.get(next) ?? 0) : 0)
        // let anything that depends on the scroll position (the top bar) settle before the new page shows
        flushSync(() => dispatchEvent(new Event('scroll')))
        if (leaving) {
          // land back on the card for what was playing, or failing that one for the same show, when it's on screen
          const id = prev.split('/')[2]
          const banner = (c: Element) => (c.matches('.hero, .title-hero') ? 1 : 0)
          const cards = [...document.querySelectorAll(`[data-file="${id}"]`), ...(titleId ? document.querySelectorAll(`[data-title="${titleId}"]`) : [])]
          // a card first, the page's big banner only when there's no card
          cards.sort((a, b) => banner(a) - banner(b))
          for (const c of cards) {
            const img = c.querySelector('img') ?? c
            const r = img.getBoundingClientRect()
            if (img instanceof HTMLElement && onScreen(r)) {
              img.style.viewTransitionName = 'flick-play'
              to = r
              break
            }
          }
        }
        await imagesReady(400)
      }
      if (!document.startViewTransition) return void update()
      document.documentElement.dataset.nav = entering ? (fromButton && from ? 'expand' : from ? 'play' : zoom ? 'zoom' : 'page') : leaving ? 'leave' : 'page'
      const button = fromButton ?? undefined
      zoom = false
      fromButton = null
      // the top bar stays put only when both pages have it; otherwise it goes with the page it belongs to
      const bar = (h: string) => !/^#\/(play|title)\//.test(h)
      document.documentElement.dataset.bar = bar(prev) && bar(next) ? 'keep' : ''
      const vt = document.startViewTransition(update)
      const start = from
      from = null
      // a transition that gets cut short (another navigation, a resize) still lands on the new page
      vt.ready.then(() => (entering && start ? fly(start, 'in', button) : leaving ? fly(to, 'out') : undefined)).catch(() => undefined)
      vt.finished.finally(() => {
        delete document.documentElement.dataset.nav
        document.querySelectorAll<HTMLElement>('[style*="view-transition-name"]').forEach((el) => (el.style.viewTransitionName = ''))
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

// ---------- fullscreen ----------
/** Whether the window is fullscreen, kept in sync with the main process. */
export function useFullscreen() {
  const [fs, setFs] = useState(false)
  useEffect(() => {
    api.windowState().then((s) => setFs(s.fullscreen))
    return api.on('window:fullscreen', (on) => setFs(on as boolean))
  }, [])
  return fs
}

export const toggleFullscreen = () => api.windowState().then((s) => api.setFullscreen(!s.fullscreen))

export function go(hash: string) {
  if (location.hash !== hash) location.hash = hash
}

// ---------- window buttons ----------
function WindowControls() {
  const fs = useFullscreen()
  const [max, setMax] = useState(true)
  useEffect(() => {
    api.windowState().then((s) => setMax(s.maximized))
    return api.on('window:maximized', (m) => setMax(m as boolean))
  }, [])
  return (
    <div className={`wctl${fs ? ' fs' : ''}`}>
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

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return
      if ((e.target as HTMLElement).closest?.('input, textarea, select') || location.hash.startsWith('#/search')) return
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        toggleFullscreen()
      } else if (e.key === 'Escape' && !location.hash.startsWith('#/play/')) api.setFullscreen(false)
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [])

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
      {route !== 'play' && <WindowControls />}
    </AppCtx.Provider>
  )
}

function Header({ route }: { route: string }) {
  const { queue } = useApp()
  const [solid, setSolid] = useState(() => scrollY > 40)
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
          {!route && <span className="nav-ind" />}
        </button>
        <button className={route === 'movies' ? 'on' : ''} onClick={() => go('#/movies')}>
          Movies
          {route === 'movies' && <span className="nav-ind" />}
        </button>
        <button className={route === 'shows' ? 'on' : ''} onClick={() => go('#/shows')}>
          Shows
          {route === 'shows' && <span className="nav-ind" />}
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
