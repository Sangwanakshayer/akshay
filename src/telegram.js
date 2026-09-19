import dotenv from "dotenv";
import { TelegramClient, Api } from "telegram";
import {
  StringSession
} from "telegram/sessions/index.js";
import bigInt from "big-integer";

dotenv.config();

const apiId =
  Number(
    process.env.TELEGRAM_API_ID
  );

const apiHash =
  process.env.TELEGRAM_API_HASH;

const session =
  new StringSession(
    process.env.TELEGRAM_SESSION || ""
  );

let client = null;

export async function getClient() {
  if (client) {
    return client;
  }

  client =
    new TelegramClient(
      session,
      apiId,
      apiHash,
      {
        connectionRetries: 3
      }
    );

  await client.connect();

  console.log(
    "Telegram connected"
  );

  return client;
}

export async function getChannel() {
  const c =
    await getClient();

  return await c.getEntity(
    process.env.TELEGRAM_CHANNEL
  );
}

export async function getMessage(
  messageId
) {
  const c =
    await getClient();

  const channel =
    await getChannel();

  const messages =
    await c.getMessages(
      channel,
      {
        ids: [
          Number(messageId)
        ]
      }
    );

  return (
    messages?.[0] || null
  );
}

/*
  If minId is supplied:
  only messages newer than minId
  are collected.
*/

export async function iterateMessages(
  limit = 1000,
  minId = 0
) {
  const c =
    await getClient();

  const channel =
    await getChannel();

  const result = [];

  console.log(
    `Reading Telegram messages. limit=${limit}, minId=${minId}`
  );

  const options = {
    limit
  };

  if (Number(minId) > 0) {
    options.minId =
      Number(minId);
  }

  for await (
    const msg of c.iterMessages(
      channel,
      options
    )
  ) {
    try {
      if (!msg) {
        continue;
      }

      const messageId =
        Number(msg.id);

      if (!messageId) {
        continue;
      }

      if (!msg.media) {
        continue;
      }

      console.log(
        `Found media message: ${messageId} | ${
          msg.media.className ||
          "unknown"
        }`
      );

      result.push(msg);

    } catch (error) {
      console.error(
        "Error reading Telegram message:",
        error.message
      );
    }
  }

  console.log(
    `Collected ${result.length} Telegram media messages`
  );

  return result;
}

function getDocumentFromMessage(
  message
) {
  const media =
    message?.media;

  if (!media) {
    throw new Error(
      "Telegram message has no media"
    );
  }

  if (
    media instanceof
    Api.MessageMediaDocument
  ) {
    const document =
      media.document;

    if (
      document instanceof
      Api.Document
    ) {
      return document;
    }
  }

  if (
    media.document &&
    media.document instanceof
      Api.Document
  ) {
    return media.document;
  }

  if (
    media.document &&
    typeof media.document ===
      "object"
  ) {
    return media.document;
  }

  throw new Error(
    `Unsupported Telegram media type: ${
      media.className ||
      "unknown"
    }`
  );
}

export async function streamMessage(
  message,
  start = 0,
  end = null
) {
  const c =
    await getClient();

  const document =
    getDocumentFromMessage(
      message
    );

  const fileSize =
    Number(
      document.size || 0
    );

  if (!fileSize) {
    throw new Error(
      "Telegram document size unavailable"
    );
  }

  const requestSize =
    512 * 1024;

  const alignedStart =
    Math.floor(
      start / 4096
    ) * 4096;

  const skip =
    start - alignedStart;

  const bytesNeeded =
    end === null
      ? fileSize - start
      : end - start + 1;

  const totalBytes =
    skip + bytesNeeded;

  const chunks =
    Math.ceil(
      totalBytes /
        requestSize
    );

  const location =
    new Api.InputDocumentFileLocation({
      id:
        document.id,

      accessHash:
        document.accessHash,

      fileReference:
        document.fileReference,

      thumbSize: ""
    });

  const iterator =
    c.iterDownload({
      file: location,

      offset:
        bigInt(
          alignedStart
        ),

      limit: chunks,

      requestSize,

      chunkSize:
        requestSize
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

      if (
        skipped < skip
      ) {
        const remove =
          Math.min(
            skip - skipped,
            data.length
          );

        data =
          data.subarray(
            remove
          );

        skipped +=
          remove;
      }

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

      if (
        data.length > 0
      ) {
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
