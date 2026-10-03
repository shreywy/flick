// Persistent queue: move -> metadata -> subtitles, for inbox downloads and for library titles missing info.
import fs from 'node:fs'
import path from 'node:path'
import type { QueueItem, QueueState, QueueStatus, QueueStep } from '../shared/types'
import type { DB } from './db'
import { getSetting, noteSub, setSetting } from './db'
import { episodeFiles, fetchMetadata, readMeta } from './metadata'
import { clean, isSample, isVideo, movieName } from './parse'
import { probe, subFormat, subStreams } from './probe'
import { applyPlan, filesIn, inboxEntries, planEntry, stillDownloading, type Roots } from './sorter'
import { decodeSub, guessExt, openSubtitlesHash, QuotaError, rank, saveSub, type SubCandidate, type SubQuery } from './subtitles'
import type { Tmdb } from './tmdb'

export interface SubProvider {
  search(q: SubQuery): Promise<SubCandidate[]>
  download(c: SubCandidate): Promise<Buffer>
}

export interface QueueDeps {
  db: DB
  roots: () => Roots
  ffprobe: () => string
  tmdb: () => Tmdb | null
  subProviders: () => SubProvider[]
  autoSubs: () => boolean
  trash: (p: string) => Promise<void>
  onChange: () => void
  onLibrary: () => void
  minAgeMs?: number
}

interface Row {
  id: number
  kind: 'inbox' | 'library'
  source: string
  name: string
  target: string | null
  step: QueueStep
  status: QueueStatus
  message: string | null
  action: 'fix' | 'subs' | null
  attempts: number
  retry_at: number
  override: string | null
  updated: number
}

const LIMITS: Record<string, number> = { move: 1, meta: 4, subs: 1 }
const WORKING_TEXT: Record<string, string> = { move: 'Moving', meta: 'Getting artwork and info', subs: 'Finding subtitles' }

export class Queue {
  private running = new Map<number, string>()
  private timer?: NodeJS.Timeout
  private changeTimer?: NodeJS.Timeout

  constructor(private d: QueueDeps) {
    const cols = (d.db.prepare('PRAGMA table_info(queue)').all() as { name: string }[]).map((c) => c.name)
    if (!cols.includes('override')) d.db.exec('ALTER TABLE queue ADD COLUMN override TEXT')
    d.db.exec("UPDATE queue SET status = 'waiting' WHERE status = 'working'")
    d.db.prepare("DELETE FROM queue WHERE status = 'done' AND updated < ?").run(Date.now() - 7 * 86400000)
  }

  get paused() {
    return getSetting(this.d.db, 'queuePaused', false)
  }

  setPaused(p: boolean) {
    setSetting(this.d.db, 'queuePaused', p)
    this.changed()
    if (!p) this.pump()
  }

  private changed() {
    clearTimeout(this.changeTimer)
    this.changeTimer = setTimeout(() => this.d.onChange(), 150)
  }

  private rel(p: string) {
    return path.relative(path.dirname(this.d.roots().movies), p).split(path.sep).join(' / ')
  }

  private update(id: number, fields: Partial<Row>) {
    const keys = Object.keys(fields)
    if (!keys.length) return
    this.d.db
      .prepare(`UPDATE queue SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated = ? WHERE id = ?`)
      .run(...keys.map((k) => (fields as Record<string, string | number | null>)[k]), Date.now(), id)
    this.changed()
  }

  private add(kind: Row['kind'], source: string, step: QueueStep, target?: string) {
    const open = this.d.db
      .prepare("SELECT id FROM queue WHERE status != 'done' AND (source = ? OR target = ?)")
      .get(source, target ?? source)
    if (open) return
    const now = Date.now()
    this.d.db
      .prepare("INSERT INTO queue (kind, source, name, target, step, status, created, updated) VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?)")
      .run(kind, source, path.basename(source), target ?? null, step, now, now)
    this.changed()
  }

  /** Look for new downloads and titles without metadata. */
  scan(needsMeta: { folder: string; kind: 'movie' | 'show' }[]) {
    for (const entry of inboxEntries(this.d.roots().inbox)) this.add('inbox', entry, 'move')
    for (const n of needsMeta) this.add('library', n.folder, 'meta', n.folder)
    this.pump()
  }

  /** Re-run items that were waiting on a key or quota, e.g. after settings change. */
  retryWaiting() {
    this.d.db.exec("UPDATE queue SET retry_at = 0 WHERE status IN ('waiting', 'downloading')")
    this.pump()
  }

  start() {
    this.timer = setInterval(() => this.pump(), 15000)
    this.pump()
  }

  stop() {
    clearInterval(this.timer)
  }

