import { useMemo } from 'react'
import { COLLECTIONS } from '../../shared/collections'
import { go, useApp } from '../App'
import { Img, metaLine, PosterCard, Row, ThumbCard } from '../components'
import { Play } from '../icons'
import { continueWatching, epTag, timeLeft, type Resume } from '../lib'

export default function Home() {
  const { lib, settings } = useApp()
  const resume = useMemo(() => continueWatching(lib), [lib])
  const recent = useMemo(() => [...lib.titles].sort((a, b) => b.added - a.added).slice(0, 24), [lib])
  const shows = lib.titles.filter((t) => t.kind === 'show').sort((a, b) => a.name.localeCompare(b.name))

  if (!lib.titles.length) {
    return (
      <main className="page">
        <div className="empty" style={{ paddingTop: '14rem' }}>
          Nothing here yet.
          <br />
          Put movies in {settings.mediaRoot}\Movies, shows in {settings.mediaRoot}\TV Shows, or downloads in {settings.mediaRoot}\Shows and Movies.
        </div>
      </main>
    )
  }

  const lead: Resume | undefined = resume[0]
  const heroTitle = lead?.title ?? recent[0]
  const play = (r: Resume) => go(`#/play/${r.fileId}`)

  return (
    <main className="page">
      <section className="hero">
        <Img src={heroTitle.backdrop} className="hero-art" />
        <div className="hero-body">
          {heroTitle.logo ? (
            <Img src={heroTitle.logo} className="hero-logo" alt={heroTitle.name} />
          ) : (
            <h1 className={`hero-title${heroTitle.name.length > 18 ? ' long' : ''}`}>{heroTitle.name}</h1>
          )}
          <div className="meta">{lead?.episode ? `${epTag(lead.episode)} · ${lead.episode.name}` : metaLine(heroTitle)}</div>
          {heroTitle.meta?.overview && <p className="overview">{lead?.episode?.overview ?? heroTitle.meta.overview}</p>}
          <div className="actions">
            <button
              className="btn primary"
              onClick={() => (lead ? play(lead) : heroTitle.kind === 'movie' ? go(`#/play/${heroTitle.fileId}`) : go(`#/title/${heroTitle.id}`))}
            >
              <Play />
              {lead?.progress ? 'Resume' : 'Play'}
            </button>
            <button className="btn" onClick={() => go(`#/title/${heroTitle.id}`)}>
              More info
            </button>
            {lead?.progress && (
              <div className="mini-progress">
                <div className="mini-bar">
                  <div style={{ width: `${(lead.progress.position / lead.progress.duration) * 100}%` }} />
                </div>
                <span>{timeLeft(lead.progress)}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {resume.length > 0 && (
        <Row title="Continue watching">
          {resume.map((r) => (
            <ThumbCard
              key={r.fileId}
              img={r.episode?.still ?? r.title.backdrop}
              title={r.title.name}
              right={r.episode ? `${epTag(r.episode)}${r.progress ? ' · ' + timeLeft(r.progress) : ''}` : r.progress ? timeLeft(r.progress) : ''}
              progress={r.progress ? r.progress.position / r.progress.duration : undefined}
              onClick={() => play(r)}
            />
          ))}
        </Row>
      )}

      <Row title="Recently added">
        {recent.map((t) => (
          <PosterCard key={t.id} t={t} />
        ))}
      </Row>

      {COLLECTIONS.map((c) => {
        const items = lib.titles.filter((t) => t.collections.includes(c.name)).sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
        if (!items.length) return null
        return (
          <Row key={c.name} title={c.name}>
            {items.map((t) => (
              <PosterCard key={t.id} t={t} />
            ))}
          </Row>
        )
      })}

      {shows.length > 0 && (
        <Row title="Shows">
          {shows.map((t) => (
            <PosterCard key={t.id} t={t} />
          ))}
        </Row>
      )}
    </main>
  )
}
