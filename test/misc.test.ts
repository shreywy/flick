import { describe, expect, it } from 'vitest'
import { collectionsFor } from '../shared/collections'
import type { Meta, Title } from '../shared/types'
import { similarity } from '../electron/tmdb'
import { rank } from '../electron/subtitles'
import { activeCues, parseCues } from '../src/subs'
import { continueWatching, searchLibrary } from '../src/lib'

const meta = (m: Partial<Meta>): Meta => ({ source: 'tmdb', kind: 'movie', title: '', genres: [], studios: [], countries: [], cast: [], directors: [], ...m })

describe('collections', () => {
  it('sorts titles into rows', () => {
    expect(collectionsFor(meta({ title: 'Ant-Man', studios: ['Marvel Studios'], collection: 'Ant-Man Collection' }))).toEqual(['Marvel'])
    expect(collectionsFor(meta({ title: 'Solo: A Star Wars Story', studios: ['Lucasfilm Ltd.'], collection: 'Star Wars Anthology Collection' }))).toEqual(['Star Wars'])
    expect(collectionsFor(meta({ title: 'The Mandalorian', kind: 'show', studios: ['Lucasfilm Ltd.', 'Disney+'] }))).toEqual(['Star Wars'])
    expect(collectionsFor(meta({ title: 'Suzume', genres: ['Animation', 'Drama'], originalLanguage: 'ja' }))).toEqual(['Anime'])
    expect(collectionsFor(meta({ title: 'Interstellar', genres: ['Science Fiction'] }))).toEqual([])
  })
})

describe('tmdb matching', () => {
  it('scores close titles high', () => {
    expect(similarity('Star Wars - The Rise of Skywalker', 'Star Wars: The Rise of Skywalker')).toBe(1)
    expect(similarity('Captain America Civil War', 'Captain America: Civil War')).toBe(1)
    expect(similarity('Your Name', 'Your Name.')).toBe(1)
    expect(similarity('Dune', 'Dune: Part Two')).toBeLessThan(0.75)
  })
})

describe('subtitle ranking', () => {
  it('prefers the same release, then the closest name', () => {
    const c = (release: string, extra: object = {}) => ({ provider: 'subdl' as const, id: release, release, hearingImpaired: false, sameRelease: false, downloads: 0, ...extra })
    const r = rank([c('Dune.2021.720p.BluRay'), c('Dune.2021.1080p.HDRip.x264-GRP'), c('Dune 2021 web', { sameRelease: true })], 'Dune.2021.1080p.HDRip.x264-GRP.mkv')
    expect(r.map((x) => x.release)).toEqual(['Dune 2021 web', 'Dune.2021.1080p.HDRip.x264-GRP', 'Dune.2021.720p.BluRay'])
  })
})

describe('cues', () => {
  const srt = `1\n00:00:01,000 --> 00:00:03,500\n<i>Hello</i> <font color="red">there</font>\n\n2\n00:00:03,000 --> 00:00:05,000\nSecond & line\nwraps\n`
  it('parses SRT and keeps italics only', () => {
    const cues = parseCues(srt)
    expect(cues).toHaveLength(2)
    expect(cues[0].html).toBe('<i>Hello</i> there')
    expect(cues[1].html).toBe('Second &amp; line<br>wraps')
  })
  it('finds overlapping cues', () => {
    const cues = parseCues(srt)
    expect(activeCues(cues, 3.2).length).toBe(2)
    expect(activeCues(cues, 0.5)).toEqual([])
    expect(activeCues(cues, 4.9)[0].start).toBe(3)
  })
})

describe('library', () => {
  const t = (id: number, name: string, extra: Partial<Title> = {}): Title => ({ id, kind: 'movie', folder: '', name, added: id, collections: [], fileId: id, ...extra })
  it('searches titles then cast', () => {
    const titles = [t(1, 'Star Wars: The Last Jedi'), t(2, 'Solo: A Star Wars Story'), t(3, 'Interstellar', { meta: meta({ title: 'Interstellar', cast: ['Matthew McConaughey'] }) })]
    expect(searchLibrary(titles, 'star').map((h) => h.t.id)).toEqual([1, 2])
    expect(searchLibrary(titles, 'mcconaughey')[0].t.id).toBe(3)
  })
  it('lists what you were watching, newest first', () => {
    const lib = {
      titles: [t(1, 'A'), t(2, 'B'), t(3, 'C')],
      progress: {
        1: { fileId: 1, position: 600, duration: 6000, watched: false, updated: 10 },
        2: { fileId: 2, position: 600, duration: 6000, watched: false, updated: 20 },
        3: { fileId: 3, position: 0, duration: 6000, watched: true, updated: 30 },
      },
    }
    expect(continueWatching(lib).map((r) => r.title.id)).toEqual([2, 1])
  })
})
