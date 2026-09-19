import dotenv from "dotenv";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import bigInt from "big-integer";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

const session = new StringSession(
  process.env.TELEGRAM_SESSION || ""
);

let client = null;


/* =========================================================
   TELEGRAM CLIENT
========================================================= */

export async function getClient() {
  if (client) {
    return client;
  }

  if (!apiId || !apiHash) {
    throw new Error(
      "TELEGRAM_API_ID and TELEGRAM_API_HASH are required"
    );
  }

  client = new TelegramClient(
    session,
    apiId,
    apiHash,
    {
      connectionRetries: 5
    }
  );

  await client.connect();

  console.log("Telegram connected");

  return client;
}


/* =========================================================
   GET CHANNEL
========================================================= */

export async function getChannel() {
  const c = await getClient();

  const channel =
    process.env.TELEGRAM_CHANNEL || "Happy";

  return await c.getEntity(channel);
}


/* =========================================================
   GET MESSAGE
========================================================= */

export async function getMessage(messageId) {
  const c = await getClient();
  const channel = await getChannel();

  const messages = await c.getMessages(
    channel,
    {
      ids: [Number(messageId)]
    }
  );

  const message = messages?.[0];

  if (!message) {
    throw new Error(
      `Telegram message ${messageId} not found`
    );
  }

  return message;
}


/* =========================================================
   INDEX TELEGRAM MEDIA
========================================================= */

export async function iterateMessages(limit = 1000) {
  const c = await getClient();
  const channel = await getChannel();

  const rows = [];

  for await (
    const msg of c.iterMessages(
      channel,
      { limit }
    )
  ) {
    if (!msg.media) {
      continue;
    }

    let filename = "";
    let mime = "";
    let size = 0;

    try {
      const file = msg.file;

      if (file) {
        try {
          filename = file.name || "";
        } catch {}

        try {
          mime = file.mimeType || "";
        } catch {}

        try {
          size = Number(file.size || 0);
        } catch {}
      }
    } catch {}

    rows.push({
      messageId: msg.id,
      filename,
      mime,
      size,
      width: null,
      height: null,
      caption: msg.message || "",
      date: msg.date
        ? new Date(msg.date).toISOString()
        : null
    });
  }

  return rows;
}


/* =========================================================
   GET DOCUMENT FROM TELEGRAM MESSAGE
========================================================= */

function getDocumentFromMessage(message) {
  const media = message?.media;

  if (!media) {
    throw new Error(
      "Telegram message has no media"
    );
  }

  /*
   * Normal uploaded Telegram file
   */

  if (
    media instanceof Api.MessageMediaDocument
  ) {
    const document =
      media.document;

    if (
      document instanceof Api.Document
    ) {
      return document;
    }
  }

  /*
   * Fallback
   */

  if (
    media.document &&
    media.document instanceof Api.Document
  ) {
    return media.document;
  }

  throw new Error(
    `Unsupported Telegram media type: ${
      media.className || "unknown"
    }`
  );
}


/* =========================================================
   STREAM TELEGRAM FILE
========================================================= */

export async function streamMessage(
  message,
  start = 0,
  end = null
) {
  const c = await getClient();

  const document =
    getDocumentFromMessage(message);

  const fileSize =
    Number(document.size || 0);

  if (!fileSize) {
    throw new Error(
      "Telegram document size unavailable"
    );
  }

  /*
   * Telegram requires aligned offsets.
   */

  const alignedStart =
    Math.floor(start / 4096) * 4096;

  const skip =
    start - alignedStart;

  const bytesNeeded =
    end === null
      ? fileSize - start
      : end - start + 1;

  const requestSize =
    512 * 1024;

  const totalBytes =
    skip + bytesNeeded;

  /*
   * iterDownload limit = number of chunks,
   * NOT number of bytes.
   */

  const chunks =
    Math.ceil(
      totalBytes / requestSize
    );

  /*
   * Create proper Telegram
   * InputDocumentFileLocation.
   */

  const location =
    new Api.InputDocumentFileLocation({
      id: document.id,

      accessHash:
        document.accessHash,

      fileReference:
        document.fileReference,

      thumbSize: ""
    });

  console.log(
    `Telegram stream: ${start}-${end ?? fileSize - 1} / ${fileSize}`
  );

  console.log(
    `Aligned offset: ${alignedStart}`
  );

  console.log(
    `Chunks: ${chunks}`
  );

  /*
   * IMPORTANT:
   * offset must be BigInteger.
   */

  const iterator =
    c.iterDownload({
      file: location,

      offset:
        bigInt(alignedStart),

      limit: chunks,

      requestSize,

      chunkSize: requestSize
    });

  let skipped = 0;

  let remaining =
    bytesNeeded;

  return (async function* () {

    for await (
      const chunk of iterator
    ) {
      let data =
        Buffer.from(chunk);

      /*
       * Remove bytes before
       * requested HTTP Range.
       */

      if (skipped < skip) {
        const remove =
          Math.min(
            skip - skipped,
            data.length
          );

        data =
          data.subarray(remove);

        skipped += remove;
      }

      /*
       * Don't send more than
       * requested.
       */

      if (
        data.length >
        remaining
      ) {
        data =
          data.subarray(
            0,
            remaining
          );
      }

      if (data.length > 0) {
        yield data;

        remaining -=
          data.length;
      }

      if (
        remaining <= 0
      ) {
        break;
      }
    }

  })();
}


/* =========================================================
   FULL DOWNLOAD HELPER
========================================================= */

export async function downloadMessageToTemp(
  messageId
) {
  const c = await getClient();
  const channel = await getChannel();

  const messages =
    await c.getMessages(
      channel,
      {
        ids: [
          Number(messageId)
        ]
      }
    );

  const message =
    messages?.[0];

  if (!message) {
    throw new Error(
      "Telegram message not found"
    );
  }

  const dir =
    path.join(
      process.cwd(),
      "data",
      "tmp"
    );

  await fs.mkdir(
    dir,
    {
      recursive: true
    }
  );

  const out =
    path.join(
      dir,
      `${messageId}.bin`
    );

  await c.downloadMedia(
    message,
    {
      outputFile: out
    }
  );

  return out;
}