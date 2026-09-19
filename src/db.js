import Database from "better-sqlite3";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const dbPath =
  process.env.DB_PATH || "./data/happy.db";

const absoluteDbPath =
  path.resolve(dbPath);

const dbDir =
  path.dirname(absoluteDbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, {
    recursive: true
  });
}

const db =
  new Database(absoluteDbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER UNIQUE NOT NULL,
    title TEXT,
    year INTEGER,
    type TEXT DEFAULT 'movie',
    filename TEXT,
    mime TEXT,
    size INTEGER DEFAULT 0,
    width INTEGER,
    height INTEGER,
    caption TEXT,
    thumb TEXT,
    created_at TEXT,
    indexed_at TEXT
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_media_message_id
  ON media(message_id)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_media_title
  ON media(title)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_media_type
  ON media(type)
`);

/*
  Stores indexing state.
*/

db.exec(`
  CREATE TABLE IF NOT EXISTS index_state (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

export function getDb() {
  return db;
}

export function getState(key) {
  const row = db
    .prepare(
      "SELECT value FROM index_state WHERE key = ?"
    )
    .get(key);

  return row?.value ?? null;
}

export function setState(key, value) {
  db.prepare(`
    INSERT INTO index_state (key, value)
    VALUES (?, ?)
    ON CONFLICT(key)
    DO UPDATE SET value = excluded.value
  `).run(
    key,
    String(value)
  );
}

export default db;
