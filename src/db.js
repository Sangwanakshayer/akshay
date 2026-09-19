import Database from "better-sqlite3";
import dotenv from "dotenv";
dotenv.config();

const db = new Database(process.env.DB_PATH || "./data/happy.db");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  message_id INTEGER UNIQUE NOT NULL,
  title TEXT NOT NULL,
  year INTEGER,
  type TEXT NOT NULL DEFAULT 'movie',
  filename TEXT,
  mime TEXT,
  size INTEGER,
  width INTEGER,
  height INTEGER,
  caption TEXT,
  thumb TEXT,
  created_at TEXT,
  indexed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_title ON media(title);
CREATE INDEX IF NOT EXISTS idx_media_type ON media(type);
`);

export default db;