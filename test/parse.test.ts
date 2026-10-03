import { describe, expect, it } from 'vitest'
import { clean, guess, movieName, subSuffix } from '../electron/parse'

describe('guess', () => {
  const movies: [string, string, number | undefined][] = [
    ['Ant-Man 2015 1080p BluRay x264 DTS-JYK.mkv', 'Ant-Man', 2015],
    ['Avengers Age of Ultron (2015) [1080p].mp4', 'Avengers Age of Ultron', 2015],
    ['Captain America Civil War (2016) [1080p] [GRP].mp4', 'Captain America Civil War', 2016],
    ['Dune.2021.1080p.HDRip.x264-GRP.mkv', 'Dune', 2021],
    ['Dune.Part.Two.2024.1080p.WEBRip.x265.mkv', 'Dune Part Two', 2024],
    ['Star.Wars.Episode.IX.-.The.Rise.Of.Skywalker.2019.2160p.4K.BluRay.x265.10bit.AAC5.1-[GRP].mkv', 'Star Wars Episode IX - The Rise Of Skywalker', 2019],
    ['Weathering with You 2019 REPACK.1080p.BluRay.Opus5.1.AV1-Tasokare.mkv', 'Weathering with You', 2019],
    ['Spider-Man.Across.the.Spider-Verse.2023.1080p.WEB-DL.mkv', 'Spider-Man Across the Spider-Verse', 2023],
  ]
  for (const [file, title, year] of movies) {
    it(`reads ${file}`, () => {
      const g = guess(file)
      expect(g?.kind).toBe('movie')
      expect(g?.title).toBe(title)
      expect(g?.year).toBe(year)
    })
  }

  it('reads episodes', () => {
    expect(guess('The.Bear.S03E01.1080p.WEB.h264-ETHEL.mkv')).toEqual({ kind: 'episode', title: 'The Bear', year: undefined, season: 3, episodes: [1] })
    expect(guess('Show.Name.S02E03E04.720p.mkv')).toMatchObject({ kind: 'episode', season: 2, episodes: [3, 4] })
    expect(guess('The Mandalorian S01E01.mp4')).toMatchObject({ kind: 'episode', title: 'The Mandalorian', season: 1, episodes: [1] })
  })

  it('uses the folder name when the file name is useless', () => {
    expect(guess('movie.mkv', 'Past.Lives.2023.1080p.BluRay.x264')).toMatchObject({ kind: 'movie', title: 'Past Lives', year: 2023 })
  })

  it('makes safe folder names', () => {
    expect(clean('Star Wars: The Rise of Skywalker')).toBe('Star Wars - The Rise of Skywalker')
    expect(clean('What? <Really>')).toBe('What Really')
    expect(movieName({ title: 'Dune', year: 2021 })).toBe('Dune (2021)')
  })
})

describe('subSuffix', () => {
  it('reads language and flags', () => {
    expect(subSuffix('English(SDH).srt')).toBe('.eng.sdh')
    expect(subSuffix('Movie.2015.1080p.fre.forced.srt')).toBe('.fre.forced')
    expect(subSuffix('2_English.srt')).toBe('.eng')
    expect(subSuffix('Ant-Man.2015.eng.srt')).toBe('.eng')
    expect(subSuffix('random.srt')).toBe('')
  })
})
