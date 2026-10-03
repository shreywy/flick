import { useRef, useState, type ReactNode } from 'react'
import type { Title } from '../shared/types'
import { go, useApp } from './App'
import { Check, Chevron } from './icons'
import { isStarted, isWatched } from './lib'

export function Img({ src, alt = '', className, fallback }: { src?: string; alt?: string; className?: string; fallback?: ReactNode }) {
  const [bad, setBad] = useState(false)
  if (!src || bad) return <>{fallback ?? null}</>
  return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" draggable={false} onError={() => setBad(true)} />
}

export function PosterCard({ t, sub, name }: { t: Title; sub?: string; name?: ReactNode }) {
  const { lib } = useApp()
  const p = t.fileId ? lib.progress[t.fileId] : undefined
  const watched = isWatched(t, lib)
  return (
    <button className="poster" onClick={() => go(`#/title/${t.id}`)} title={t.name}>
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

export function ThumbCard({ img, title, right, progress, onClick }: { img?: string; title: string; right?: string; progress?: number; onClick: () => void }) {
  return (
    <button className="thumb" onClick={onClick}>
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

export function Row({ title, children }: { title: string; children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null)
  const scroll = (dir: number) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.8 })
  return (
    <section className="row">
      <h2>{title}</h2>
      <button className="row-arrow left" aria-label={`Scroll ${title} left`} onClick={() => scroll(-1)}>
        <Chevron dir="left" size={28} />
      </button>
      <div
        className="row-track"
        ref={track}
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && e.shiftKey) track.current?.scrollBy({ left: e.deltaY })
        }}
      >
        {children}
      </div>
      <button className="row-arrow right" aria-label={`Scroll ${title} right`} onClick={() => scroll(1)}>
        <Chevron size={28} />
      </button>
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
