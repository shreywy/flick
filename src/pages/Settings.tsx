import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { QueueItem, QueueStatus } from '../../shared/types'
import { api, type AppSettings } from '../api'
import { go, useApp } from '../App'
import FixMatch from '../FixMatch'
import { Alert, Check, Spinner } from '../icons'

const SECTIONS = [
  ['library', 'Library'],
  ['queue', 'Sorting queue'],
  ['subtitles', 'Subtitles'],
  ['playback', 'Playback'],
  ['keys', 'API keys'],
  ['about', 'About'],
] as const

export default function SettingsPage({ section }: { section: string }) {
  const { queue } = useApp()
  const left = queue ? queue.counts.waiting + queue.counts.working + queue.counts.attention + queue.counts.downloading : 0
  let pane: ReactNode
  if (section === 'queue') pane = <QueuePane />
  else if (section === 'subtitles') pane = <SubtitlesPane />
  else if (section === 'playback') pane = <PlaybackPane />
  else if (section === 'keys') pane = <KeysPane />
  else if (section === 'about') pane = <AboutPane />
  else pane = <LibraryPane />
  return (
    <main className="page">
      <div className="settings">
        <aside className="side">
          <h1>Settings</h1>
          {SECTIONS.map(([id, name]) => (
            <button key={id} className={section === id || (id === 'library' && !SECTIONS.some((s) => s[0] === section)) ? 'on' : ''} onClick={() => go(`#/settings/${id}`)}>
              {name}
              {id === 'queue' && left > 0 && <span className="count">{left}</span>}
            </button>
          ))}
        </aside>
        <section className="pane">{pane}</section>
      </div>
    </main>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      <span>{label}</span>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`toggle${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
}

/** Text setting that saves on blur or Enter. */
function TextSetting({ k, type = 'text', placeholder }: { k: keyof AppSettings; type?: string; placeholder?: string }) {
  const { settings, saveSettings } = useApp()
  const [v, setV] = useState(String(settings[k] ?? ''))
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    setV(String(settings[k] ?? ''))
  }, [settings, k])
  const commit = async () => {
    if (v === String(settings[k] ?? '')) return
    await saveSettings({ [k]: v.trim() } as Partial<AppSettings>)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }
  return (
    <>
      <input
        className="input"
        type={type}
        value={v}
        placeholder={placeholder}
        spellCheck={false}
        aria-label={String(k)}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      <span className="ok">{saved ? 'Saved' : ''}</span>
    </>
  )
}

function LibraryPane() {
  const { lib, settings, refresh } = useApp()
  const [busy, setBusy] = useState(false)
  const movies = lib.titles.filter((t) => t.kind === 'movie').length
  const shows = lib.titles.filter((t) => t.kind === 'show')
  const eps = shows.reduce((n, s) => n + (s.episodes?.length ?? 0), 0)
  return (
    <>
      <h2>Library</h2>
      <p className="lead">
        {movies} movies and {shows.length} shows ({eps} episodes). Flick reads {settings.mediaRoot}\Movies and {settings.mediaRoot}\TV Shows, and sorts new downloads from {settings.mediaRoot}\Shows and Movies.
      </p>
      <Field label="Media folder" hint="Holds the Movies, TV Shows and Shows and Movies folders.">
        <TextSetting k="mediaRoot" />
      </Field>
      <div>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await api.rescan()
            await refresh()
            setBusy(false)
          }}
        >
          {busy ? <Spinner /> : null}
          Scan now
        </button>
      </div>
    </>
  )
}

const TABS: [string, string, (s: QueueStatus) => boolean][] = [
  ['all', 'All', () => true],
  ['working', 'Working', (s) => s === 'working'],
  ['waiting', 'Waiting', (s) => s === 'waiting' || s === 'downloading'],
  ['attention', 'Needs a look', (s) => s === 'attention'],
  ['done', 'Done', (s) => s === 'done'],
]

function QueuePane() {
  const { queue, settings, saveSettings } = useApp()
  const [tab, setTab] = useState('all')
  const [fixing, setFixing] = useState<QueueItem | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [height, setHeight] = useState(600)
  const items = useMemo(() => (queue?.items ?? []).filter((i) => TABS.find((t) => t[0] === tab)![2](i.status)), [queue, tab])

  useEffect(() => {
    const el = list.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!queue) return <Spinner />
  const c = queue.counts
  const total = c.all
  const done = c.done
  const rowH = parseFloat(getComputedStyle(document.documentElement).fontSize) * 3.15
  const first = Math.max(0, Math.floor(scroll / rowH) - 5)
  const visible = items.slice(first, first + Math.ceil(height / rowH) + 10)
  const count = (key: string) => (key === 'all' ? c.all : key === 'waiting' ? c.waiting + c.downloading : c[key as QueueStatus])

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.2rem' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <h2>Sorting queue</h2>
          <p className="lead">
            Anything that lands in {settings.mediaRoot}\Shows and Movies gets moved into Movies or TV Shows, then gets artwork, info and English subtitles. Flick checks when it opens and every 5 minutes while it's open. Files changed in the last 10 minutes are left until the download finishes.
          </p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', fontSize: '0.9rem', whiteSpace: 'nowrap', paddingTop: '0.4rem' }}>
          Sort automatically
          <Toggle on={settings.sortAuto} onChange={(v) => saveSettings({ sortAuto: v })} label="Sort automatically" />
        </label>
        <button className="btn small" onClick={() => api.pauseQueue(!queue.paused)}>
          {queue.paused ? 'Resume' : 'Pause'}
        </button>
      </div>

      {total > 0 && (
        <div className="qbar">
          <div className="track">
            <div style={{ width: `${(done / total) * 100}%` }} />
          </div>
          <span>
            {done} of {total} done
          </span>
          {queue.paused && <span className="warn">Paused</span>}
        </div>
      )}

      <div className="qtabs">
        {TABS.map(([key, name]) => (
          <button key={key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
            {name}
            <span className="n">{count(key)}</span>
          </button>
        ))}
      </div>

      <div className="q head">
        <span>File</span>
        <span>Goes to</span>
        <span>Status</span>
      </div>
      <div className="qlist" ref={list} onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
        {!items.length && <div className="empty" style={{ padding: '3rem 0' }}>{total ? 'Nothing here.' : 'Nothing to sort. New downloads show up here.'}</div>}
        <div style={{ height: items.length * rowH, position: 'relative' }}>
          {visible.map((it, i) => (
            <div key={it.id} className="q" style={{ position: 'absolute', top: (first + i) * rowH, left: 0, right: 0 }}>
              <span title={it.name}>{it.name}</span>
              <span className="dest" title={it.target}>
                {it.target ?? (it.status === 'attention' ? 'No match yet' : '')}
              </span>
              <Status it={it} onFix={() => setFixing(it)} />
            </div>
          ))}
        </div>
      </div>
      {fixing && (
        <FixMatch
          initial={fixing.name.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]/g, ' ').replace(/\b(1080p|2160p|720p|4k|web|webrip|bluray|x264|x265|h264|hevc).*$/i, '').trim()}
          kind={fixing.target?.startsWith('TV Shows') ? 'show' : 'movie'}
          onClose={() => setFixing(null)}
          onPick={(c) => {
            api.fixQueue(fixing.id, { tmdbId: c.id, kind: c.kind, title: c.title, year: c.year })
            setFixing(null)
          }}
        />
      )}
    </>
  )
}

function Status({ it, onFix }: { it: QueueItem; onFix: () => void }) {
  if (it.status === 'working')
    return (
      <span className="st">
        <Spinner />
        {it.message ?? 'Working'}
      </span>
    )
  if (it.status === 'attention')
    return (
      <span className="st warn" title={it.message}>
        <Alert />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.message ?? 'Needs a look'}</span>
        {it.action === 'fix' && (
          <button className="btn small" onClick={onFix}>
            Fix match
          </button>
        )}
        {it.action === 'subs' && (
          <button className="btn small" onClick={() => api.retryQueue(it.id)}>
            Search again
          </button>
        )}
      </span>
    )
  if (it.status === 'done')
    return (
      <span className="st" style={{ color: 'var(--muted)' }}>
        <Check size={18} />
        {it.message ?? 'Done'}
      </span>
    )
  return (
    <span className="st" style={{ color: it.status === 'downloading' ? 'var(--faint)' : 'var(--muted)' }} title={it.message}>
      {it.message ?? 'Waiting'}
    </span>
  )
}

function SubtitlesPane() {
  const { settings, saveSettings } = useApp()
  const providers = [settings.osKey && 'OpenSubtitles', settings.subdlKey && 'SubDL'].filter(Boolean)
  return (
    <>
      <h2>Subtitles</h2>
      <p className="lead">
        {providers.length
          ? `English subtitles come from ${providers.join(' and ')}.`
          : 'Add an OpenSubtitles or SubDL key under API keys to download subtitles. Subtitles already in your files work without one.'}
      </p>
      <Field label="Download automatically" hint="For new files with no English subtitles of their own.">
        <Toggle on={settings.autoSubs} onChange={(v) => saveSettings({ autoSubs: v })} label="Download subtitles automatically" />
      </Field>
      <Field label="OpenSubtitles username" hint="Optional. Logging in raises the daily download limit.">
        <TextSetting k="osUser" />
      </Field>
      <Field label="OpenSubtitles password">
        <TextSetting k="osPass" type="password" />
      </Field>
      <p className="lead">Size, colours, outline, shadow and position are set from the captions button while something is playing.</p>
    </>
  )
}

function PlaybackPane() {
  const { settings, saveSettings } = useApp()
  return (
    <>
      <h2>Playback</h2>
      <Field label="Play next episode" hint="Starts the next episode 10 seconds after one ends.">
        <Toggle on={settings.autoplayNext} onChange={(v) => saveSettings({ autoplayNext: v })} label="Play next episode automatically" />
      </Field>
      <Field label="Skip buttons">
        <div className="seg" style={{ maxWidth: '18rem' }}>
          {[5, 10, 15, 30].map((s) => (
            <button key={s} className={settings.skipSeconds === s ? 'on' : ''} onClick={() => saveSettings({ skipSeconds: s })}>
              {s}s
            </button>
          ))}
        </div>
      </Field>
      <Field label="Counts as watched at">
        <div className="seg" style={{ maxWidth: '18rem' }}>
          {[0.85, 0.9, 0.92, 0.95].map((s) => (
            <button key={s} className={settings.watchedAt === s ? 'on' : ''} onClick={() => saveSettings({ watchedAt: s })}>
              {Math.round(s * 100)}%
            </button>
          ))}
        </div>
      </Field>
      <Field label="ffmpeg folder" hint="The folder with ffmpeg.exe and ffprobe.exe. Leave empty to use the one on PATH.">
        <TextSetting k="ffmpegDir" />
      </Field>
    </>
  )
}

function KeysPane() {
  const { settings } = useApp()
  const [test, setTest] = useState<'idle' | 'busy' | 'ok' | 'bad'>('idle')
  return (
    <>
      <h2>API keys</h2>
      <p className="lead">Keys are stored encrypted for your Windows account.</p>
      <Field
        label="TMDB"
        hint={
          <>
            Posters, backdrops and info. Free from{' '}
            <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
              themoviedb.org/settings/api
            </a>
            . The API key or the read access token both work.
          </>
        }
      >
        <TextSetting k="tmdbKey" type="password" />
      </Field>
      <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
        <button
          className="btn small"
          onClick={async () => {
            setTest('busy')
            setTest((await api.testTmdb(settings.tmdbKey)) ? 'ok' : 'bad')
          }}
        >
          Test TMDB key
        </button>
        {test === 'busy' && <Spinner />}
        {test === 'ok' && <span className="ok">Works</span>}
        {test === 'bad' && <span className="warn">TMDB didn't accept that key</span>}
      </div>
      <Field
        label="OpenSubtitles"
        hint={
          <>
            Free consumer key from{' '}
            <a href="https://www.opensubtitles.com/en/consumers" target="_blank" rel="noreferrer">
              opensubtitles.com/consumers
            </a>
            . 5 downloads a day, 20 if you also add your login under Subtitles.
          </>
        }
      >
        <TextSetting k="osKey" type="password" />
      </Field>
      <Field
        label="SubDL"
        hint={
          <>
            Free key from{' '}
            <a href="https://subdl.com/panel/api" target="_blank" rel="noreferrer">
              subdl.com/panel/api
            </a>
            . Used alongside OpenSubtitles, or on its own.
          </>
        }
      >
        <TextSetting k="subdlKey" type="password" />
      </Field>
    </>
  )
}

function AboutPane() {
  const [version, setVersion] = useState('')
  useEffect(() => {
    api.init().then((r) => setVersion(r.version))
  }, [])
  return (
    <>
      <h2>About</h2>
      <p className="lead">Flick {version}. Movie and show data from TMDB. Subtitles from OpenSubtitles and SubDL.</p>
      <div>
        <button className="btn small" onClick={() => api.openLog()}>
          Open log file
        </button>
      </div>
    </>
  )
}
