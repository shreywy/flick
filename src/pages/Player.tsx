import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlayInfo, SubStyle, SubTrack } from '../../shared/types'
import { api, type SpriteInfo } from '../api'
import { goBack, toggleFullscreen, useApp, useFullscreen } from '../App'
import CaptionsMenu from '../CaptionsMenu'
import { MseFeeder } from '../mse'
import { Back, Fullscreen, Gear, Next, Pause, Play, Skip, Spinner, Volume } from '../icons'
import { epTag, fmtClock, nextEpisode } from '../lib'
import { activeCues, cueStyle, parseCues, type Cue } from '../subs'

type ZoomMode = 'fit' | 'fill' | 'zoom'
const RATES = [1, 1.25, 1.5, 2, 0.75]
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

// set by the open player: saves progress and reloads the library, so the page we return to is already final
let beforeLeave: (() => Promise<unknown>) | null = null

let exiting = false

async function leave() {
  // Esc twice, or Back then Esc, is one exit
  if (exiting) return
  exiting = true
  await beforeLeave?.().catch(() => undefined)
  goBack()
}

export default function Player({ fileId, start }: { fileId: number; start: boolean }) {
  const { byFile, settings, refresh } = useApp()
  const title = byFile.get(fileId)
  const ep = title?.episodes?.find((e) => e.fileId === fileId)
  const next = title?.kind === 'show' ? nextEpisode(title, fileId) : undefined

  const video = useRef<HTMLVideoElement>(null)
  const [info, setInfo] = useState<PlayInfo | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const offset = useRef(0)
  const mode = useRef<'direct' | 'stream' | null>(null)
  const pending = useRef<number | null>(null)
  const feeder = useRef<MseFeeder | null>(null)
  const feederAudio = useRef(-1)
  const loadSeq = useRef(0)
  const seekTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [cur, setCur] = useState(0)
  const curRef = useRef(0)
  const [buffered, setBuffered] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(true)
  const [ended, setEnded] = useState(false)
  const [ui, setUi] = useState(true)
  const [menu, setMenu] = useState(false)
  const [audio, setAudio] = useState(0)
  const audioRef = useRef(0)
  const [subs, setSubs] = useState<SubTrack[]>([])
  const [track, setTrack] = useState<string | undefined>()
  const [delay, setDelay] = useState(0)
  const [cues, setCues] = useState<Cue[]>([])
  const [style, setStyle] = useState<SubStyle>(settings.subStyle)
  const [vol, setVol] = useState(() => Number(localStorage.getItem('flick.vol') ?? 1))
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [sprite, setSprite] = useState<SpriteInfo | null>(null)
  const isFs = useFullscreen()
  const [zoomMode, setZoomMode] = useState<ZoomMode>(
    () => (localStorage.getItem(`flick.zoomMode.${fileId}`) ?? localStorage.getItem('flick.zoomMode') ?? 'fill') as ZoomMode,
  )
  const [zoomPct, setZoomPct] = useState(() => Number(localStorage.getItem(`flick.zoom.${fileId}`) ?? 115))
  const [crop, setCrop] = useState<{ w: number; h: number; x: number; y: number } | null>(null)
  const [vsize, setVsize] = useState({ w: 0, h: 0 })
  const [screen, setScreen] = useState({ W: innerWidth, H: innerHeight })
  const [countdown, setCountdown] = useState<number | null>(null)
  const [marks, setMarks] = useState<{ intro?: [number, number]; credits?: number }>({})
  const [framed, setFramed] = useState(false)
  const creditsSeen = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const jassub = useRef<{ destroy: () => void; timeOffset: number } | null>(null)
  const duration = info?.duration ?? 0

  useEffect(() => {
    const on = () => setScreen({ W: innerWidth, H: innerHeight })
    addEventListener('resize', on)
    return () => removeEventListener('resize', on)
  }, [])

  // Fit shows the whole frame. Fill scales until the picture (not its black bars) meets the screen edges. Zoom is manual.
  const view = useMemo(() => {
    const { w: vw, h: vh } = vsize
    const { W, H } = screen
    if (!vw || !vh) return { scale: 1, tx: 0, ty: 0, box: { bottom: 0, height: H } }
    const k = Math.min(W / vw, H / vh)
    const c = crop ?? { w: vw, h: vh, x: 0, y: 0 }
    let scale = 1
    if (zoomMode === 'fill') scale = Math.max(1, Math.min(W / (c.w * k), H / (c.h * k)))
    else if (zoomMode === 'zoom') scale = zoomPct / 100
    const centre = zoomMode !== 'fit'
    const tx = centre ? -(c.x + c.w / 2 - vw / 2) * k * scale : 0
    const ty = centre ? -(c.y + c.h / 2 - vh / 2) * k * scale : 0
    const picH = Math.min(H, (zoomMode === 'fit' ? vh : c.h) * k * scale)
    return { scale, tx, ty, box: { bottom: (H - picH) / 2, height: picH } }
  }, [vsize, screen, crop, zoomMode, zoomPct])

  const setZoom = useCallback(
    (m: ZoomMode, pct?: number) => {
      setZoomMode(m)
      localStorage.setItem(`flick.zoomMode.${fileId}`, m)
      if (m !== 'zoom') localStorage.setItem('flick.zoomMode', m)
      if (pct !== undefined) {
        const v = clamp(Math.round(pct), 100, 250)
        setZoomPct(v)
        localStorage.setItem(`flick.zoom.${fileId}`, String(v))
      }
    },
    [fileId],
  )

  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = root.current
    if (!el) return
    const on = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom('zoom', (zoomMode === 'zoom' ? zoomPct : Math.round(view.scale * 100)) + (e.deltaY < 0 ? 5 : -5))
    }
    el.addEventListener('wheel', on, { passive: false })
    return () => el.removeEventListener('wheel', on)
  }, [setZoom, zoomMode, zoomPct, view.scale])

  // ---------- loading ----------
  const load = useCallback(
    async (t: number, a = audioRef.current, play = true) => {
      const v = video.current
      if (!v || !info) return
      const seq = ++loadSeq.current
      setErr(null)
      setEnded(false)
      setWaiting(true)
      t = clamp(t, 0, Math.max(0, info.duration - 1))
      curRef.current = t
      setCur(t)
      if (info.mode === 'direct' && a === 0) {
        offset.current = 0
        if (mode.current !== 'direct') {
          mode.current = 'direct'
          pending.current = t
          v.src = info.directUrl!
        } else if (v.readyState >= 1) v.currentTime = t
        else pending.current = t
      } else {
        // the MSE timeline is the film's own clock, so no offset maths here
        offset.current = 0
        if (!feeder.current || feederAudio.current !== a || mode.current !== 'stream') {
          feeder.current?.destroy()
          feeder.current = new MseFeeder(v, info.duration, info.mimes[a] ?? info.mimes[0], (e) => setErr(`Playback stopped: ${e.message}`))
          feederAudio.current = a
        }
        mode.current = 'stream'
        if (!feeder.current.has(t)) {
          const k = await api.keyframe(fileId, t).catch(() => t)
          if (seq !== loadSeq.current) return
          feeder.current.start(`${info.streamBase}&start=${k.toFixed(3)}&audio=${a}`, k)
        }
        v.currentTime = t
      }
      if (play) v.play().catch(() => undefined)
    },
    [info, fileId],
  )

  useEffect(() => {
    let alive = true
    api
      .playInfo(fileId)
      .then((i) => {
        if (!alive) return
        const flagged = i.audio.findIndex((a) => a.default)
        const eng = i.audio.findIndex((a) => /^en/.test(a.language ?? ''))
        const a = Math.max(0, flagged >= 0 ? flagged : eng)
        audioRef.current = a
        setAudio(a)
        setSubs(i.subs)
        setTrack(i.subPrefs.track ?? undefined)
        setDelay(i.subPrefs.delay)
        setInfo(i)
      })
      .catch((e: Error) => setErr(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
    api.sprites(fileId).then((s) => alive && setSprite(s))
    api.crop(fileId).then((c) => alive && setCrop(c))
    api.markers(fileId).then((m) => alive && setMarks(m))
    return () => {
      alive = false
      feeder.current?.destroy()
    }
  }, [fileId])

  useEffect(() => {
    if (info) load(start ? 0 : info.position, audioRef.current, start || info.position < 5)
    // only once per file
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info])

  // ---------- progress ----------
  const save = useCallback(
    async () => {
      if (info && curRef.current > 1) await api.saveProgress(fileId, curRef.current, info.duration)
    },
    [info, fileId],
  )

  useEffect(() => {
    exiting = false
    beforeLeave = async () => {
      await save()
      await refresh()
    }
    return () => {
      beforeLeave = null
    }
  }, [save, refresh])

  useEffect(() => {
    const t = setInterval(() => playing && save(), 5000)
    return () => clearInterval(t)
  }, [playing, save])

  useEffect(
    () => () => {
      save()
      setTimeout(refresh, 300)
    },
    [save, refresh],
  )

  // ---------- video events ----------
  useEffect(() => {
    const v = video.current
    if (!v) return
    v.volume = vol
    v.muted = muted
    v.playbackRate = rate
  }, [vol, muted, rate])

  const onTime = () => {
    const v = video.current!
    const abs = offset.current + v.currentTime
    curRef.current = abs
    setCur(abs)
    if (v.buffered.length) setBuffered(offset.current + v.buffered.end(v.buffered.length - 1))
    if (jassub.current) jassub.current.timeOffset = offset.current - delay
  }

  const onEnded = () => {
    if (!info) return
    if (curRef.current < info.duration - 90) {
      setErr(`This file stopped playing at ${fmtClock(curRef.current)}. It may be damaged around there.`)
      return
    }
    api.saveProgress(fileId, info.duration, info.duration)
    setEnded(true)
    setPlaying(false)
    if (next && settings.autoplayNext) setCountdown(10)
  }

  const playNext = useCallback(() => {
    if (!next) return
    if (info) {
      curRef.current = info.duration
      api.saveProgress(fileId, info.duration, info.duration)
    }
    location.replace(`#/play/${next.fileId}`)
  }, [next, info, fileId])

  useEffect(() => {
    if (countdown === null) return
    if (countdown <= 0) {
      playNext()
      return
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000)
    return () => clearTimeout(t)
  }, [countdown, playNext])

  // ---------- seeking ----------
  const seek = useCallback(
    (t: number) => {
      const v = video.current
      if (!v || !info) return
      t = clamp(t, 0, info.duration - 0.5)
      curRef.current = t
      setCur(t)
      setEnded(false)
      setCountdown(null)
      if (mode.current === 'direct' || feeder.current?.has(t)) {
        v.currentTime = t
        return
      }
      clearTimeout(seekTimer.current)
      seekTimer.current = setTimeout(() => load(t), 180)
    },
    [info, load],
  )

  useEffect(() => {
    // used by the end-to-end tests to seek to an exact time
    ;(window as unknown as { __flickSeek?: (t: number) => void }).__flickSeek = seek
  }, [seek])

  const toggle = useCallback(() => {
    const v = video.current
    if (!v) return
    if (ended) return seek(0)
    if (v.paused) v.play().catch(() => undefined)
    else v.pause()
  }, [ended, seek])

  // ---------- subtitles ----------
  useEffect(() => {
    const on = (e: Event) => setStyle((e as CustomEvent<SubStyle>).detail)
    addEventListener('flick:substyle', on)
    return () => removeEventListener('flick:substyle', on)
  }, [])

  const cur_track = subs.find((s) => s.id === track)
  useEffect(() => {
    setCues([])
    jassub.current?.destroy()
    jassub.current = null
    if (!cur_track?.url || !video.current) return
    let alive = true
    fetch(cur_track.url)
      .then((r) => {
        if (!r.ok) throw new Error('Could not load those subtitles')
        return r.text()
      })
      .then(async (text) => {
        if (!alive) return
        if (cur_track.format === 'ass') {
          const { default: JASSUB } = await import('jassub')
          if (!alive) return
          const j = new JASSUB({ video: video.current!, subContent: text, timeOffset: offset.current - delay }) as unknown as { destroy: () => void; timeOffset: number }
          jassub.current = j
        } else setCues(parseCues(text))
      })
      .catch(() => alive && setCues([]))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur_track?.id, cur_track?.url])

  useEffect(() => {
    if (jassub.current) jassub.current.timeOffset = offset.current - delay
  }, [delay])

  useEffect(() => () => jassub.current?.destroy(), [])

  const pickTrack = (id: string | undefined) => {
    setTrack(id)
    api.subPrefs(fileId, { track: id ?? null })
  }
  const changeDelay = useCallback(
    (d: number) => {
      const v = Math.round(d * 10) / 10
      setDelay(v)
      api.subPrefs(fileId, { delay: v })
    },
    [fileId],
  )
  const pickAudio = (i: number) => {
    if (i === audioRef.current) return
    audioRef.current = i
    setAudio(i)
    load(curRef.current, i)
  }

  // ---------- ui visibility ----------
  const poke = useCallback(() => {
    setUi(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setUi(false), 2500)
  }, [])
  const showUi = ui || !playing || menu || !!err || ended
  useEffect(() => {
    document.body.classList.toggle('p-idle', !showUi)
    return () => document.body.classList.remove('p-idle')
  }, [showUi])

  // ---------- keys ----------
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return
      const v = video.current
      const skip = settings.skipSeconds || 10
      let handled = true
      if (e.ctrlKey && ['=', '+', '-', '0'].includes(e.key)) {
        if (e.key === '0') setZoom('fit')
        else setZoom('zoom', (zoomMode === 'zoom' ? zoomPct : Math.round(view.scale * 100)) + (e.key === '-' ? -5 : 5))
        e.preventDefault()
        poke()
        return
      }
      switch (e.key) {
        case 'z':
          setZoom(zoomMode === 'fit' ? 'fill' : 'fit')
          break
        case ' ':
        case 'k':
          toggle()
          break
        case 'ArrowLeft':
          seek(curRef.current - skip)
          break
        case 'ArrowRight':
          seek(curRef.current + skip)
          break
        case 'ArrowUp':
          setVol((x) => clamp(Math.round((x + 0.05) * 100) / 100, 0, 1))
          break
        case 'ArrowDown':
          setVol((x) => clamp(Math.round((x - 0.05) * 100) / 100, 0, 1))
          break
        case 'c':
          setMenu((m) => !m)
          break
        case 'm':
          setMuted((m) => !m)
          break
        case '[':
          changeDelay(delay - 0.1)
          break
        case ']':
          changeDelay(delay + 0.1)
          break
        case 'n':
          if (next) location.replace(`#/play/${next.fileId}`)
          break
        case 'Escape':
          if (menu) setMenu(false)
          else leave()
          break
        default:
          handled = false
      }
      if (handled) {
        e.preventDefault()
        poke()
      }
      void v
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [toggle, seek, settings.skipSeconds, delay, changeDelay, next, menu, poke, setZoom, zoomMode, zoomPct, view.scale])

  useEffect(() => {
    localStorage.setItem('flick.vol', String(vol))
  }, [vol])

  const label = title ? (ep ? `${title.name}` : title.name) : ''
  const sub = ep ? `${epTag(ep)} · ${ep.name}` : title?.year ? String(title.year) : ''
  const inIntro = !!marks.intro && cur >= marks.intro[0] && cur < marks.intro[1] - 2
  const inCredits = marks.credits !== undefined && cur >= marks.credits && !ended
  const showUpNext = !!next && (ended || inCredits || (duration > 0 && duration - cur < 30 && cur > 60))

  // credits roll: count down to the next episode, once per episode
  useEffect(() => {
    if (!inCredits || creditsSeen.current || !next || !settings.autoplayNext || !playing) return
    creditsSeen.current = true
    setCountdown(10)
  }, [inCredits, next, settings.autoplayNext, playing])
  const art = ep?.still ?? title?.backdrop

  return (
    <div
      ref={root}
      className={`player${showUi ? ' ui' : ''}`}
      onMouseMove={poke}
      onMouseDown={() => menu && setMenu(false)}
      data-testid="player"
      data-title={title?.id}
    >
      <div className="p-stage">
      <video
        ref={video}
        onLoadedMetadata={() => {
          const v = video.current!
          setVsize({ w: v.videoWidth, h: v.videoHeight })
          if (pending.current !== null && mode.current === 'direct') {
            v.currentTime = pending.current
            pending.current = null
          }
        }}
        onTimeUpdate={onTime}
        onSeeked={() => (jassub.current as unknown as { resize?: (force?: boolean) => void } | null)?.resize?.(true)}
        style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false)
          save()
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => {
          setWaiting(false)
          setFramed(true)
        }}
        onEnded={onEnded}
        onError={() => {
          const e = video.current?.error
          if (e && e.code !== MediaError.MEDIA_ERR_ABORTED) setErr(`This file stopped playing at ${fmtClock(curRef.current)}.`)
        }}
        onClick={() => !menu && toggle()}
        onDoubleClick={() => {
          toggleFullscreen()
        }}
      />
      {art && <img className={`p-art${framed ? ' gone' : ''}`} src={art} alt="" draggable={false} />}
      </div>

      {cues.length > 0 && <CueLayer video={video} offset={offset} cues={cues} delay={delay} style={style} lift={showUi} box={view.box} />}

      <div className="p-shade-top" />
      <div className="p-shade-bottom" />

      <div className="p-top">
        <button className="ctl" aria-label="Back" onClick={leave}>
          <Back size={22} />
        </button>
        <span className="t">{label}</span>
        <span className="s">{sub}</span>
      </div>

      {inIntro && !menu && (
        <button className="p-skip" onMouseDown={(e) => e.stopPropagation()} onClick={() => seek(marks.intro![1])}>
          Skip intro
        </button>
      )}
      {inCredits && !next && !menu && (
        <button
          className="p-skip"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => {
            curRef.current = duration
            api.saveProgress(fileId, duration, duration)
            leave()
          }}
        >
          Skip credits
        </button>
      )}

      {(waiting || !info) && !err && !ended && (
        <div className="p-center">
          <Spinner size={44} />
        </div>
      )}

      {err && (
        <div className="p-center">
          <div className="p-msg" role="alert">
            {err}
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              {info && (
                <button className="btn small primary" onClick={() => load(curRef.current)}>
                  Retry
                </button>
              )}
              {info && (
                <button className="btn small" onClick={() => load(curRef.current + 30)}>
                  Skip ahead 30s
                </button>
              )}
              <button className="btn small" onClick={leave}>
                Back
              </button>
            </div>
          </div>
        </div>
      )}

      {showUpNext && next && (
        <div className="upnext" onMouseDown={(e) => e.stopPropagation()}>
          {next.still && <img src={next.still} alt="" />}
          <div>
            <div className="lbl">Next episode{countdown !== null ? ` in ${countdown}s` : ''}</div>
            <div className="nm">
              {epTag(next)} · {next.name}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn small primary" onClick={playNext}>
              <Play size={16} />
              Play now
            </button>
            {countdown !== null && (
              <button className="btn small" onClick={() => setCountdown(null)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      <div className="p-bottom" onMouseDown={(e) => e.stopPropagation()}>
        <SeekBar duration={duration} cur={cur} buffered={buffered} onSeek={seek} sprite={sprite} />
        <div className="p-row">
          <button className="ctl" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle}>
            {playing ? <Pause size={22} /> : <Play size={22} />}
          </button>
          <button className="ctl" aria-label={`Back ${settings.skipSeconds} seconds`} onClick={() => seek(cur - settings.skipSeconds)}>
            <Skip back size={24} />
          </button>
          <button className="ctl" aria-label={`Forward ${settings.skipSeconds} seconds`} onClick={() => seek(cur + settings.skipSeconds)}>
            <Skip size={24} />
          </button>
          <button className="ctl" aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted((m) => !m)}>
            <Volume size={22} muted={muted || vol === 0} />
          </button>
          <div
            className="vol"
            role="slider"
            aria-label="Volume"
            aria-valuenow={Math.round(vol * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            tabIndex={0}
            onMouseDown={(e) => {
              const el = e.currentTarget
              const set = (x: number) => {
                const r = el.getBoundingClientRect()
                setVol(clamp((x - r.left) / r.width, 0, 1))
                setMuted(false)
              }
              set(e.clientX)
              const mv = (ev: MouseEvent) => set(ev.clientX)
              const up = () => (removeEventListener('mousemove', mv), removeEventListener('mouseup', up))
              addEventListener('mousemove', mv)
              addEventListener('mouseup', up)
            }}
          >
            <div>
              <div style={{ width: `${(muted ? 0 : vol) * 100}%` }} />
            </div>
          </div>
          <span className="p-time">
            {fmtClock(cur)} <span>/ {fmtClock(duration)}</span>
          </span>
          <div className="spacer" />
          {next && (
            <button className="ctl" aria-label="Next episode" title={`${epTag(next)} · ${next.name}`} onClick={() => location.replace(`#/play/${next.fileId}`)}>
              <Next size={20} />
            </button>
          )}
          <button className={`ctl${menu ? ' on' : ''}`} aria-label="Player settings" title="Subtitles, audio and picture" onClick={() => setMenu((m) => !m)}>
            <Gear size={21} />
          </button>
          <button className="ctl txt" aria-label="Playback speed" onClick={() => setRate((r) => RATES[(RATES.indexOf(r) + 1) % RATES.length])}>
            {rate}×
          </button>
          <button
            className="ctl"
            aria-label={isFs ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={() => {
              toggleFullscreen()
            }}
          >
            <Fullscreen exit={isFs} size={20} />
          </button>
        </div>
      </div>

      {menu && info && (
        <CaptionsMenu
          info={{ ...info, subs }}
          zoomMode={zoomMode}
          zoomPct={zoomMode === 'zoom' ? zoomPct : Math.round(view.scale * 100)}
          hasBars={!!crop}
          onZoom={setZoom}
          track={track}
          onTrack={pickTrack}
          audio={audio}
          onAudio={pickAudio}
          delay={delay}
          onDelay={changeDelay}
          isAss={cur_track?.format === 'ass'}
          onNewTrack={(t) => {
            setSubs((s) => (s.some((x) => x.id === t.id) ? s : [t, ...s]))
            pickTrack(t.id)
          }}
        />
      )}
    </div>
  )
}

function SeekBar({ duration, cur, buffered, onSeek, sprite }: { duration: number; cur: number; buffered: number; onSeek: (t: number) => void; sprite: SpriteInfo | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const [missing, setMissing] = useState<Record<number, number>>({})
  const at = (x: number) => {
    const r = ref.current!.getBoundingClientRect()
    return clamp((x - r.left) / r.width, 0, 1) * duration
  }
  const shown = drag ?? cur
  const pct = (t: number) => `${duration ? (clamp(t, 0, duration) / duration) * 100 : 0}%`
  const previewT = drag ?? hover

  const frame = useMemo(() => {
    if (!sprite || previewT === null) return null
    const n = Math.floor(previewT / sprite.every)
    const per = sprite.cols * sprite.rows
    const sheet = Math.floor(n / per) + 1
    if (missing[sheet] && Date.now() - missing[sheet] < 10000) return null
    const i = n % per
    return { sheet, url: sprite.base.replace('{n}', String(sheet)), x: (i % sprite.cols) * sprite.width, y: Math.floor(i / sprite.cols) * sprite.height }
  }, [sprite, previewT, missing])

  useEffect(() => {
    if (!frame) return
    const img = new Image()
    img.onerror = () => setMissing((m) => ({ ...m, [frame.sheet]: Date.now() }))
    img.src = frame.url
  }, [frame?.url])

  const scale = sprite ? Math.min(1, 288 / sprite.width) : 1
  return (
    <div
      ref={ref}
      className={`seek${drag !== null ? ' drag' : ''}`}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(cur)}
      aria-valuetext={fmtClock(cur)}
      tabIndex={0}
      onMouseMove={(e) => setHover(at(e.clientX))}
      onMouseLeave={() => setHover(null)}
      onMouseDown={(e) => {
        const t0 = at(e.clientX)
        setDrag(t0)
        let last = t0
        const mv = (ev: MouseEvent) => {
          last = at(ev.clientX)
          setDrag(last)
          setHover(last)
        }
        const up = () => {
          removeEventListener('mousemove', mv)
          removeEventListener('mouseup', up)
          setDrag(null)
          onSeek(last)
        }
        addEventListener('mousemove', mv)
        addEventListener('mouseup', up)
      }}
    >
      <div className="seek-track">
        <div className="seek-buf" style={{ width: pct(buffered) }} />
        {previewT !== null && <div className="seek-hover" style={{ width: pct(previewT) }} />}
        <div className="seek-play" style={{ width: pct(shown) }} />
        <div className="seek-knob" style={{ left: pct(shown) }} />
      </div>
      {previewT !== null && (
        <div className="seek-preview" style={{ left: pct(previewT) }}>
          {frame && sprite && (
            <div
              className="frame"
              style={{
                width: sprite.width * scale,
                height: sprite.height * scale,
                backgroundImage: `url("${frame.url}")`,
                backgroundSize: `${sprite.cols * sprite.width * scale}px ${sprite.rows * sprite.height * scale}px`,
                backgroundPosition: `-${frame.x * scale}px -${frame.y * scale}px`,
              }}
            />
          )}
          <span className="time">{fmtClock(previewT)}</span>
        </div>
      )}
    </div>
  )
}

function CueLayer({
  video,
  offset,
  cues,
  delay,
  style,
  lift,
  box,
}: {
  video: React.RefObject<HTMLVideoElement | null>
  offset: React.RefObject<number>
  cues: Cue[]
  delay: number
  style: SubStyle
  lift: boolean
  box: { bottom: number; height: number }
}) {
  const [active, setActive] = useState<Cue[]>([])
  useEffect(() => {
    let raf = 0
    let lastKey = ''
    const tick = () => {
      const v = video.current
      if (v) {
        const t = offset.current + v.currentTime - delay
        const now = activeCues(cues, t)
        const key = now.map((c) => c.start).join()
        if (key !== lastKey) {
          lastKey = key
          setActive(now)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [cues, delay, video, offset])


  const base = box.bottom + (box.height * style.position) / 100
  const bottom = lift ? Math.max(base, box.bottom + 0.13 * innerHeight) : base
  const css = cueStyle(style)
  return (
    <div className="cues" style={{ bottom }}>
      {active.map((c) => (
        <span key={c.start + c.html} className="cue" style={css} dangerouslySetInnerHTML={{ __html: c.html }} />
      ))}
    </div>
  )
}
