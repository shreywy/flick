// Local HTTP server for artwork, video, subtitles and seek previews. Bound to 127.0.0.1 and gated by a random token.
import { spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import type { Probe } from './probe'
import { streamArgs, subFormat, subStreams, videoStream } from './probe'

export interface ServerDeps {
  allowedRoots: () => string[]
  cacheDir: string
  ffmpeg: () => string
  encoder: () => string
  file: (id: number) => Promise<{ path: string; probe: Probe } | undefined>
  log: (msg: string) => void
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8', '.ass': 'text/plain; charset=utf-8', '.ssa': 'text/plain; charset=utf-8',
}

export const SPRITE = { every: 10, cols: 10, rows: 10, width: 320 }

export class MediaServer {
  token = crypto.randomBytes(16).toString('hex')
  port = 0
  private server?: http.Server
  private streams = new Set<ChildProcess>()
  private jobs = new Map<string, Promise<string>>()
  private sprites = new Map<number, ChildProcess>()

  constructor(private d: ServerDeps) {}

  get base() {
    return `http://127.0.0.1:${this.port}`
  }

  url(route: string, params: Record<string, string | number> = {}) {
    const u = new URL(this.base + route)
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v))
    u.searchParams.set('t', this.token)
    return u.toString()
  }

  artUrl = (p: string) => {
    let v = 0
    try {
      v = Math.round(fs.statSync(p).mtimeMs)
    } catch {}
    return this.url('/art', { p, v })
  }

  async start() {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((e: Error) => {
        this.d.log(`server error ${req.url}: ${e.message}`)
        if (!res.headersSent) res.writeHead(500)
        res.end()
      })
    })
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r))
    this.port = (this.server!.address() as AddressInfo).port
  }

  stop() {
    for (const p of [...this.streams, ...this.sprites.values()]) p.kill('SIGKILL')
    this.server?.close()
  }

  private allowed(p: string) {
    const full = path.resolve(p).toLowerCase()
    return [...this.d.allowedRoots(), this.d.cacheDir].some((r) => full.startsWith(path.resolve(r).toLowerCase() + path.sep))
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const u = new URL(req.url ?? '/', this.base)
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (u.searchParams.get('t') !== this.token) return void res.writeHead(403).end()
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts[0] === 'art') {
      const p = u.searchParams.get('p') ?? ''
      if (!this.allowed(p) || !fs.existsSync(p)) return void res.writeHead(404).end()
      res.setHeader('Cache-Control', 'max-age=31536000, immutable')
      return this.sendFile(req, res, p)
    }
    const id = Number(parts[1])
    if (parts[0] === 'sprite') {
      const p = path.join(this.d.cacheDir, 'sprites', String(id), `${parts[2]}.jpg`)
      if (!fs.existsSync(p)) return void res.writeHead(404).end()
      return this.sendFile(req, res, p)
    }
    const f = await this.d.file(id)
    if (!f) return void res.writeHead(404).end()
    if (parts[0] === 'file') return this.sendFile(req, res, f.path)
    if (parts[0] === 'stream') return this.stream(req, res, f, Number(u.searchParams.get('start') ?? 0), Number(u.searchParams.get('audio') ?? 0))
    if (parts[0] === 'sub') {
      const track = u.searchParams.get('track') ?? ''
      const text = await this.subText(id, f, track)
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      return void res.end(text)
    }
    res.writeHead(404).end()
  }

  private sendFile(req: http.IncomingMessage, res: http.ServerResponse, p: string) {
    const size = fs.statSync(p).size
    const type = MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream'
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/)
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start >= size) return void res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
      fs.createReadStream(p, { start, end }).pipe(res)
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size })
      fs.createReadStream(p).pipe(res)
    }
  }

  private stream(req: http.IncomingMessage, res: http.ServerResponse, f: { path: string; probe: Probe }, start: number, audio: number) {
    const args = streamArgs(f.path, start, audio, f.probe, this.d.encoder())
    const proc = spawn(this.d.ffmpeg(), args, { windowsHide: true })
    this.streams.add(proc)
    let err = ''
    proc.stderr.on('data', (b: Buffer) => (err = (err + b.toString()).slice(-2000)))
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' })
    proc.stdout.pipe(res)
    const kill = () => {
      if (proc.exitCode === null) proc.kill('SIGKILL')
    }
    req.on('close', kill)
    res.on('close', kill)
    proc.on('exit', (code) => {
      this.streams.delete(proc)
      if (code && code !== 255 && err && !res.destroyed) this.d.log(`ffmpeg exited ${code}: ${err.trim()}`)
    })
  }

  /** Subtitle text for a track id: "emb:N" (Nth subtitle stream) or "file:<path>". */
  private async subText(id: number, f: { path: string; probe: Probe }, track: string) {
    if (track.startsWith('file:')) {
      const p = track.slice(5)
      if (!this.allowed(p)) throw new Error('subtitle outside library')
      return fs.readFileSync(p, 'utf8').replace(/^﻿/, '')
    }
    const n = Number(track.split(':')[1])
    const s = subStreams(f.probe)[n]
    if (!s) throw new Error('no such subtitle stream')
    const fmt = subFormat(s.codec_name)
    if (fmt === 'image') throw new Error('image subtitles are not supported')
    const ext = fmt === 'ass' ? 'ass' : 'srt'
    const out = path.join(this.d.cacheDir, 'subs', `${id}-${n}.${ext}`)
    if (fs.existsSync(out)) return fs.readFileSync(out, 'utf8')
    let job = this.jobs.get(out)
    if (!job) {
      job = new Promise<string>((resolve, reject) => {
        fs.mkdirSync(path.dirname(out), { recursive: true })
        const tmp = out + '.part.' + ext
        const p = spawn(this.d.ffmpeg(), ['-v', 'error', '-y', '-i', f.path, '-map', `0:s:${n}`, '-f', ext, tmp], { windowsHide: true })
        let err = ''
        p.stderr.on('data', (b: Buffer) => (err += b.toString()))
        p.on('exit', (code) => {
          if (code === 0) {
            fs.renameSync(tmp, out)
            resolve(out)
          } else reject(new Error(`subtitle extraction failed: ${err.slice(-300)}`))
        })
      }).finally(() => this.jobs.delete(out))
      this.jobs.set(out, job)
    }
    return fs.readFileSync(await job, 'utf8')
  }

  /** Pulls every usable embedded subtitle out in one read of the file, so big MKVs are only read once. */
  prepareSubs(id: number, f: { path: string; probe: Probe }, wanted: number[]) {
    const todo = wanted
      .map((n) => {
        const fmt = subFormat(subStreams(f.probe)[n]?.codec_name)
        const ext = fmt === 'ass' ? 'ass' : 'srt'
        return { n, ext, out: path.join(this.d.cacheDir, 'subs', `${id}-${n}.${ext}`) }
      })
      .filter((t) => !fs.existsSync(t.out) && !this.jobs.has(t.out))
    if (!todo.length) return
    fs.mkdirSync(path.join(this.d.cacheDir, 'subs'), { recursive: true })
    const args = ['-v', 'error', '-y', '-i', f.path]
    for (const t of todo) args.push('-map', `0:s:${t.n}`, '-f', t.ext, `${t.out}.part.${t.ext}`)
    const batch = new Promise<void>((resolve, reject) => {
      const p = spawn(this.d.ffmpeg(), args, { windowsHide: true })
      let err = ''
      p.stderr.on('data', (b: Buffer) => (err += b.toString()))
      p.on('exit', (code) => {
        for (const t of todo) if (fs.existsSync(`${t.out}.part.${t.ext}`)) fs.renameSync(`${t.out}.part.${t.ext}`, t.out)
        if (code === 0) resolve()
        else reject(new Error(`subtitle extraction failed: ${err.slice(-300)}`))
      })
    })
    for (const t of todo) {
      const job = batch.then(() => t.out).finally(() => this.jobs.delete(t.out))
      job.catch(() => undefined)
      this.jobs.set(t.out, job)
    }
  }

  /** Builds seek-preview sheets in the background, once per file. */
  ensureSprites(id: number, f: { path: string; probe: Probe }) {
    const dir = path.join(this.d.cacheDir, 'sprites', String(id))
    const done = path.join(dir, 'done')
    const v = videoStream(f.probe)
    const aspect = v?.width && v?.height ? v.height / v.width : 9 / 16
    const info = { every: SPRITE.every, cols: SPRITE.cols, rows: SPRITE.rows, width: SPRITE.width, height: Math.round((SPRITE.width * aspect) / 2) * 2 }
    if (fs.existsSync(done) || this.sprites.has(id)) return info
    fs.mkdirSync(dir, { recursive: true })
    const p = spawn(
      this.d.ffmpeg(),
      ['-v', 'error', '-y', '-skip_frame', 'nokey', '-i', f.path, '-an', '-sn', '-vf',
        `fps=1/${SPRITE.every},scale=${SPRITE.width}:${info.height},tile=${SPRITE.cols}x${SPRITE.rows}`, '-fps_mode', 'vfr', '-q:v', '5', path.join(dir, '%d.jpg')],
      { windowsHide: true },
    )
    this.sprites.set(id, p)
    p.on('exit', (code) => {
      this.sprites.delete(id)
      if (code === 0) fs.writeFileSync(done, '')
    })
    return info
  }
}
