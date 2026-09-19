import dotenv from "dotenv";
import { TelegramClient, Api } from "telegram";
import {
  StringSession
} from "telegram/sessions/index.js";

import {
  NewMessage
} from "telegram/events/index.js";

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
let updateHandlerStarted = false;

/* -------------------------------------------------
   GET TELEGRAM CLIENT
------------------------------------------------- */

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

  await startRealtimeListener();

  return client;
}

/* -------------------------------------------------
   GET CHANNEL
------------------------------------------------- */

export async function getChannel() {
  const c =
    await getClient();

  return await c.getEntity(
    process.env.TELEGRAM_CHANNEL
  );
}

/* -------------------------------------------------
   GET MESSAGE
------------------------------------------------- */

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

/* -------------------------------------------------
   READ TELEGRAM MESSAGES
------------------------------------------------- */

export async function iterateMessages(
  limit = 10000,
  minId = 0
) {
  const c =
    await getClient();

  const channel =
    await getChannel();

  const result = [];

  console.log(
    `Reading Telegram messages, limit=${limit}, minId=${minId}`
  );

  const options = {
    limit
  };

  if (
    Number(minId) > 0
  ) {
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

/* -------------------------------------------------
   DOCUMENT FROM MESSAGE
------------------------------------------------- */

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

/* -------------------------------------------------
   STREAM TELEGRAM FILE
------------------------------------------------- */

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

  console.log(
    `Telegram stream: ${start}-${
      end ??
      fileSize - 1
    } / ${fileSize}`
  );

  console.log(
    `Aligned offset: ${alignedStart}`
  );

  console.log(
    `Chunks: ${chunks}`
  );

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

/* -------------------------------------------------
   REALTIME TELEGRAM LISTENER
------------------------------------------------- */

async function startRealtimeListener() {
  if (updateHandlerStarted) {
    return;
  }

  updateHandlerStarted = true;

  const c =
    client;

  const channel =
    await c.getEntity(
      process.env.TELEGRAM_CHANNEL
    );

  console.log(
    "Starting Telegram realtime listener..."
  );

  c.addEventHandler(
    async (event) => {
      try {
        const message =
          event?.message;

        if (!message) {
          return;
        }

        const messageId =
          Number(message.id);

        if (!messageId) {
          return;
        }

        /*
          Make sure the update belongs
          to our configured Telegram channel.
        */

        const peerId =
          message?.peerId;

        let sameChannel =
          false;

        if (
          peerId?.channelId
        ) {
          sameChannel =
            String(
              peerId.channelId
            ) ===
            String(
              channel.id
            );
        }

        if (!sameChannel) {
          return;
        }

        /*
          Ignore messages without media.
        */

        if (!message.media) {
          return;
        }

        console.log(
          `Realtime media received: ${messageId}`
        );

        /*
          Import here to avoid circular
          module initialization problems.
        */

        const {
          indexSingleMessage
        } = await import(
          "./indexer.js"
        );

        await indexSingleMessage(
          message
        );

        console.log(
          `Realtime indexing completed: ${messageId}`
        );
      } catch (error) {
        console.error(
          "Realtime Telegram update error:",
          error
        );
      }
    },

    new NewMessage({
      chats: [
        channel
      ]
    })
  );

  console.log(
    "Telegram realtime listener started."
  );
}
