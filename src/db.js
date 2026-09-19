import Database from "better-sqlite3";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

/* =========================================================
   DATABASE PATH
========================================================= */

const dbPath =
  process.env.DB_PATH ||
  "./data/happy.db";

const absoluteDbPath =
  path.resolve(dbPath);

const dbDir =
  path.dirname(absoluteDbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(
    dbDir,
    {
      recursive: true
    }
  );
}


/* =========================================================
   DATABASE
========================================================= */

const db =
  new Database(
    absoluteDbPath
  );


/* =========================================================
   DATABASE SETTINGS
========================================================= */

db.pragma(
  "journal_mode = WAL"
);


/* =========================================================
   MEDIA TABLE
========================================================= */

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


/* =========================================================
   INDEXES
========================================================= */

db.exec(`
  CREATE INDEX IF NOT EXISTS
  idx_media_message_id
  ON media(message_id)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS
  idx_media_title
  ON media(title)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS
  idx_media_type
  ON media(type)
`);


/* =========================================================
   GET DATABASE
========================================================= */

export function getDb() {
  return db;
}


/* =========================================================
   DEFAULT EXPORT
========================================================= */

export default db;