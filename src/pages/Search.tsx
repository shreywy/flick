import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../App'
import { PosterCard } from '../components'
import { Close, Search as SearchIcon } from '../icons'
import { searchLibrary } from '../lib'

export default function SearchPage() {
  const { lib } = useApp()
  const [q, setQ] = useState(() => sessionStorage.getItem('flick.q') ?? '')
  const [kind, setKind] = useState<'all' | 'movie' | 'show'>('all')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])
  useEffect(() => {
    sessionStorage.setItem('flick.q', q)
  }, [q])

  const hits = useMemo(() => searchLibrary(lib.titles, q), [lib, q])
  const movies = hits.filter((h) => h.t.kind === 'movie').length
  const shown = kind === 'all' ? hits : hits.filter((h) => h.t.kind === kind)

  return (
    <main className="page">
      <label className="searchbox">
        <SearchIcon size={28} />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Titles, actors, directors, years"
          aria-label="Search your library"
          spellCheck={false}
        />
        {q && (
          <button className="iconbtn" aria-label="Clear search" onClick={() => (setQ(''), input.current?.focus())}>
            <Close />
          </button>
        )}
      </label>

      {q.trim() && (
        <div className="toolbar">
          <button className={`chip${kind === 'all' ? ' on' : ''}`} onClick={() => setKind('all')}>
            All<span className="n">{hits.length}</span>
          </button>
          <button className={`chip${kind === 'movie' ? ' on' : ''}`} onClick={() => setKind('movie')}>
            Movies<span className="n">{movies}</span>
          </button>
          <button className={`chip${kind === 'show' ? ' on' : ''}`} onClick={() => setKind('show')}>
            Shows<span className="n">{hits.length - movies}</span>
          </button>
        </div>
      )}

      {q.trim() && !shown.length && <div className="empty">Nothing in your library matches “{q.trim()}”.</div>}

      <div className="grid">
        {shown.map(({ t, at, len, why }) => (
          <PosterCard
            key={t.id}
            t={t}
            name={
              at >= 0 ? (
                <>
                  {t.name.slice(0, at)}
                  <mark>{t.name.slice(at, at + len)}</mark>
                  {t.name.slice(at + len)}
                </>
              ) : (
                t.name
              )
            }
            sub={[t.year, t.kind === 'show' ? 'Show' : 'Movie', why].filter(Boolean).join(' · ')}
          />
        ))}
      </div>
    </main>
  )
}
