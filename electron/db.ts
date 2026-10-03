import { DatabaseSync } from 'node:sqlite'

export type DB = DatabaseSync

export function openDb(file: string): DB {
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS titles (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      folder TEXT NOT NULL UNIQUE,
      added INTEGER NOT NULL,
      present INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      title_id INTEGER NOT NULL,
      path TEXT NOT NULL UNIQUE,
      season INTEGER,
      episode INTEGER,
      size INTEGER,
      mtime INTEGER,
      probe TEXT,
      present INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS progress (
      key TEXT PRIMARY KEY,
      position REAL NOT NULL,
      duration REAL NOT NULL,
      watched INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sub_prefs (
      path TEXT PRIMARY KEY,
      track TEXT,
      delay REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      source TEXT NOT NULL,
      name TEXT NOT NULL,
      target TEXT,
      step TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      action TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      retry_at INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL
    );
  `)
  return db
}

export function getSetting<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? (JSON.parse(row.value) as T) : fallback
}

export function setSetting(db: DB, key: string, value: unknown) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  )
}
