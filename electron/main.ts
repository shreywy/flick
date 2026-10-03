import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SUB_STYLE, type PlayInfo, type Settings, type SubTrack } from '../shared/types'
import { getSetting, noteSub, openDb, setSetting, subRelease, type DB } from './db'
import { buildLibrary, fileRow, progressKey, scanLibrary } from './library'
import { readMeta } from './metadata'
import { sidecarLang } from './parse'
import { audioTracks, choosePlan, details, detectCrop, streamMime, keyframeBefore, langName, probe, subFormat, subStreams, type Crop, type Probe } from './probe'
import { downloadBestSub, Queue, type SubProvider } from './queue'
import { MediaServer } from './server'
import { decodeSub, guessExt, openSubtitlesHash, OpenSubtitles, QuotaError, rank, saveSub, SubDL, type SubCandidate, type SubQuery } from './subtitles'
import { MarkerFinder } from './markers'
import { Tmdb } from './tmdb'

app.setName('Flick')
const E2E = !!process.env.FLICK_E2E
if (process.env.FLICK_DATA) app.setPath('userData', process.env.FLICK_DATA)
if (!app.requestSingleInstanceLock()) app.quit()

const dataDir = app.getPath('userData')
fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true })
const logFile = path.join(dataDir, 'logs', 'flick.log')

