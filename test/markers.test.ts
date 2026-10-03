import { describe, expect, it } from 'vitest'
import { longestMatch } from '../electron/markers'

const STEP = 4096 / 3 / 11025
let seed = 7
const rnd = () => ((seed ^= seed << 13), (seed ^= seed >>> 17), (seed ^= seed << 5), seed >>> 0)
const noise = (n: number) => Array.from({ length: n }, rnd)

describe('longestMatch', () => {
  it('finds a shared stretch at different positions in each episode', () => {
    const theme = noise(200) // about 25 seconds
    const a = new Uint32Array([...noise(300), ...theme, ...noise(400)])
    const b = new Uint32Array([...noise(100), ...theme, ...noise(500)])
    const m = longestMatch(a, b, 12)!
    expect(m.a).toBeCloseTo(300 * STEP, 0)
    expect(m.b).toBeCloseTo(100 * STEP, 0)
    expect(m.len).toBeGreaterThan(24)
  })
  it('finds nothing in unrelated audio', () => {
    expect(longestMatch(new Uint32Array(noise(800)), new Uint32Array(noise(800)), 12)).toBeNull()
  })
})
