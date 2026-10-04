import { useEffect, useMemo, useState } from 'react'
import type { PlayInfo, Title } from '../../shared/types'
import { api } from '../api'
import { goBack, onScreen, play, useApp } from '../App'
import { Img, metaLine, PosterCard, Row } from '../components'
import FixMatch from '../FixMatch'
import { Back, Captions, Check, Play } from '../icons'
import { epTag, fmtRuntime, isStarted, showResume, timeLeft } from '../lib'

export default function TitlePage({ id, season }: { id: number; season?: number }) {
  const { byId } = useApp()
  const t = byId.get(id)
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])
  if (!t) {
    return (
      <main className="page">
        <BackButton />
        <div className="empty" style={{ paddingTop: '12rem' }}>
          This title isn't in the library any more.
        </div>
      </main>
    )
  }
  return t.kind === 'movie' ? <MoviePage t={t} /> : <ShowPage t={t} season={season} />
}

function BackButton() {
  return (
    <button className="back" onClick={goBack}>
      <Back />
      Back
    </button>
  )
}

function useFileInfo(fileId?: number) {
  const [info, setInfo] = useState<PlayInfo | null>(null)
  useEffect(() => {
    if (fileId) api.playInfo(fileId).then(setInfo).catch(() => setInfo(null))
  }, [fileId])
  return info
}

function FixLink({ t }: { t: Title }) {
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)
  return (
    <>
      <button className="filemeta" style={{ textDecoration: 'underline' }} onClick={() => setOpen(true)}>
        {sent ? 'Updating info…' : `Wrong ${t.kind === 'movie' ? 'movie' : 'show'}?`}
      </button>
      {open && (
        <FixMatch
          initial={t.name + (t.year ? ` ${t.year}` : '')}
          kind={t.kind}
          onClose={() => setOpen(false)}
          onPick={(c) => {
            api.fixTitle(t.id, { tmdbId: c.id, kind: c.kind, title: c.title, year: c.year })
            setOpen(false)
            setSent(true)
          }}
        />
      )}
    </>
  )
}

function MoviePage({ t }: { t: Title }) {
  const { lib } = useApp()
  const info = useFileInfo(t.fileId)
  const p = t.fileId ? lib.progress[t.fileId] : undefined
  const started = isStarted(p)
  const m = t.meta
  const english = info?.subs.find((s) => s.format !== 'image')

  const related = useMemo(() => {
    const others = lib.titles.filter((o) => o.id !== t.id)
    const same = others.filter((o) => m?.collection && o.meta?.collection === m.collection)
    const coll = others.filter((o) => !same.includes(o) && o.collections.some((c) => t.collections.includes(c)))
    const genre = others.filter((o) => !same.includes(o) && !coll.includes(o) && o.meta?.genres.some((g) => m?.genres.slice(0, 2).includes(g)))
    return [...same, ...coll, ...genre].slice(0, 14)
  }, [lib, t, m])

  return (
    <main className="page">
      <BackButton />
      <section className="title-hero">
        <Img src={t.backdrop} className="hero-art" />
        <div className="title-body">
          {t.logo ? <Img src={t.logo} className="hero-logo" alt={t.name} /> : <h1 className={`hero-title${t.name.length > 18 ? ' long' : ''}`}>{t.name}</h1>}
          <div className="meta">
            {metaLine(t)}
            {m?.rating ? ` · TMDB ${m.rating}` : ''}
          </div>
          {m?.overview && <p className="overview" style={{ WebkitLineClamp: 5 }}>{m.overview}</p>}
          {m && (m.directors.length > 0 || m.cast.length > 0) && (
            <div className="credits">
              {m.directors.length > 0 && (
                <>
                  <span>Director</span>
                  <span>{m.directors.join(', ')}</span>
                </>
              )}
              {m.cast.length > 0 && (
                <>
                  <span>Cast</span>
                  <span>{m.cast.slice(0, 5).join(', ')}</span>
                </>
              )}
            </div>
          )}
          <div className="actions">
            <button className="btn primary" data-file={t.fileId} data-title={t.id} onClick={(e) => play(t.fileId!, e.currentTarget)}>
              <Play />
              {started ? 'Resume' : 'Play'}
            </button>
            {started && (
              <button className="btn" onClick={(e) => play(t.fileId!, e.currentTarget, true)}>
                Start over
              </button>
            )}
            {info && (
              <span className="btn" style={{ cursor: 'default', background: 'transparent', paddingLeft: '0.6rem' }}>
                <Captions />
                {english ? english.label + ' subtitles' : 'No subtitles'}
              </span>
            )}
            <button
              className="btn square"
              aria-label={p?.watched ? 'Mark as not watched' : 'Mark as watched'}
              title={p?.watched ? 'Watched. Click to undo.' : 'Mark as watched'}
              style={p?.watched ? { color: 'var(--accent)' } : undefined}
              onClick={() => t.fileId && api.markWatched([t.fileId], !p?.watched)}
            >
              <Check size={24} />
            </button>
            {started && <span className="mini-progress" style={{ marginLeft: '0.4rem' }}>{timeLeft(p!)}</span>}
          </div>
          <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap' }}>
            {info && (
              <button className="filemeta" title="Show in Explorer" onClick={() => t.path && api.showFile(t.path)}>
                {info.details}
              </button>
            )}
            <FixLink t={t} />
          </div>
        </div>
      </section>
      {related.length > 0 && (
        <Row title={m?.collection && related[0].meta?.collection === m.collection ? `More from ${m.collection.replace(/ Collection$/, '')}` : 'More like this'}>
          {related.map((o) => (
            <PosterCard key={o.id} t={o} />
          ))}
        </Row>
      )}
    </main>
  )
}