function log(msg: string) {
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, logFile + '.1')
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`)
  } catch {}
}

let db: DB
let win: BrowserWindow | null = null
let server: MediaServer
let queue: Queue
let markers: MarkerFinder
let encoder = 'libx264'
let osClient: OpenSubtitles | null = null

const SECRET_KEYS = ['tmdbKey', 'osKey', 'osPass', 'subdlKey'] as const
type FullSettings = Settings & { subdlKey: string; setupDone: boolean }

const DEFAULTS: FullSettings = {
  mediaRoot: 'E:\\Media',
  tmdbKey: '',
  osKey: '',
  osUser: '',
  osPass: '',
  subdlKey: '',
  autoSubs: true,
  autoplayNext: true,
  watchedAt: 0.92,
  skipSeconds: 10,
  ffmpegDir: fs.existsSync('C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe') ? 'C:\\Program Files\\ffmpeg\\bin' : '',
  subStyle: DEFAULT_SUB_STYLE,
  sortAuto: true,
  setupDone: false,
}

function settings(): FullSettings {
  const s = { ...DEFAULTS, ...getSetting<Partial<FullSettings>>(db, 'settings', {}) }
  s.subStyle = { ...DEFAULT_SUB_STYLE, ...s.subStyle }
  for (const k of SECRET_KEYS) {
    const enc = getSetting<string>(db, `secret:${k}`, '')
    if (!enc) continue
    try {
      s[k] = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(enc, 'base64')) : enc
    } catch {
      s[k] = ''
    }
  }
  return s
}

function saveSettings(patch: Partial<FullSettings>) {
  const cur = getSetting<Partial<FullSettings>>(db, 'settings', {})
  const plain: Record<string, unknown> = { ...cur }
  for (const [k, v] of Object.entries(patch)) {
    if ((SECRET_KEYS as readonly string[]).includes(k)) {
      const value = String(v ?? '').trim()
      setSetting(db, `secret:${k}`, value && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value).toString('base64') : value)
    } else plain[k] = v
  }
  setSetting(db, 'settings', plain)
}

const roots = () => {
  const r = settings().mediaRoot
  return { inbox: path.join(r, 'Shows and Movies'), movies: path.join(r, 'Movies'), shows: path.join(r, 'TV Shows') }
}
const bin = (name: string) => {
  const dir = settings().ffmpegDir
  return dir ? path.join(dir, `${name}.exe`) : name
}

function tmdb() {
  const k = settings().tmdbKey
  return k ? new Tmdb(k) : null
}

function subProviders(): SubProvider[] {
  const s = settings()
  const out: SubProvider[] = []
  if (s.osKey) {
    if (!osClient || (osClient as unknown as { key: string }).key !== s.osKey) osClient = new OpenSubtitles(s.osKey, s.osUser, s.osPass)
    out.push(osClient)
  }
  if (s.subdlKey) out.push(new SubDL(s.subdlKey))
  return out
}

async function fileProbe(id: number): Promise<{ path: string; probe: Probe } | undefined> {
  const row = fileRow(db, id)
  if (!row) return undefined
  if (row.probe) return { path: row.path, probe: JSON.parse(row.probe) as Probe }
  const p = await probe(bin('ffprobe'), row.path)
  db.prepare('UPDATE files SET probe = ? WHERE id = ?').run(JSON.stringify(p), id)
  return { path: row.path, probe: p }
}

let libTimer: NodeJS.Timeout | undefined
function libraryChanged() {
  clearTimeout(libTimer)
  libTimer = setTimeout(() => {
    try {
      scanLibrary(db, roots())
    } catch (e) {
      log(`scan failed: ${(e as Error).message}`)
    }
    win?.webContents.send('library:changed')
  }, 400)
}

function fullScan() {
  if (!settings().setupDone) return
  try {
    const needs = scanLibrary(db, roots())
    if (settings().sortAuto) queue.scan(needs)
    else queue.scan(needs.length ? needs : [])
  } catch (e) {
    log(`scan failed: ${(e as Error).message}`)
  }
}

function sidecars(video: string): SubTrack[] {
  const dir = path.dirname(video)
  const stem = path.basename(video, path.extname(video))
  const out: SubTrack[] = []
  for (const n of fs.readdirSync(dir)) {
    if (!n.toLowerCase().startsWith(stem.toLowerCase() + '.')) continue
    const ext = path.extname(n).toLowerCase()
    if (!['.srt', '.ass', '.ssa', '.vtt'].includes(ext)) continue
    const lang = sidecarLang(stem, n)
    if (lang && lang !== 'eng') continue
    const flags = n.toLowerCase().slice(stem.length)
    const sdh = /\.(sdh|cc)\b/.test(flags)
    const forced = /\.forced\b/.test(flags)
    const release = subRelease(db, path.join(dir, n))
    out.push({
      id: `file:${path.join(dir, n)}`,
      label: `English${sdh ? ' SDH' : ''}${forced ? ' (forced)' : ''}`,
      detail: release ? `Downloaded · ${release}` : `File, ${ext.slice(1).toUpperCase()}`,
      language: 'eng',
      format: ext === '.ass' || ext === '.ssa' ? 'ass' : 'text',
    })
  }
  return out
}

function subTracks(fileId: number, video: string, p: Probe): SubTrack[] {
  const files = sidecars(video)
  const emb = subStreams(p)
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.tags?.language || /^en/.test(s.tags.language))
    .map(({ s, i }): SubTrack => {
      const fmt = subFormat(s.codec_name)
      const forced = !!s.disposition?.forced || /forced/i.test(s.tags?.title ?? '')
      const sdh = /sdh|hearing/i.test(s.tags?.title ?? '')
      return {
        id: `emb:${i}`,
        label: `${langName(s.tags?.language) ?? 'Unknown'}${sdh ? ' SDH' : ''}${forced ? ' (forced)' : ''}`,
        detail: fmt === 'image' ? "Image subtitles aren't supported yet" : `Built in${s.tags?.title && !sdh && !forced ? `, ${s.tags.title}` : ''}`,
        language: s.tags?.language,
        format: fmt,
      }
    })
  for (const t of [...files, ...emb]) if (t.format !== 'image') t.url = server.url(`/sub/${fileId}`, { track: t.id })
  return [...files, ...emb]
}

function defaultSub(tracks: SubTrack[]) {
  const usable = tracks.filter((t) => t.format !== 'image' && !/forced/.test(t.label))
  return (usable.find((t) => t.id.startsWith('file:') && !/SDH/.test(t.label)) ?? usable.find((t) => !/SDH/.test(t.label)) ?? usable[0])?.id
}

async function playInfo(fileId: number): Promise<PlayInfo> {
  const f = await fileProbe(fileId)
  if (!f) throw new Error('File not found')
  const row = fileRow(db, fileId)!
  const plan = choosePlan(f.path, f.probe)
  const meta = readMeta(row.folder)
  const prog = db.prepare('SELECT position, duration, watched FROM progress WHERE key = ?').get(progressKey(meta, row)) as
    | { position: number; duration: number; watched: number }
    | undefined
  const pref = db.prepare('SELECT track, delay FROM sub_prefs WHERE path = ?').get(f.path) as { track: string | null; delay: number } | undefined
  const subs = subTracks(fileId, f.path, f.probe)
  server.prepareSubs(
    fileId,
    f,
    subs.filter((s) => s.id.startsWith('emb:') && s.format !== 'image').map((s) => Number(s.id.slice(4))),
  )
  const duration = Number(f.probe.format.duration ?? 0)
  return {
    fileId,
    mode: plan.mode,
    duration,
    directUrl: server.url(`/file/${fileId}`),
    streamBase: server.url(`/stream/${fileId}`),
    audio: audioTracks(f.probe),
    audioNeedsConvert: plan.audioNeedsConvert,
    mimes: (f.probe.streams.some((s) => s.codec_type === 'audio') ? audioTracks(f.probe) : [{ index: 0 }]).map((a) => streamMime(f.probe, a.index)),
    subs,
    details: details(f.probe),
    position: prog && !prog.watched && prog.position > 10 ? Math.max(0, prog.position - 3) : 0,
    subPrefs: { track: pref ? pref.track ?? undefined : defaultSub(subs), delay: pref?.delay ?? 0 },
  }
}

function saveProgress(fileId: number, position: number, duration: number, forceWatched?: boolean) {
  const row = fileRow(db, fileId)
  if (!row) return
  const meta = readMeta(row.folder)
  const watched = forceWatched ?? (duration > 0 && position / duration >= settings().watchedAt)
  db.prepare(
    'INSERT INTO progress (key, position, duration, watched, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET position = excluded.position, duration = excluded.duration, watched = excluded.watched, updated = excluded.updated',
  ).run(progressKey(meta, row), watched ? 0 : position, duration, watched ? 1 : 0, Date.now())
}

function subQuery(fileId: number, query?: string): SubQuery & { path: string } {
  const row = fileRow(db, fileId)!
  const meta = readMeta(row.folder)
  return {
    path: row.path,
    kind: row.season !== null ? 'episode' : 'movie',
    tmdbId: meta?.tmdbId,
    title: meta?.title ?? path.basename(row.folder),
    year: meta?.year,
    season: row.season ?? undefined,
    episode: row.episode ?? undefined,
    hash: openSubtitlesHash(row.path),
    fileName: path.basename(row.path),
    query,
  }
}

function registerIpc() {
  const h = (ch: string, fn: (...a: never[]) => unknown) => ipcMain.handle(ch, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args))

  h('app:init', () => {
    const s = settings()
    return { settings: s, firstRun: !s.setupDone, version: app.getVersion() }
  })
  h('library:get', () => buildLibrary(db, server.artUrl))
  h('library:rescan', () => {
    fullScan()
    return buildLibrary(db, server.artUrl)
  })
  h('settings:set', (patch: Partial<FullSettings>) => {
    const before = settings()
    saveSettings(patch)
    const after = settings()
    if (before.tmdbKey !== after.tmdbKey || before.osKey !== after.osKey || before.subdlKey !== after.subdlKey || before.osUser !== after.osUser) {
      osClient = null
      queue.retryWaiting()
    }
    if (before.mediaRoot !== after.mediaRoot) fullScan()
    return after
  })
  h('tmdb:test', async (key: string) => {
    try {
      await new Tmdb(key).search('movie', 'Dune', 2021)
      return true
    } catch {
      return false
    }
  })
  h('tmdb:search', async (kind: 'movie' | 'show', q: string) => (tmdb() ? tmdb()!.search(kind, q) : []))
  h('play:info', (fileId: number) => playInfo(fileId))
  h('play:keyframe', async (fileId: number, t: number) => {
    const f = await fileProbe(fileId)
    return f ? keyframeBefore(bin('ffprobe'), f.path, t) : 0
  })
  h('play:markers', async (fileId: number) => {
    const row = fileRow(db, fileId)
    if (!row || row.kind !== 'show' || !row.season) return {}
    const ids = (db.prepare('SELECT id FROM files WHERE title_id = ? AND present = 1 AND season > 0 ORDER BY season, episode').all(row.title_id) as { id: number }[]).map((r) => r.id)
    const i = ids.indexOf(fileId)
    const ep = async (id: number) => {
      const f = await fileProbe(id)
      return f ? { path: f.path, duration: Number(f.probe.format.duration ?? 0) } : null
    }
    const me = await ep(fileId)
    if (!me || i < 0) return {}
    const near = (await Promise.all([ids[i - 1], ids[i + 1]].filter((x) => x !== undefined).map(ep))).filter((x) => !!x)
    return markers.find(me, near)
  })
  h('play:sprites', async (fileId: number) => {
    const f = await fileProbe(fileId)
    if (!f) return null
    const info = server.ensureSprites(fileId, f)
    return { ...info, base: server.url(`/sprite/${fileId}/0`).replace('/0?', '/{n}?') }
  })
  h('play:crop', async (fileId: number) => {
    const file = path.join(dataDir, 'cache', 'crop', `${fileId}.json`)
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as Crop | null
    } catch {}
    const f = await fileProbe(fileId)
    if (!f) return null
    const crop = await detectCrop(bin('ffmpeg'), f.path, f.probe).catch(() => null)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(crop))
    return crop
  })
  h('progress:save', (fileId: number, position: number, duration: number) => saveProgress(fileId, position, duration))
  h('progress:mark', (fileIds: number[], watched: boolean) => {
    for (const id of fileIds) {
      const f = fileRow(db, id)
      if (!f) continue
      const d = f.probe ? Number((JSON.parse(f.probe) as Probe).format.duration ?? 0) : 0
      saveProgress(id, 0, d, watched)
    }
    win?.webContents.send('library:changed')
  })
  h('subs:prefs', (fileId: number, prefs: { track?: string | null; delay?: number }) => {
    const row = fileRow(db, fileId)
    if (!row) return
    const cur = db.prepare('SELECT track, delay FROM sub_prefs WHERE path = ?').get(row.path) as { track: string | null; delay: number } | undefined
    db.prepare('INSERT INTO sub_prefs (path, track, delay) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET track = excluded.track, delay = excluded.delay').run(
      row.path,
      prefs.track !== undefined ? prefs.track : cur?.track ?? null,
      prefs.delay ?? cur?.delay ?? 0,
    )
  })
  h('subs:search', async (fileId: number, query?: string) => {
    const providers = subProviders()
    if (!providers.length) return { results: [], error: 'Add an OpenSubtitles or SubDL key in Settings to search for subtitles.' }
    const q = subQuery(fileId, query)
    const results: (SubCandidate & { key: string })[] = []
    let error: string | undefined
    for (const p of providers) {
      try {
        for (const c of await p.search(q)) results.push({ ...c, key: `${c.provider}|${c.id}` })
      } catch (e) {
        error = (e as Error).message
      }
    }
    const have = new Set(sidecars(q.path).map((t) => subRelease(db, t.id.slice(5))).filter(Boolean))
    const ranked = rank(results, q.fileName).slice(0, 30).map((c) => ({ ...c, have: have.has(c.release) }))
    return { results: ranked, error: results.length ? undefined : error, quota: osClient?.quota }
  })
  h('subs:download', async (fileId: number, cand: SubCandidate) => {
    const q = subQuery(fileId)
    const p = subProviders().find((x) => (cand.provider === 'subdl' ? x instanceof SubDL : x instanceof OpenSubtitles))
    if (!p) throw new Error('That subtitle source is no longer set up')
    try {
      const text = decodeSub(await p.download(cand))
      const saved = saveSub(q.path, text, guessExt(text), cand.hearingImpaired)
      noteSub(db, saved, cand.release)
      const id = `file:${saved}`
      return { track: subTracks(fileId, q.path, (await fileProbe(fileId))!.probe).find((t) => t.id === id), quota: osClient?.quota }
    } catch (e) {
      if (e instanceof QuotaError) throw new Error('Daily subtitle limit reached')
      throw e
    }
  })
  h('subs:auto', async (fileId: number) => {
    const q = subQuery(fileId)
    const got = await downloadBestSub(subProviders(), q, q.path).catch(() => null)
    if (got) noteSub(db, got.path, got.release)
    return got ? playInfo(fileId).then((i) => i.subs) : null
  })
  h('queue:get', () => queue.state())
  h('queue:pause', (p: boolean) => queue.setPaused(p))
  h('queue:fix', (id: number, pick: { tmdbId: number; kind: 'movie' | 'show'; title: string; year?: number }) => queue.fix(id, pick))
  h('queue:retry', (id: number) => queue.retry(id))
  h('title:fix', (titleId: number, pick: { tmdbId: number; kind: 'movie' | 'show'; title: string; year?: number }) => {
    const t = db.prepare('SELECT folder FROM titles WHERE id = ?').get(titleId) as { folder: string } | undefined
    if (t) queue.refix(t.folder, pick)
  })
  h('window:fullscreen', (on: boolean) => {
    if (E2E || !win || win.isFullScreen() === on) return false
    win.setFullScreen(on)
    return true
  })
  h('window:minimize', () => win?.minimize())
  h('window:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()))
  h('window:close', () => win?.close())
  h('window:state', () => ({ maximized: !!win?.isMaximized(), fullscreen: !!win?.isFullScreen() }))
  h('shell:log', () => shell.openPath(logFile))
  h('shell:folder', (p: string) => shell.showItemInFolder(p))
}

function detectEncoder() {
  execFile(bin('ffmpeg'), ['-hide_banner', '-encoders'], { windowsHide: true }, (err, out) => {
    if (!err && /h264_nvenc/.test(out)) encoder = 'h264_nvenc'
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    show: false,
    title: 'Flick',
    backgroundColor: '#0C0C0D',
    // no system title bar; the page draws its own window buttons
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: !E2E },
  })
  win.setMenu(null)
  // ctrl + scroll zooms the video, not the page
  win.webContents.setVisualZoomLevelLimits(1, 1)
  win.webContents.on('zoom-changed', () => win?.webContents.setZoomFactor(1))
  win.once('ready-to-show', () => {
    if (E2E) {
      // test runs: muted, off screen, never takes focus
      win!.setBounds({ x: -8000, y: 0, width: 3440, height: 1392 })
      win!.webContents.setAudioMuted(true)
      win!.showInactive()
      return
    }
    win!.maximize()
    win!.show()
  })
  win.on('maximize', () => win?.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win?.webContents.send('window:maximized', false))
  win.on('enter-full-screen', () => win?.webContents.send('window:fullscreen', true))
  win.on('leave-full-screen', () => win?.webContents.send('window:fullscreen', false))
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win!.setFullScreen(!win!.isFullScreen())
    if (input.type === 'keyDown' && input.key === 'F12' && process.env.FLICK_DEV) win!.webContents.toggleDevTools()
  })
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  win.on('closed', () => (win = null))
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(async () => {
  db = openDb(path.join(dataDir, 'flick.db'))
  server = new MediaServer({
    allowedRoots: () => [settings().mediaRoot],
    cacheDir: path.join(dataDir, 'cache'),
    ffmpeg: () => bin('ffmpeg'),
    encoder: () => encoder,
    file: fileProbe,
    log,
  })
  await server.start()
  queue = new Queue({
    db,
    roots,
    ffprobe: () => bin('ffprobe'),
    tmdb,
    subProviders,
    autoSubs: () => settings().autoSubs,
    trash: (p) => shell.trashItem(p),
    onChange: () => win?.webContents.send('queue:changed'),
    onLibrary: libraryChanged,
  })
  markers = new MarkerFinder(db, () => bin('ffmpeg'), log)
  registerIpc()
  detectEncoder()
  createWindow()
  fullScan()
  queue.start()
  setInterval(() => {
    if (settings().sortAuto) fullScan()
  }, 5 * 60000)
  log('started')
})

app.on('window-all-closed', () => {
  queue?.stop()
  server?.stop()
  app.quit()
})
