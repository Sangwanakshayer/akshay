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


// ======================================================
// MAIN TABLE
// ======================================================

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

    indexed_at TEXT,

    tpdb_id TEXT,

    tpdb_title TEXT,

    tpdb_description TEXT,

    tpdb_poster TEXT,

    tpdb_background TEXT,

    tpdb_year INTEGER,

    tpdb_studio TEXT,

    tpdb_performers TEXT,

    tpdb_tags TEXT,

    tpdb_type TEXT,

    tpdb_checked INTEGER DEFAULT 0
  )
`);


// ======================================================
// MIGRATIONS
// ======================================================

const migrations = [
  [
    "tpdb_id",
    "ALTER TABLE media ADD COLUMN tpdb_id TEXT"
  ],
  [
    "tpdb_title",
    "ALTER TABLE media ADD COLUMN tpdb_title TEXT"
  ],
  [
    "tpdb_description",
    "ALTER TABLE media ADD COLUMN tpdb_description TEXT"
  ],
  [
    "tpdb_poster",
    "ALTER TABLE media ADD COLUMN tpdb_poster TEXT"
  ],
  [
    "tpdb_background",
    "ALTER TABLE media ADD COLUMN tpdb_background TEXT"
  ],
  [
    "tpdb_year",
    "ALTER TABLE media ADD COLUMN tpdb_year INTEGER"
  ],
  [
    "tpdb_studio",
    "ALTER TABLE media ADD COLUMN tpdb_studio TEXT"
  ],
  [
    "tpdb_performers",
    "ALTER TABLE media ADD COLUMN tpdb_performers TEXT"
  ],
  [
    "tpdb_tags",
    "ALTER TABLE media ADD COLUMN tpdb_tags TEXT"
  ],
  [
    "tpdb_type",
    "ALTER TABLE media ADD COLUMN tpdb_type TEXT"
  ],
  [
    "tpdb_checked",
    "ALTER TABLE media ADD COLUMN tpdb_checked INTEGER DEFAULT 0"
  ]
];

for (
  const [name, sql]
  of migrations
) {
  try {
    db.exec(sql);
  } catch (error) {
    if (
      !String(error.message)
        .toLowerCase()
        .includes(
          "duplicate column"
        )
    ) {
      console.error(
        `Database migration failed for ${name}:`,
        error.message
      );
    }
  }
}


// ======================================================
// INDEXES
// ======================================================

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

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_media_tpdb_id
  ON media(tpdb_id)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_media_tpdb_checked
  ON media(tpdb_checked)
`);


// ======================================================
// INDEX STATE
// ======================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS index_state (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);


// ======================================================
// HELPERS
// ======================================================

export function getDb() {
  return db;
}


export function getState(key) {
  const row =
    db.prepare(`
      SELECT value
      FROM index_state
      WHERE key = ?
    `).get(key);

  return row?.value ?? null;
}


export function setState(
  key,
  value
) {
  db.prepare(`
    INSERT INTO index_state (
      key,
      value
    )
    VALUES (?, ?)

    ON CONFLICT(key)
    DO UPDATE SET
      value = excluded.value
  `).run(
    key,
    String(value)
  );
}


export default db;
