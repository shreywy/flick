// Right-click menu for the whole app. What it offers depends on what was clicked: a Continue watching card,
// a poster, an episode, the player, a text box, or empty space.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Title } from '../shared/types'
import { api } from './api'
import { go, goBack, play, toggleFullscreen, useApp, useFullscreen } from './App'
import { isWatched, showResume } from './lib'

type Item = { label: string; hint?: string; run: () => void; danger?: boolean } | 'sep'
interface Open {
  x: number
  y: number
  items: Item[]
}
interface Toast {
  text: string
  undo: () => void
}

/** Send a key to the player as if it were pressed. */
const key = (k: string) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))

export default function ContextMenu() {
  const { lib, byId, byFile, settings, saveSettings, refresh } = useApp()
  const fs = useFullscreen()
  const [open, setOpen] = useState<Open | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0, ox: 'left', oy: 'top' })
  const ref = useRef<HTMLDivElement>(null)

  // latest values for the native listener
  const ctx = useRef({ lib, byId, byFile, settings, saveSettings, refresh, fs })
  ctx.current = { lib, byId, byFile, settings, saveSettings, refresh, fs }

  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      e.preventDefault()
      const items = itemsFor(e.target as HTMLElement, ctx.current, setToast)
      if (items.length) setOpen({ x: e.clientX, y: e.clientY, items })
    }
    addEventListener('contextmenu', onMenu)
    return () => removeEventListener('contextmenu', onMenu)
  }, [])

  // keep it on screen, opening away from the edges it would hit
  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const flipX = open.x + r.width > innerWidth - 8
    const flipY = open.y + r.height > innerHeight - 8
    setPos({
      x: flipX ? Math.max(8, open.x - r.width) : open.x,
      y: flipY ? Math.max(8, open.y - r.height) : open.y,
      ox: flipX ? 'right' : 'left',
      oy: flipY ? 'bottom' : 'top',
    })
    ref.current.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(null)
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close()
    const keys = (e: KeyboardEvent) => {
      const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      const i = btns.indexOf(document.activeElement as HTMLButtonElement)
      // the menu has the keyboard while it's open: Esc here mustn't also leave the player, Space mustn't pause it
      e.stopPropagation()
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowDown') btns[(i + 1) % btns.length]?.focus()
      else if (e.key === 'ArrowUp') btns[(i - 1 + btns.length) % btns.length]?.focus()
      else return // Enter / Space still press the focused item
      e.preventDefault()
    }
    addEventListener('mousedown', down, true)
    addEventListener('keydown', keys, true)
    addEventListener('wheel', close, { passive: true })
    addEventListener('resize', close)
    addEventListener('blur', close)
    addEventListener('hashchange', close)
    return () => {
      removeEventListener('mousedown', down, true)
      removeEventListener('keydown', keys, true)
      removeEventListener('wheel', close)
      removeEventListener('resize', close)
      removeEventListener('blur', close)
      removeEventListener('hashchange', close)
    }
  }, [open])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <>
      {open && (
        <div
          ref={ref}
          className="cmenu"
          role="menu"
          style={{ left: pos.x, top: pos.y, transformOrigin: `${pos.oy} ${pos.ox}` }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {open.items.map((it, i) =>
            it === 'sep' ? (
              <div key={i} className="sep" role="separator" />
            ) : (
              <button
                key={i}
                role="menuitem"
                className={it.danger ? 'danger' : ''}
                onClick={() => {
                  setOpen(null)
                  it.run()
                }}
              >
                <span>{it.label}</span>
                {it.hint && <span className="hint">{it.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          <button
            onClick={() => {
              toast.undo()
              setToast(null)
            }}
          >
            Undo
          </button>
        </div>
      )}
    </>
  )
}

type Ctx = {
  lib: ReturnType<typeof useApp>['lib']
  byId: Map<number, Title>
  byFile: Map<number, Title>
  settings: ReturnType<typeof useApp>['settings']
  saveSettings: ReturnType<typeof useApp>['saveSettings']
  refresh: () => Promise<void>
  fs: boolean
}

function itemsFor(el: HTMLElement, c: Ctx, toast: (t: Toast) => void): Item[] {
  const input = el.closest<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
  if (input) {
    const cmd = (name: 'cut' | 'copy' | 'paste' | 'selectAll') => () => {
      input.focus()
      api.edit(name)
    }
    return [
      { label: 'Cut', hint: 'Ctrl+X', run: cmd('cut') },
      { label: 'Copy', hint: 'Ctrl+C', run: cmd('copy') },
      { label: 'Paste', hint: 'Ctrl+V', run: cmd('paste') },
      'sep',
      { label: 'Select all', hint: 'Ctrl+A', run: cmd('selectAll') },
    ]
  }

  if (el.closest('.player')) {
    const v = document.querySelector('video')
    return [
      { label: v && !v.paused ? 'Pause' : 'Play', hint: 'Space', run: () => key(' ') },
      { label: 'Subtitles, audio and picture', hint: 'C', run: () => key('c') },
      { label: c.fs ? 'Exit fullscreen' : 'Fullscreen', hint: 'F', run: toggleFullscreen },
      'sep',
      { label: 'Back', hint: 'Esc', run: () => key('Escape') },
    ]
  }

  const row = el.closest<HTMLElement>('[data-row]')?.dataset.row
  const fileOf = (x: HTMLElement | null) => (x?.dataset.file ? Number(x.dataset.file) : undefined)
  const hide = {
    resume: (t: Title) => {
      const before = c.settings.hiddenResume ?? {}
      c.saveSettings({ hiddenResume: { ...before, [t.id]: Date.now() } })
      toast({ text: `Removed ${t.name} from Continue watching`, undo: () => c.saveSettings({ hiddenResume: before }) })
    },
    recent: (t: Title) => {
      const before = c.settings.hiddenRecent ?? []
      c.saveSettings({ hiddenRecent: [...before, t.id] })
      toast({ text: `Removed ${t.name} from Recently added`, undo: () => c.saveSettings({ hiddenRecent: before }) })
    },
  }
  const mark = (ids: number[], watched: boolean) => () => api.markWatched(ids, watched).then(c.refresh)

  // a Continue watching card
  const thumb = el.closest<HTMLElement>('.thumb[data-file]')
  const thumbFile = fileOf(thumb)
  if (thumb && thumbFile) {
    const t = c.byFile.get(thumbFile)
    if (!t) return []
    const p = c.lib.progress[thumbFile]
    return [
      { label: p && p.position > 5 ? 'Resume' : 'Play', run: () => play(thumbFile, thumb) },
      { label: 'Play from the start', run: () => play(thumbFile, thumb, true) },
      { label: 'Details', run: () => go(`#/title/${t.id}`) },
      { label: 'Mark as watched', run: mark([thumbFile], true) },
      ...(row === 'resume' ? (['sep', { label: 'Remove from Continue watching', danger: true, run: () => hide.resume(t) }] as Item[]) : []),
    ]
  }

  // an episode on a show's page
  const ep = el.closest<HTMLElement>('.ep[data-file]')
  const epFile = fileOf(ep)
  if (ep && epFile) {
    const t = c.byFile.get(epFile)
    const e = t?.episodes?.find((x) => x.fileId === epFile)
    const p = c.lib.progress[epFile]
    return [
      { label: p && !p.watched && p.position > 5 ? 'Resume' : 'Play', run: () => play(epFile, ep) },
      { label: 'Play from the start', run: () => play(epFile, ep, true) },
      { label: p?.watched ? 'Mark as unwatched' : 'Mark as watched', run: mark([epFile], !p?.watched) },
      ...(e ? (['sep', { label: 'Show in File Explorer', run: () => api.showFile(e.path) }] as Item[]) : []),
    ]
  }

  // a poster
  const poster = el.closest<HTMLElement>('.poster[data-title]')
  if (poster) {
    const t = c.byId.get(Number(poster.dataset.title))
    if (!t) return []
    const files = t.kind === 'movie' ? (t.fileId ? [t.fileId] : []) : (t.episodes ?? []).map((e) => e.fileId)
    const playFile = t.kind === 'movie' ? t.fileId : (showResume(t, c.lib)?.fileId ?? t.episodes?.[0]?.fileId)
    const seen = isWatched(t, c.lib)
    const items: Item[] = [
      { label: 'Open', run: () => go(`#/title/${t.id}`) },
      ...(playFile ? [{ label: 'Play', run: () => play(playFile, poster) }] : []),
      ...(files.length ? [{ label: seen ? 'Mark as unwatched' : 'Mark as watched', run: mark(files, !seen) }] : []),
      'sep',
      { label: 'Show in File Explorer', run: () => api.showFile(t.path ?? t.folder) },
    ]
    if (row === 'recent') items.push('sep', { label: 'Remove from Recently added', danger: true, run: () => hide.recent(t) })
    return items
  }

  // anywhere else
  const home = !location.hash || location.hash === '#/'
  return [
    ...(home ? [] : [{ label: 'Back', run: goBack }]),
    { label: 'Home', run: () => go('#/') },
    { label: 'Search', run: () => go('#/search') },
    'sep',
    { label: c.fs ? 'Exit fullscreen' : 'Fullscreen', hint: 'F', run: toggleFullscreen },
    { label: 'Look for new files', run: () => api.rescan().then(c.refresh) },
    { label: 'Settings', run: () => go('#/settings') },
  ]
}
