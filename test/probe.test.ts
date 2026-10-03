import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { choosePlan, details, streamArgs, type Probe } from '../electron/probe'

const fx = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${n}.json`), 'utf8')) as Probe

describe('choosePlan on the real library', () => {
  it('converts DTS and AC3 audio', () => {
    expect(choosePlan('Dune.mkv', fx('dune')).mode).toBe('convert')
    expect(choosePlan('Ant-Man (2015).mkv', fx('antman')).mode).toBe('convert')
    expect(choosePlan('The Mandalorian S01E01.mp4', fx('mando')).mode).toBe('convert')
  })
  it('plays mp4 with AAC directly', () => {
    expect(choosePlan('Interstellar (2014).mp4', fx('interstellar')).mode).toBe('direct')
  })
  it('remuxes mkv that only needs a new container', () => {
    expect(choosePlan('sw9.mkv', fx('sw9')).mode).toBe('remux')
  })
  it('converts 5.1 Opus, which Chromium plays unreliably in MP4', () => {
    expect(choosePlan('weathering.mkv', fx('weathering')).mode).toBe('convert')
  })
})

describe('streamArgs', () => {
  it('copies video, converts DTS to AAC 5.1 and starts at the keyframe', () => {
    const a = streamArgs('x.mkv', 598.32, 0, fx('antman'), 'h264_nvenc')
    expect(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 2)).toEqual(['-ss', '598.320'])
    expect(a).toContain('copy')
    expect(a.join(' ')).toContain('-c:a aac -ac 6 -b:a 384k')
    expect(a.join(' ')).toContain('frag_keyframe+empty_moov+default_base_moof')
  })
  it('tags HEVC as hvc1 so Chromium accepts it', () => {
    expect(streamArgs('x.mkv', 0, 0, fx('sw9'), 'h264_nvenc').join(' ')).toContain('-tag:v hvc1')
  })
  it('turns 5.1 Opus into AAC 5.1', () => {
    expect(streamArgs('x.mkv', 0, 0, fx('weathering'), 'h264_nvenc').join(' ')).toContain('-c:a aac -ac 6')
  })
})

describe('details', () => {
  it('describes the file', () => {
    expect(details(fx('antman'))).toMatch(/^1080p · H\.264 · DTS 5\.1 · 3\.\d GB$/)
    expect(details(fx('sw9'))).toMatch(/^4K · HEVC 10-bit · AAC 5\.1/)
  })
})
