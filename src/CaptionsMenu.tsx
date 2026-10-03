import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SUB_STYLE, type PlayInfo, type SubStyle, type SubTrack } from '../shared/types'
import { api, type Quota, type SubCandidate } from './api'
import { useApp } from './App'
import { Check, Chevron, Download, Search, Spinner } from './icons'

const FONTS = ['Schibsted Grotesk', 'Arial', 'Verdana', 'Georgia', 'Trebuchet MS']
const TEXT_COLORS = [
  ['#FFFFFF', 'White'],
  ['#F5D94A', 'Yellow'],
  ['#BDBAB4', 'Light grey'],
  ['#7FD6E8', 'Cyan'],
]
const BG_COLORS = [
  ['none', 'None'],
  ['#000000', 'Black'],
  ['#3A3A3C', 'Dark grey'],
  ['#FFFFFF', 'White'],
]
const CODEC: Record<string, string> = { aac: 'AAC', ac3: 'Dolby Digital', eac3: 'Dolby Digital+', dts: 'DTS', truehd: 'TrueHD', opus: 'Opus', flac: 'FLAC', mp3: 'MP3' }
const LANG: Record<string, string> = { eng: 'English', en: 'English', jpn: 'Japanese', ja: 'Japanese', spa: 'Spanish', fre: 'French', fra: 'French', ger: 'German', ita: 'Italian', kor: 'Korean', chi: 'Chinese', por: 'Portuguese', rus: 'Russian', hin: 'Hindi' }
const ch = (n?: number) => (n === 6 ? '5.1' : n === 8 ? '7.1' : n === 2 ? 'Stereo' : n === 1 ? 'Mono' : '')

interface Props {
  info: PlayInfo
  track?: string
  onTrack: (id: string | undefined) => void
  audio: number
  onAudio: (i: number) => void
  delay: number
  onDelay: (d: number) => void
  onNewTrack: (t: SubTrack) => void
  isAss: boolean
  zoomMode: 'fit' | 'fill' | 'zoom'
  zoomPct: number
  hasBars: boolean
  onZoom: (m: 'fit' | 'fill' | 'zoom', pct?: number) => void
}

export default function CaptionsMenu(p: Props) {
  const [view, setView] = useState<'main' | 'style' | 'find'>('main')
  const [tab, setTab] = useState<'subs' | 'audio' | 'picture'>('subs')
  const { settings } = useApp()
  if (view === 'style') return <StyleView {...p} back={() => setView('main')} />
  if (view === 'find') return <FindView {...p} back={() => setView('main')} />
  const st = settings.subStyle
  const usable = p.info.subs

  return (
    <div className="menu" role="dialog" aria-label="Subtitles and audio" onMouseDown={(e) => e.stopPropagation()}>
      <div className="menu-tabs">
        <button className={tab === 'subs' ? 'on' : ''} onClick={() => setTab('subs')}>
          Subtitles
        </button>
        <button className={tab === 'audio' ? 'on' : ''} onClick={() => setTab('audio')}>
          Audio
        </button>
        <button className={tab === 'picture' ? 'on' : ''} onClick={() => setTab('picture')}>
          Picture
        </button>
      </div>
      {tab === 'picture' ? (
        <>
          <button className={`mrow${p.zoomMode === 'fit' ? ' sel' : ''}`} onClick={() => p.onZoom('fit')}>
            <span className={`radio${p.zoomMode === 'fit' ? ' on' : ''}`} />
            <span className="col">
              <span>Fit</span>
              <span className="sub">Whole frame, black bars included</span>
            </span>
          </button>
          <button className={`mrow${p.zoomMode === 'fill' ? ' sel' : ''}`} onClick={() => p.onZoom('fill')}>
            <span className={`radio${p.zoomMode === 'fill' ? ' on' : ''}`} />
            <span className="col">
              <span>Fill screen</span>
              <span className="sub">{p.hasBars ? 'Trims the black bars in this file, nothing stretched' : 'Fills as much of the screen as the picture allows'}</span>
            </span>
          </button>
          <div className={`mrow${p.zoomMode === 'zoom' ? ' sel' : ''}`} style={{ cursor: 'default' }}>
            <button className={`radio${p.zoomMode === 'zoom' ? ' on' : ''}`} aria-label="Manual zoom" style={{ background: 'none', padding: 0 }} onClick={() => p.onZoom('zoom', p.zoomPct)} />
            <span className="col">
              <span>Zoom</span>
              <span className="sub">Crops the edges</span>
            </span>
            <button className="step" aria-label="Zoom out" onClick={() => p.onZoom('zoom', p.zoomPct - 5)}>
              −
            </button>
            <span style={{ width: '2.6rem', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{p.zoomPct}%</span>
            <button className="step" aria-label="Zoom in" onClick={() => p.onZoom('zoom', p.zoomPct + 5)}>
              +
            </button>
          </div>
          <div className="mnote" style={{ paddingTop: '0.4rem' }}>
            <span>Ctrl + scroll to zoom, Z to switch Fit and Fill</span>
          </div>
        </>
      ) : tab === 'subs' ? (
        <>
          <button className={`mrow${!p.track ? ' sel' : ''}`} onClick={() => p.onTrack(undefined)}>
            <span className={`radio${!p.track ? ' on' : ''}`} />
            Off
          </button>
          {usable.map((t) => (
            <button key={t.id} className={`mrow${p.track === t.id ? ' sel' : ''}`} disabled={t.format === 'image'} onClick={() => p.onTrack(t.id)}>
              <span className={`radio${p.track === t.id ? ' on' : ''}`} />
              <span className="col">
                <span>{t.label}</span>
                {t.detail && (
                  <span className="sub rel" title={t.detail}>
                    {t.detail}
                  </span>
                )}
              </span>
            </button>
          ))}
          <div className="mdiv" />
          <button className="mrow" onClick={() => setView('style')}>
            Style and timing
            <span className="val">
              {st.size}px · {p.delay >= 0 ? '+' : ''}
              {p.delay.toFixed(1)}s
            </span>
            <Chevron size={14} />
          </button>
          <button className="mrow" onClick={() => setView('find')}>
            Find more subtitles
            <span className="val" />
            <Chevron size={14} />
          </button>
        </>
      ) : (
        p.info.audio.map((a, i) => (
          <button key={i} className={`mrow${p.audio === i ? ' sel' : ''}`} onClick={() => p.onAudio(i)}>
            <span className={`radio${p.audio === i ? ' on' : ''}`} />
            <span className="col">
              <span>{a.title && !/^(stereo|surround|5\.1)$/i.test(a.title) ? a.title : LANG[a.language ?? ''] ?? (a.language ? a.language.toUpperCase() : `Track ${i + 1}`)}</span>
              <span className="sub">
                {[CODEC[a.codec] ?? a.codec.toUpperCase(), ch(a.channels), p.info.audioNeedsConvert[i] ? 'converted while playing' : ''].filter(Boolean).join(' · ')}
              </span>
            </span>
          </button>
        ))
      )}
    </div>
  )
}

function Stepper({ label, value, onChange, step, min, max, fmt }: { label: string; value: number; onChange: (v: number) => void; step: number; min: number; max: number; fmt: (v: number) => string }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 100) / 100)))
  return (
    <div className="mfield">
      <span className="lab">{label}</span>
      <button className="step" aria-label={`Less ${label.toLowerCase()}`} onClick={() => set(value - step)}>
        −
      </button>
      <span className="num">{fmt(value)}</span>
      <button className="step" aria-label={`More ${label.toLowerCase()}`} onClick={() => set(value + step)}>
        +
      </button>
    </div>
  )
}

