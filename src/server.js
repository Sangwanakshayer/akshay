import express from "express";
import dotenv from "dotenv";
import db from "./db.js";
import { downloadMessageToTemp } from "./telegram.js";
import fs from "fs";
import path from "path";

dotenv.config();
const app = express();
const port = Number(process.env.PORT || 7000);

const base = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;

app.get("/manifest.json", (_, res) => res.json({
  id: "com.sangwanakshayer.tgaddon",
  version: "1.0.0",
  name: "Happy Telegram Library",
  description: "Private Telegram channel library",
  resources: ["catalog","meta","stream"],
  types: ["movie","series"],
  idPrefixes: ["tg:"],
  catalogs: [
    { type:"movie", id:"happy-movies", name:"Happy Movies", extra:[{name:"search",isRequired:false},{name:"skip",isRequired:false}] },
    { type:"series", id:"happy-series", name:"Happy Series", extra:[{name:"search",isRequired:false},{name:"skip",isRequired:false}] }
  ]
}));

function listItems(type, search, skip=0) {
  let sql = "SELECT * FROM media WHERE type = ?";
  const params = [type];
  if (search) {
    sql += " AND (title LIKE ? OR filename LIKE ? OR caption LIKE ?)";
    const q = `%${search}%`;
    params.push(q,q,q);
  }
  sql += " ORDER BY COALESCE(year,0) DESC, id DESC LIMIT 100 OFFSET ?";
  params.push(Number(skip)||0);
  return db.prepare(sql).all(...params);
}

app.get("/catalog/:type/:id.json", (req,res) => {
  const type = req.params.type;
  const search = req.query.search || "";
  const skip = req.query.skip || 0;
  const rows = listItems(type, search, skip);
  res.json({
    metas: rows.map(r => ({
      id: r.id,
      type: r.type,
      name: r.title,
      year: r.year || undefined,
      poster: r.thumb || undefined,
      description: r.caption || `${r.filename || ""}${r.width ? ` • ${r.width}x${r.height}` : ""}`
    }))
  });
});

app.get("/meta/:type/:id.json", (req,res) => {
  const r = db.prepare("SELECT * FROM media WHERE id=?").get(req.params.id);
  if (!r) return res.status(404).json({error:"not found"});
  res.json({
    meta: {
      id:r.id, type:r.type, name:r.title, year:r.year || undefined,
      poster:r.thumb || undefined,
      description:r.caption || r.filename || "",
      videos:[{
        id:r.id,
        title:r.title,
        season_number:1,
        episode_number:1
      }]
    }
  });
});

app.get("/stream/:type/:id.json", async (req,res) => {
  const r = db.prepare("SELECT * FROM media WHERE id=?").get(req.params.id);
  if (!r) return res.status(404).json({streams:[]});

  // Download-to-local is intentionally used here because Telegram CDN
  // file URLs can be temporary. A production deployment should add a
  // short-lived cache/stream proxy instead of permanently storing URLs.
  try {
    const filePath = await downloadMessageToTemp(r.message_id);
    const streamUrl = `${base}/file/${r.message_id}`;
    res.json({
      streams:[{
        name:"Happy Telegram",
        title:`${r.title}${r.year ? ` (${r.year})` : ""}`,
        url:streamUrl,
        behaviorHints:{ notWebReady:true }
      }]
    });
  } catch (e) {
    res.status(502).json({streams:[], error:e.message});
  }
});

app.get("/file/:messageId", (req,res) => {
  const file = path.join(process.cwd(),"data","tmp",`${req.params.messageId}.bin`);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(path.resolve(file));
});

app.get("/", (_,res) => res.type("text").send("tg_addon is running"));

app.listen(port, () => console.log(`tg_addon listening on ${port}`));
