import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyPlan, planEntry, stillDownloading, filesIn, type Roots } from '../electron/sorter'

let dir: string
let roots: Roots

const touch = (p: string, size = 1024, ageMin = 60) => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, Buffer.alloc(size))
  const t = new Date(Date.now() - ageMin * 60000)
  fs.utimesSync(p, t, t)
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flick-'))
  roots = { inbox: path.join(dir, 'Shows and Movies'), movies: path.join(dir, 'Movies'), shows: path.join(dir, 'TV Shows') }
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('sorter', () => {
  it('moves a movie folder with subs and recycles the leftovers', async () => {
    const e = path.join(roots.inbox, 'Past.Lives.2023.1080p.BluRay.x264')
    touch(path.join(e, 'Past.Lives.2023.1080p.BluRay.x264.mkv'))
    touch(path.join(e, 'Subs', '2_English.srt'))
    touch(path.join(e, 'Subs', '3_French.srt'))
    touch(path.join(e, 'Sample', 'sample.mkv'))
    touch(path.join(e, 'GRP.txt'))
    const plan = planEntry(e, roots)
    expect(plan.problems).toEqual([])
    const trashed: string[] = []
    await applyPlan(e, plan, async (p) => void trashed.push(p))
    const folder = path.join(roots.movies, 'Past Lives (2023)')
    expect(fs.readdirSync(folder).sort()).toEqual(['Past Lives (2023).eng.srt', 'Past Lives (2023).fre.srt', 'Past Lives (2023).mkv'])
    expect(trashed).toEqual([e])
  })

  it('puts episodes in an existing show folder', async () => {
    fs.mkdirSync(path.join(roots.shows, 'The Bear', 'Season 3'), { recursive: true })
    const e = path.join(roots.inbox, 'The.Bear.S03E02.1080p.WEB.h264-ETHEL.mkv')
    touch(e)
    const plan = planEntry(e, roots)
    await applyPlan(e, plan, async () => undefined)
    expect(fs.existsSync(path.join(roots.shows, 'The Bear', 'Season 3', 'The Bear S03E02.mkv'))).toBe(true)
    expect(plan.titleFolders).toEqual([path.join(roots.shows, 'The Bear')])
  })

  it('never overwrites', () => {
    touch(path.join(roots.movies, 'Dune (2021)', 'Dune (2021).mkv'))
    const e = path.join(roots.inbox, 'Dune.2021.1080p.WEB.mkv')
    touch(e)
    const plan = planEntry(e, roots)
    expect(plan.moves).toEqual([])
    expect(plan.problems[0]).toMatch(/already exists/)
  })

  it('waits for downloads to finish', () => {
    const e = path.join(roots.inbox, 'Some.Movie.2024.1080p')
    touch(path.join(e, 'Some.Movie.2024.1080p.mkv'), 1024, 1)
    expect(stillDownloading(filesIn(e), 10 * 60000)).toBe(true)
    touch(path.join(e, 'Some.Movie.2024.1080p.mkv'), 1024, 30)
    touch(path.join(e, 'part.mkv.!qb'), 10, 30)
    expect(stillDownloading(filesIn(e), 10 * 60000)).toBe(true)
  })

  it('uses a Fix match title for unreadable names', async () => {
    const e = path.join(roots.inbox, 'video_final_v2.mp4')
    touch(e)
    const plan = planEntry(e, roots, { kind: 'movie', title: 'Past Lives', year: 2023 })
    expect(plan.moves[0].dst).toBe(path.join(roots.movies, 'Past Lives (2023)', 'Past Lives (2023).mp4'))
  })
})