function StyleView(p: Props & { back: () => void }) {
  const { settings, saveSettings } = useApp()
  const [st, setSt] = useState<SubStyle>(settings.subStyle)
  const save = useRef<ReturnType<typeof setTimeout>>(undefined)
  const set = (patch: Partial<SubStyle>) => {
    const next = { ...st, ...patch }
    setSt(next)
    window.dispatchEvent(new CustomEvent('flick:substyle', { detail: next }))
    clearTimeout(save.current)
    save.current = setTimeout(() => saveSettings({ subStyle: next }), 300)
  }
  const locked = p.isAss
  return (
    <div className="menu" role="dialog" aria-label="Style and timing" onMouseDown={(e) => e.stopPropagation()}>
      <div className="menu-head">
        <button className="ctl" style={{ width: '1.6rem', height: '1.6rem' }} aria-label="Back" onClick={p.back}>
          <Chevron dir="left" size={16} />
        </button>
        Style and timing
      </div>
      {locked && <div className="mnote" style={{ paddingBottom: '0.4rem' }}>This track has its own styling. Only delay applies.</div>}
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, opacity: locked ? 0.45 : 1, display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
        <Stepper label="Size" value={st.size} step={2} min={16} max={120} onChange={(v) => set({ size: v })} fmt={(v) => `${v} px`} />
        <div className="mfield">
          <span className="lab">Font</span>
          <select className="select" value={st.font} onChange={(e) => set({ font: e.target.value })} aria-label="Font">
            {FONTS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </div>
        <div className="mfield">
          <span className="lab">Text</span>
          {TEXT_COLORS.map(([c, name]) => (
            <button key={c} className={`sw${st.color === c ? ' on' : ''}`} style={{ background: c }} aria-label={name} onClick={() => set({ color: c })} />
          ))}
        </div>
        <div className="mfield">
          <span className="lab">Background</span>
          {BG_COLORS.map(([c, name]) => (
            <button
              key={c}
              className={`sw${c === 'none' ? ' none' : ''}${st.background === c ? ' on' : ''}`}
              style={{ background: c === 'none' ? 'transparent' : c, borderColor: c === 'none' && st.background !== c ? '#5a5751' : undefined }}
              aria-label={name}
              onClick={() => set({ background: c })}
            />
          ))}
        </div>
        <div className="mfield">
          <span className="lab">Opacity</span>
          <input className="range" type="range" min={0} max={100} value={Math.round(st.bgOpacity * 100)} onChange={(e) => set({ bgOpacity: Number(e.target.value) / 100 })} aria-label="Background opacity" />
          <span className="pct">{Math.round(st.bgOpacity * 100)}%</span>
        </div>
        <div className="mfield">
          <span className="lab">Outline</span>
          <button className="step" aria-label="Thinner outline" onClick={() => set({ outline: Math.max(0, st.outline - 1) })}>
            −
          </button>
          <span className="num">{st.outline} px</span>
          <button className="step" aria-label="Thicker outline" onClick={() => set({ outline: Math.min(8, st.outline + 1) })}>
            +
          </button>
          <button className={`sw${st.outlineColor === '#000000' ? ' on' : ''}`} style={{ background: '#000', borderColor: st.outlineColor === '#000000' ? undefined : '#5a5751' }} aria-label="Black outline" onClick={() => set({ outlineColor: '#000000' })} />
          <button className={`sw${st.outlineColor === '#FFFFFF' ? ' on' : ''}`} style={{ background: '#fff' }} aria-label="White outline" onClick={() => set({ outlineColor: '#FFFFFF' })} />
        </div>
        <div className="mfield">
          <span className="lab">Shadow</span>
          <div className="seg">
            {(['none', 'soft', 'strong'] as const).map((s) => (
              <button key={s} className={st.shadow === s ? 'on' : ''} onClick={() => set({ shadow: s })}>
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="mfield">
          <span className="lab">Position</span>
          <input className="range" type="range" min={2} max={40} value={st.position} onChange={(e) => set({ position: Number(e.target.value) })} aria-label="Height from the bottom" />
          <span className="pct">{st.position}%</span>
        </div>
      </fieldset>
      <div className="mdiv" />
      <Stepper label="Delay" value={p.delay} step={0.1} min={-60} max={60} onChange={p.onDelay} fmt={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}s`} />
      <div className="mnote">
        <span>[ and ] change delay while watching</span>
        <button onClick={() => (set({ ...DEFAULT_SUB_STYLE }), p.onDelay(0))}>Reset</button>
      </div>
    </div>
  )
}

function FindView(p: Props & { back: () => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SubCandidate[] | null>(null)
  const [error, setError] = useState<string>()
  const [quota, setQuota] = useState<Quota>()
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())
  const have = (c: SubCandidate) => c.have || done.has(c.key)

  const run = (query?: string) => {
    setResults(null)
    setError(undefined)
    api
      .searchSubs(p.info.fileId, query)
      .then((r) => {
        setResults(r.results)
        setError(r.error)
        if (r.quota) setQuota(r.quota)
      })
      .catch((e: Error) => {
        setResults([])
        setError(e.message)
      })
  }
  useEffect(() => {
    run()
  }, [])

  const get = async (c: SubCandidate) => {
    setBusy(c.key)
    try {
      const r = await api.downloadSub(p.info.fileId, c)
      if (r.quota) setQuota(r.quota)
      if (r.track) {
        p.onNewTrack(r.track)
        setDone((d) => new Set(d).add(c.key))
      }
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="menu" role="dialog" aria-label="Find more subtitles" onMouseDown={(e) => e.stopPropagation()}>
      <div className="menu-head">
        <button className="ctl" style={{ width: '1.6rem', height: '1.6rem' }} aria-label="Back" onClick={p.back}>
          <Chevron dir="left" size={16} />
        </button>
        Find more subtitles
      </div>
      <form
        className="msearch"
        onSubmit={(e) => {
          e.preventDefault()
          run(q.trim() || undefined)
        }}
      >
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, or leave empty for this file" aria-label="Search subtitles" />
      </form>
      {!results && (
        <div className="mfield" style={{ justifyContent: 'center' }}>
          <Spinner size={18} />
        </div>
      )}
      <div className="mlist">
      {results?.map((c) => (
        <div key={c.key} className={`mrow${have(c) ? ' sel' : ''}`}>
          <span className="rel" title={c.release}>
            {c.release}
          </span>
          {c.sameRelease && <span className="tag">Same release</span>}
          {c.hearingImpaired && <span className="tag">SDH</span>}
          {have(c) ? (
            <Check size={16} style={{ color: 'var(--accent)' }} aria-label="Downloaded" />
          ) : busy === c.key ? (
            <Spinner size={20} />
          ) : (
            <button className="dl" aria-label={`Download ${c.release}`} disabled={!!busy} onClick={() => get(c)}>
              <Download size={14} />
            </button>
          )}
        </div>
      ))}
      </div>
      {results && !results.length && !error && <div className="mnote">Nothing found. Try searching by name.</div>}
      {error && <div className="mnote warn">{error}</div>}
      <div className="mnote">
        <span>English only{quota ? ` · ${quota.remaining} downloads left today` : ''}</span>
      </div>
    </div>
  )
}
