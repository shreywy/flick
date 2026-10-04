import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Title } from '../shared/types'
import { go, useApp } from './App'
import { Check, Chevron } from './icons'
import { isStarted, isWatched } from './lib'

export function Img({ src, alt = '', className, fallback }: { src?: string; alt?: string; className?: string; fallback?: ReactNode }) {
  const [bad, setBad] = useState(false)
  if (!src || bad) return <>{fallback ?? null}</>
  return <img ref={fadeIn} src={src} alt={alt} className={className} loading="lazy" decoding="async" draggable={false} onError={() => setBad(true)} />
}

/** Images that still have to load fade in; ones already in memory show at once, so returning to a page doesn't flash. */
function fadeIn(el: HTMLImageElement | null) {
  if (!el || el.complete) return
  el.classList.add('pending')
  el.addEventListener('load', () => el.classList.remove('pending'), { once: true })
}

export function PosterCard({ t, sub, name }: { t: Title; sub?: string; name?: ReactNode }) {
  const { lib } = useApp()
  const p = t.fileId ? lib.progress[t.fileId] : undefined
  const watched = isWatched(t, lib)
  return (
    <button className="poster" data-title={t.id} onClick={() => go(`#/title/${t.id}`)} title={t.name}>
      <div className="poster-art">
        <Img src={t.poster} fallback={<div className="poster-fallback">{t.name}</div>} />
        {isStarted(p) && (
          <div className="bar">
            <div style={{ width: `${(p!.position / p!.duration) * 100}%` }} />
          </div>
        )}
        {watched && (
          <span className="tick">
            <Check size={16} />
          </span>
        )}
      </div>
      <div className="poster-name">{name ?? t.name}</div>
      <div className="poster-sub">{sub ?? t.year ?? ''}</div>
    </button>
  )
}

export function ThumbCard({
  img,
  title,
  right,
  progress,
  fileId,
  titleId,
  onClick,
}: {
  img?: string
  title: string
  right?: string
  progress?: number
  fileId?: number
  titleId?: number
  onClick: (el: HTMLElement) => void
}) {
  return (
    <button className="thumb" data-file={fileId} data-title={titleId} onClick={(e) => onClick(e.currentTarget)}>
      <div className="thumb-art">
        <Img src={img} />
        {progress !== undefined && (
          <div className="bar">
            <div style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </div>
        )}
      </div>
      <div className="thumb-cap">
        <span>{title}</span>
        {right && <span>{right}</span>}
      </div>
    </button>
  )
}

export function Row({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ l: false, r: false })
  // arrows only when there's more to see that way
  const check = () => {
    const t = track.current
    if (!t) return
    const l = t.scrollLeft > 4
    const r = t.scrollLeft + t.clientWidth < t.scrollWidth - 4
    setEdge((p) => (p.l === l && p.r === r ? p : { l, r }))
  }
  useEffect(check)
  useEffect(() => {
    const ro = new ResizeObserver(check)
    ro.observe(track.current!)
    return () => ro.disconnect()
  }, [])

  // one eased scroller: shift + wheel and the arrows both move a target, the track glides to it
  const glide = useRef<(by: number) => void>(() => undefined)
  useEffect(() => {
    const t = track.current!
    let target = 0
    let raf = 0
    const step = () => {
      const d = target - t.scrollLeft
      if (Math.abs(d) < 0.5) {
        t.scrollLeft = target
        raf = 0
        return
      }
      t.scrollLeft += d * 0.2
      raf = requestAnimationFrame(step)
    }
    glide.current = (by) => {
      if (!raf) target = t.scrollLeft
      target = Math.max(0, Math.min(t.scrollWidth - t.clientWidth, target + by))
      if (!raf) raf = requestAnimationFrame(step)
    }
    const wheel = (e: WheelEvent) => {
      if (!e.shiftKey) return
      e.preventDefault()
      glide.current((e.deltaY || e.deltaX) * 3)
    }
    t.addEventListener('wheel', wheel, { passive: false })
    return () => {
      t.removeEventListener('wheel', wheel)
      cancelAnimationFrame(raf)
    }
  }, [])
  const scroll = (dir: number) => glide.current(dir * track.current!.clientWidth * 0.8)
  return (
    <section className={`row${edge.l ? ' more-l' : ''}${edge.r ? ' more-r' : ''}`} data-row={id}>
      <h2>{title}</h2>
      {edge.l && (
        <button className="row-arrow left" aria-label={`Scroll ${title} left`} onClick={() => scroll(-1)}>
          <span>
            <Chevron dir="left" size={24} />
          </span>
        </button>
      )}
      <div
        className="row-track"
        ref={track}
        onScroll={check}
      >
        {children}
      </div>
      {edge.r && (
        <button className="row-arrow right" aria-label={`Scroll ${title} right`} onClick={() => scroll(1)}>
          <span>
            <Chevron size={24} />
          </span>
        </button>
      )}
    </section>
  )
}

export function metaLine(t: Title) {
  const m = t.meta
  const parts: string[] = []
  if (t.year) parts.push(String(t.year))
  if (t.kind === 'movie' && m?.runtime) parts.push(`${Math.floor(m.runtime / 60)}h ${m.runtime % 60}m`.replace(/^0h /, ''))
  if (t.kind === 'show' && t.episodes) {
    const seasons = new Set(t.episodes.map((e) => e.season)).size
    parts.push(`${seasons} season${seasons === 1 ? '' : 's'}`, `${t.episodes.length} episode${t.episodes.length === 1 ? '' : 's'}`)
  }
  if (m?.certification) parts.push(m.certification)
  if (m?.genres.length) parts.push(m.genres.slice(0, 2).join(', '))
  return parts.join(' · ')
}
