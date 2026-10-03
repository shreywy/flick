import { useState } from 'react'
import { api } from '../api'
import { useApp } from '../App'
import { Spinner } from '../icons'

export default function FirstRun({ onDone }: { onDone: () => void }) {
  const { settings, saveSettings, refresh } = useApp()
  const [root, setRoot] = useState(settings.mediaRoot)
  const [tmdb, setTmdb] = useState(settings.tmdbKey)
  const [os, setOs] = useState(settings.osKey)
  const [subdl, setSubdl] = useState(settings.subdlKey)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const finish = async () => {
    setError('')
    if (tmdb.trim()) {
      setBusy(true)
      const ok = await api.testTmdb(tmdb.trim())
      setBusy(false)
      if (!ok) return setError("TMDB didn't accept that key. Check it, or leave it empty for now.")
    }
    await saveSettings({ mediaRoot: root.trim(), tmdbKey: tmdb.trim(), osKey: os.trim(), subdlKey: subdl.trim(), setupDone: true })
    await api.rescan()
    await refresh()
    onDone()
  }

  return (
    <main className="setup">
      <div className="setup-card">
        <h1>Flick</h1>
        <p className="lead" style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.55 }}>
          Flick plays what's in your media folder and fills in posters, info and English subtitles. It needs a TMDB key for the info, and an OpenSubtitles or SubDL key for subtitles. You can add or change these later in Settings.
        </p>
        <div className="field">
          <span>Media folder</span>
          <input className="input" value={root} onChange={(e) => setRoot(e.target.value)} aria-label="Media folder" spellCheck={false} />
          <div className="hint">Holds Movies, TV Shows, and Shows and Movies for new downloads.</div>
        </div>
        <div className="field">
          <span>TMDB key</span>
          <input className="input" value={tmdb} onChange={(e) => setTmdb(e.target.value)} aria-label="TMDB key" spellCheck={false} type="password" />
          <div className="hint">
            Free from{' '}
            <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
              themoviedb.org/settings/api
            </a>
            . The API key or the read access token both work.
          </div>
        </div>
        <div className="field">
          <span>OpenSubtitles key</span>
          <input className="input" value={os} onChange={(e) => setOs(e.target.value)} aria-label="OpenSubtitles key" spellCheck={false} type="password" />
          <div className="hint">
            Optional. From{' '}
            <a href="https://www.opensubtitles.com/en/consumers" target="_blank" rel="noreferrer">
              opensubtitles.com/consumers
            </a>
            .
          </div>
        </div>
        <div className="field">
          <span>SubDL key</span>
          <input className="input" value={subdl} onChange={(e) => setSubdl(e.target.value)} aria-label="SubDL key" spellCheck={false} type="password" />
          <div className="hint">
            Optional. From{' '}
            <a href="https://subdl.com/panel/api" target="_blank" rel="noreferrer">
              subdl.com/panel/api
            </a>
            .
          </div>
        </div>
        {error && <div className="warn">{error}</div>}
        <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
          <button className="btn primary" onClick={finish} disabled={busy || !root.trim()}>
            {busy && <Spinner />}
            Start
          </button>
        </div>
      </div>
    </main>
  )
}
