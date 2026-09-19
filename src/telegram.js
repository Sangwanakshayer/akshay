import dotenv from "dotenv";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { CustomFile } from "telegram/client/uploads.js";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const session = new StringSession(process.env.TELEGRAM_SESSION || "");
let client;

export async function getClient() {
  if (client) return client;
  if (!apiId || !apiHash) throw new Error("TELEGRAM_API_ID and TELEGRAM_API_HASH are required");
  client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });
  await client.connect();
  return client;
}

export async function getChannel() {
  const c = await getClient();
  return c.getEntity(process.env.TELEGRAM_CHANNEL || "Happy");
}

export async function iterateMessages(limit=1000) {
  const c = await getClient();
  const channel = await getChannel();
  const rows = [];
  for await (const msg of c.iterMessages(channel, { limit })) {
    if (!msg.media) continue;
    const file = msg.file;
    if (!file) continue;
    rows.push({
      messageId: msg.id,
      filename: file.name || "",
      mime: file.mimeType || "",
      size: Number(file.size || 0),
      width: file.width || null,
      height: file.height || null,
      caption: msg.message || "",
      date: msg.date ? new Date(msg.date).toISOString() : null
    });
  }
  return rows;
}

// Returns a local temporary file URL only if the server downloads it.
// This avoids pretending Telegram CDN URLs are permanent.
export async function downloadMessageToTemp(messageId) {
  const c = await getClient();
  const channel = await getChannel();
  const message = await c.getMessages(channel, { ids: [messageId] });
  if (!message?.length || !message[0]) throw new Error("Telegram message not found");

  const dir = path.join(process.cwd(), "data", "tmp");
  await fs.mkdir(dir, { recursive: true });
  const out = path.join(dir, `${messageId}.bin`);
  await c.downloadMedia(message[0], { outputFile: out });
  return out;
}