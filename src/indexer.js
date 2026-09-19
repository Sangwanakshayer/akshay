import dotenv from "dotenv";
import db from "./db.js";
import { iterateMessages } from "./telegram.js";
import { parseMedia } from "./parser.js";

dotenv.config();

const insert = db.prepare(`
INSERT INTO media
(id,message_id,title,year,type,filename,mime,size,width,height,caption,created_at,indexed_at)
VALUES (@id,@messageId,@title,@year,@type,@filename,@mime,@size,@width,@height,@caption,@date,@indexedAt)
ON CONFLICT(message_id) DO UPDATE SET
title=excluded.title, year=excluded.year, type=excluded.type,
filename=excluded.filename, mime=excluded.mime, size=excluded.size,
width=excluded.width, height=excluded.height, caption=excluded.caption,
created_at=excluded.created_at, indexed_at=excluded.indexed_at
`);

const messages = await iterateMessages(Number(process.env.INDEX_LIMIT || 1000));
for (const m of messages) {
  const p = parseMedia(m);
  insert.run({
    id: `tg:${m.messageId}`,
    messageId: m.messageId,
    title: p.title,
    year: p.year,
    type: p.type,
    filename: m.filename,
    mime: m.mime,
    size: m.size,
    width: m.width,
    height: m.height,
    caption: m.caption,
    date: m.date,
    indexedAt: new Date().toISOString()
  });
}
console.log(`Indexed ${messages.length} Telegram media messages.`);