  pump() {
    if (this.paused) return
    const now = Date.now()
    const rows = this.d.db
      .prepare("SELECT * FROM queue WHERE status IN ('waiting', 'downloading') AND retry_at <= ? ORDER BY id")
      .all(now) as unknown as Row[]
    for (const r of rows) {
      if (this.running.has(r.id)) continue
      const busy = [...this.running.values()].filter((s) => s === r.step).length
      if (busy >= (LIMITS[r.step] ?? 1)) continue
      this.running.set(r.id, r.step)
      this.update(r.id, { status: 'working', message: WORKING_TEXT[r.step] ?? null })
      this.runStep(r)
        .catch((e: Error) => this.fail(r, e))
        .finally(() => {
          this.running.delete(r.id)
          setImmediate(() => this.pump())
        })
    }
  }

  private fail(r: Row, e: Error) {
    const attempts = r.attempts + 1
    if (attempts >= 3) this.update(r.id, { status: 'attention', message: e.message, attempts })
    else this.update(r.id, { status: 'waiting', message: `Retrying: ${e.message}`, attempts, retry_at: Date.now() + 30000 * attempts })
  }

  private async runStep(r: Row) {
    if (r.step === 'move') return this.stepMove(r)
    if (r.step === 'meta') return this.stepMeta(r)
    if (r.step === 'subs') return this.stepSubs(r)
  }

  private async stepMove(r: Row) {
    if (!fs.existsSync(r.source)) return this.update(r.id, { status: 'attention', message: 'The download is gone from the inbox' })
    const files = filesIn(r.source)
    if (stillDownloading(files, this.d.minAgeMs ?? 10 * 60000)) {
      return this.update(r.id, { status: 'downloading', message: 'Still downloading, will retry', retry_at: Date.now() + 5 * 60000 })
    }
    const force = r.override ? (JSON.parse(r.override) as { title: string; year?: number; kind: 'movie' | 'show' }) : undefined
    const plan = planEntry(r.source, this.d.roots(), force)
    if (!plan.moves.length) {
      return this.update(r.id, { status: 'attention', message: plan.problems[0] ?? "Couldn't read a title", action: 'fix' })
    }
    const [first, ...rest] = plan.titleFolders
    // claim the target first so a library scan running meanwhile doesn't queue it twice
    this.update(r.id, { target: first })
    await applyPlan(r.source, plan, this.d.trash)
    for (const f of rest) this.add('library', f, 'meta', f)
    this.update(r.id, {
      step: 'meta',
      status: 'waiting',
      target: first,
      message: plan.problems.length ? plan.problems.join('; ') : null,
      attempts: 0,
    })
    this.d.onLibrary()
  }

  private kindOf(folder: string): 'movie' | 'show' {
    return path.resolve(path.dirname(folder)).toLowerCase() === path.resolve(this.d.roots().shows).toLowerCase() ? 'show' : 'movie'
  }

  private async stepMeta(r: Row) {
    const folder = r.target!
    const tmdb = this.d.tmdb()
    if (!tmdb) return this.update(r.id, { status: 'waiting', message: 'Needs a TMDB key (Settings, API keys)', retry_at: Date.now() + 3600000 })
    const force = r.override ? (JSON.parse(r.override) as { tmdbId?: number }) : {}
    const meta = await fetchMetadata(tmdb, folder, this.kindOf(folder), { tmdbId: force.tmdbId, overwriteArt: !!force.tmdbId })
    if (!meta) return this.update(r.id, { status: 'attention', message: 'No confident TMDB match', action: 'fix' })
    this.update(r.id, { step: 'subs', status: 'waiting', message: null, action: null, attempts: 0 })
    this.d.onLibrary()
  }

  private async hasEnglish(video: string) {
    const stem = path.basename(video, path.extname(video)).toLowerCase()
    const dir = path.dirname(video)
    const side = fs.readdirSync(dir).some((n) => {
      const l = n.toLowerCase()
      return l.startsWith(stem + '.') && /\.(en|eng|english)(\.|$)/.test(l.slice(stem.length)) && /\.(srt|ass|ssa|vtt)$/.test(l)
    })
    if (side) return true
    const p = await probe(this.d.ffprobe(), video).catch(() => null)
    return !!p && subStreams(p).some((s) => /^en/.test(s.tags?.language ?? '') && subFormat(s.codec_name) !== 'image')
  }

  private async stepSubs(r: Row) {
    const providers = this.d.subProviders()
    if (!this.d.autoSubs() || !providers.length) {
      return this.update(r.id, { step: 'done', status: 'done', message: providers.length ? null : 'Done, no subtitle key set' })
    }
    const folder = r.target!
    const meta = readMeta(folder)
    const kind = this.kindOf(folder)
    const videos =
      kind === 'show'
        ? episodeFiles(folder)
        : fs
            .readdirSync(folder)
            .map((n) => path.join(folder, n))
            .filter((p) => isVideo(p) && !isSample(p, fs.statSync(p).size))
            .map((p) => ({ path: p, season: undefined as number | undefined, episode: undefined as number | undefined }))
    let missing = 0
    for (const v of videos) {
      if (await this.hasEnglish(v.path)) continue
      const q: SubQuery = {
        kind: kind === 'show' ? 'episode' : 'movie',
        tmdbId: meta?.tmdbId,
        title: meta?.title ?? path.basename(folder),
        year: meta?.year,
        season: v.season,
        episode: v.episode,
        hash: openSubtitlesHash(v.path),
        fileName: path.basename(v.path),
      }
      const got = await downloadBestSub(providers, q, v.path).catch((e) => {
        if (e instanceof QuotaError) throw e
        return null
      })
      if (got) noteSub(this.d.db, got.path, got.release)
      else missing++
    }
    if (missing) {
      this.update(r.id, { step: 'done', status: 'attention', message: `No English subtitles for ${missing === 1 ? 'this file' : `${missing} files`}`, action: 'subs' })
    } else this.update(r.id, { step: 'done', status: 'done', message: null, action: null })
    this.d.onLibrary()
  }