function ShowPage({ t, season }: { t: Title; season?: number }) {
  const { lib } = useApp()
  const eps = t.episodes ?? []
  const seasons = [...new Set(eps.map((e) => e.season))].sort((a, b) => a - b)
  const resume = showResume(t, lib)
  const [cur, setCur] = useState(season ?? resume?.episode?.season ?? seasons[0])
  const list = eps.filter((e) => e.season === cur)
  const watchedHere = list.filter((e) => lib.progress[e.fileId]?.watched).length
  const m = t.meta

  return (
    <main className="page">
      <BackButton />
      <section className="title-hero show">
        <Img src={t.backdrop} className="hero-art" />
        <div className="title-body">
          {t.logo ? <Img src={t.logo} className="hero-logo" alt={t.name} /> : <h1 className={`hero-title${t.name.length > 18 ? ' long' : ''}`}>{t.name}</h1>}
          <div className="meta">
            {metaLine(t)}
            {m?.rating ? ` · TMDB ${m.rating}` : ''}
          </div>
          {m?.overview && <p className="overview">{m.overview}</p>}
          <div className="actions">
            {resume && (
              <button className="btn primary" data-file={resume.fileId} data-title={t.id} onClick={(e) => {
                  // fly from that episode's card when it's on screen, otherwise grow out of the button
                  const card = document.querySelector(`.ep[data-file="${resume.fileId}"]`)
                  play(resume.fileId, card && onScreen(card.getBoundingClientRect()) ? card : e.currentTarget)
                }}>
                <Play />
                {resume.progress ? 'Resume' : resume.updated ? 'Play' : 'Start'} {epTag(resume.episode!)}
              </button>
            )}
            {resume?.progress && <span className="mini-progress">{timeLeft(resume.progress)} in {resume.episode!.name}</span>}
            <FixLink t={t} />
          </div>
        </div>
      </section>

      <nav className="tabs" style={{ marginTop: '0.5rem' }}>
        {seasons.map((s) => (
          <button key={s} className={s === cur ? 'on' : ''} onClick={() => setCur(s)}>
            {s === 0 ? 'Specials' : `Season ${s}`}
          </button>
        ))}
        <span className="count">
          {watchedHere} of {list.length} watched ·{' '}
          <button
            className="filemeta"
            style={{ textDecoration: 'underline', display: 'inline' }}
            onClick={() => api.markWatched(list.map((e) => e.fileId), watchedHere < list.length)}
          >
            {watchedHere < list.length ? 'Mark season watched' : 'Mark season unwatched'}
          </button>
        </span>
      </nav>

      <div className="episodes">
        {list.map((e) => {
          const p = lib.progress[e.fileId]
          const started = isStarted(p)
          return (
            <button key={e.fileId} className="ep" data-file={e.fileId} onClick={(ev) => play(e.fileId, ev.currentTarget)}>
              <div className="thumb-art">
                <Img src={e.still ?? t.backdrop} className={p?.watched ? 'seen' : ''} />
                {p?.watched && (
                  <span className="tick">
                    <Check size={16} />
                  </span>
                )}
                {started && (
                  <div className="bar">
                    <div style={{ width: `${(p!.position / p!.duration) * 100}%` }} />
                  </div>
                )}
              </div>
              <div className="ep-title">
                {e.episode}. {e.name}
              </div>
              <div className="ep-meta">
                {[e.runtime ? fmtRuntime(e.runtime) : '', started ? timeLeft(p!) : ''].filter(Boolean).join(' · ')}
              </div>
              {e.overview && <div className="ep-over">{e.overview}</div>}
            </button>
          )
        })}
      </div>
    </main>
  )
}
