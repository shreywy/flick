import type { Meta } from './types'

// Library rows on Home and filter buttons on Movies / Shows.
// Each rule looks only at flick.json data, so new downloads land in the right row on their own.
export const COLLECTIONS: { name: string; test: (m: Meta) => boolean }[] = [
  {
    name: 'Marvel',
    test: (m) =>
      m.studios.some((s) => /marvel studios/i.test(s)) ||
      /marvel cinematic universe/i.test((m.keywords ?? []).join('|')) ||
      /^(the avengers|avengers|iron man|thor|captain america|guardians of the galaxy|ant-man|doctor strange|black panther|spider-man: (homecoming|far from home|no way home)) collection$/i.test(
        m.collection ?? '',
      ),
  },
  {
    name: 'Star Wars',
    test: (m) => /star wars/i.test(m.collection ?? '') || /star wars/i.test(m.title) || (m.studios.some((s) => /lucasfilm/i.test(s)) && /star wars/i.test((m.keywords ?? []).join('|'))) || /^the mandalorian$|^andor$|^ahsoka$|^the book of boba fett$/i.test(m.title),
  },
  {
    name: 'Anime',
    test: (m) =>
      m.genres.some((g) => /animation/i.test(g)) &&
      (m.originalLanguage === 'ja' || m.countries.some((c) => /japan/i.test(c))),
  },
]

export function collectionsFor(m: Meta | undefined): string[] {
  if (!m) return []
  return COLLECTIONS.filter((c) => c.test(m)).map((c) => c.name)
}