  /** Fix match: a TMDB pick for a title, or a title override for an unreadable download. */
  fix(id: number, pick: { tmdbId: number; kind: 'movie' | 'show'; title: string; year?: number }) {
    const r = this.d.db.prepare('SELECT * FROM queue WHERE id = ?').get(id) as unknown as Row | undefined
    if (!r) return
    if (r.step !== 'move' && r.target) {
      const moved = renameTitle(r.target, pick)
      if (moved !== r.target) this.update(id, { target: moved })
    }
    this.update(id, {
      override: JSON.stringify(pick),
      status: 'waiting',
      step: r.step === 'move' ? 'move' : 'meta',
      message: null,
      action: null,
      attempts: 0,
      retry_at: 0,
    })
    this.pump()
  }

  /** Re-run metadata for a title already in the library (Fix match from a title page). */
  refix(folder: string, pick: { tmdbId: number; kind: 'movie' | 'show'; title: string; year?: number }) {
    folder = renameTitle(folder, pick)
    const now = Date.now()
    this.d.db
      .prepare("INSERT INTO queue (kind, source, name, target, step, status, override, created, updated) VALUES ('library', ?, ?, ?, 'meta', 'waiting', ?, ?, ?)")
      .run(folder, path.basename(folder), folder, JSON.stringify(pick), now, now)
    this.changed()
    this.pump()
  }

  retry(id: number) {
    this.update(id, { status: 'waiting', step: 'subs', action: null, message: null, attempts: 0, retry_at: 0 })
    this.pump()
  }

  state(): QueueState {
    const rows = this.d.db.prepare('SELECT * FROM queue ORDER BY id DESC LIMIT 5000').all() as unknown as Row[]
    const counts = { all: 0, waiting: 0, working: 0, attention: 0, done: 0, downloading: 0 } as QueueState['counts']
    for (const r of this.d.db.prepare('SELECT status, COUNT(*) n FROM queue GROUP BY status').all() as { status: QueueStatus; n: number }[]) {
      counts[r.status] = r.n
      counts.all += r.n
    }
    const items: QueueItem[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      target: r.target ? this.rel(r.target) : undefined,
      step: r.step,
      status: r.status,
      message: r.message ?? undefined,
      action: r.action ?? undefined,
      updated: r.updated,
    }))
    // keep the list readable: work first, then problems, then waiting, then done
    const order: Record<QueueStatus, number> = { working: 0, attention: 1, waiting: 2, downloading: 3, done: 4 }
    items.sort((a, b) => order[a.status] - order[b.status] || (a.status === 'done' ? b.updated - a.updated : a.id - b.id))
    return { items, counts, paused: this.paused, doneTotal: counts.done }
  }
}

export async function downloadBestSub(providers: SubProvider[], q: SubQuery, video: string) {
  for (const p of providers) {
    let cands: SubCandidate[]
    try {
      cands = await p.search(q)
    } catch (e) {
      if (providers.length === 1) throw e
      continue
    }
    for (const c of rank(cands, q.fileName).slice(0, 3)) {
      try {
        const buf = await p.download(c)
        const text = decodeSub(buf)
        if (text.trim().length < 50) continue
        return { path: saveSub(video, text, guessExt(text), c.hearingImpaired), release: c.release }
      } catch (e) {
        if (e instanceof QuotaError) throw e
      }
    }
  }
  return null
}

/** After a Fix match, give a badly named movie folder (and its files) the real title. Shows keep their folder. */
export function renameTitle(folder: string, pick: { kind: 'movie' | 'show'; title: string; year?: number }) {
  if (pick.kind !== 'movie') return folder
  const name = clean(movieName(pick))
  const oldName = path.basename(folder)
  if (name.toLowerCase() === oldName.toLowerCase()) return folder
  const dest = path.join(path.dirname(folder), name)
  if (fs.existsSync(dest)) return folder
  for (const f of fs.readdirSync(folder)) {
    if (f.toLowerCase().startsWith(oldName.toLowerCase())) fs.renameSync(path.join(folder, f), path.join(folder, name + f.slice(oldName.length)))
  }
  fs.renameSync(folder, dest)
  return dest
}
