import { useMemo, useState } from 'react'
import { COLLECTIONS } from '../../shared/collections'
import { useApp } from '../App'
import { PosterCard } from '../components'
import { Chevron } from '../icons'
import { isWatched } from '../lib'

const SORTS = ['Recently added', 'A to Z', 'Year'] as const

export default function Browse({ kind }: { kind: 'movie' | 'show' }) {
  const { lib } = useApp()
  const [filter, setFilter] = useState('All')
  const [sort, setSort] = useState<(typeof SORTS)[number]>(() => (localStorage.getItem('flick.sort') as never) || 'Recently added')
  const all = lib.titles.filter((t) => t.kind === kind)

  const filters = useMemo(() => {
    const f: { name: string; n: number }[] = [{ name: 'All', n: all.length }]
    for (const c of COLLECTIONS) {
      const n = all.filter((t) => t.collections.includes(c.name)).length
      if (n) f.push({ name: c.name, n })
    }
    const unwatched = all.filter((t) => !isWatched(t, lib)).length
    if (unwatched && unwatched < all.length) f.push({ name: 'Unwatched', n: unwatched })
    return f
  }, [all, lib])

  const shown = useMemo(() => {
    let list = all
    if (filter === 'Unwatched') list = list.filter((t) => !isWatched(t, lib))
    else if (filter !== 'All') list = list.filter((t) => t.collections.includes(filter))
    const by = {
      'Recently added': (a: (typeof all)[0], b: (typeof all)[0]) => b.added - a.added,
      'A to Z': (a: (typeof all)[0], b: (typeof all)[0]) => a.name.replace(/^the /i, '').localeCompare(b.name.replace(/^the /i, '')),
      Year: (a: (typeof all)[0], b: (typeof all)[0]) => (b.year ?? 0) - (a.year ?? 0),
    }[sort]
    return [...list].sort(by)
  }, [all, filter, sort, lib])

  const cycleSort = () => {
    const next = SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length]
    setSort(next)
    localStorage.setItem('flick.sort', next)
  }

  return (
    <main className="page">
      <div className="toolbar">
        <h1 className="page-title">{kind === 'movie' ? 'Movies' : 'Shows'}</h1>
        {filters.map((f) => (
          <button key={f.name} className={`chip${filter === f.name ? ' on' : ''}`} onClick={() => setFilter(f.name)}>
            {f.name}
            <span className="n">{f.n}</span>
          </button>
        ))}
        <div className="spacer" />
        <button className="chip outline" onClick={cycleSort} aria-label={`Sort: ${sort}. Click to change.`} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {sort}
          <Chevron dir="down" size={14} />
        </button>
      </div>
      {shown.length ? (
        <div className="grid">
          {shown.map((t) => (
            <PosterCard key={t.id} t={t} />
          ))}
        </div>
      ) : (
        <div className="empty">{all.length ? 'Nothing matches that filter.' : `No ${kind === 'movie' ? 'movies' : 'shows'} yet.`}</div>
      )}
    </main>
  )
}
