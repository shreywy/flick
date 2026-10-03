import { useEffect, useState } from 'react'
import type { TmdbCandidate } from '../shared/types'
import { api } from './api'
import { Spinner } from './icons'

/** Search TMDB and pick the right title. */
export default function FixMatch({
  initial,
  kind: initialKind,
  onPick,
  onClose,
}: {
  initial: string
  kind: 'movie' | 'show'
  onPick: (c: TmdbCandidate) => void
  onClose: () => void
}) {
  const [q, setQ] = useState(initial)
  const [kind, setKind] = useState(initialKind)
  const [results, setResults] = useState<TmdbCandidate[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!q.trim()) return setResults([])
    setBusy(true)
    const t = setTimeout(() => {
      api
        .searchTmdb(kind, q.trim())
        .then(setResults)
        .finally(() => setBusy(false))
    }, 300)
    return () => clearTimeout(t)
  }, [q, kind])

  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [onClose])

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="Fix match">
        <h3>Fix match</h3>
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Title to search for" />
          <button className={`chip${kind === 'movie' ? ' on' : ''}`} onClick={() => setKind('movie')}>
            Movie
          </button>
          <button className={`chip${kind === 'show' ? ' on' : ''}`} onClick={() => setKind('show')}>
            Show
          </button>
        </div>
        {busy && !results && <Spinner />}
        {results && !results.length && !busy && <div className="ok">No results. Try fewer words, or no year.</div>}
        {results?.slice(0, 12).map((c) => (
          <button key={c.id} className="pick" onClick={() => onPick(c)}>
            {c.poster ? <img src={c.poster} alt="" /> : <div className="ph" />}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0 }}>
              <strong>
                {c.title}
                {c.year ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> ({c.year})</span> : null}
              </strong>
              {c.overview && <span className="ov">{c.overview}</span>}
            </div>
          </button>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn small" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
