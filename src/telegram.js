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

/* -------------------------------------------------
   TELEGRAM CONFIG
------------------------------------------------- */

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

/* -------------------------------------------------
   CLIENT
------------------------------------------------- */

let client = null;

let updateHandlerStarted =
  false;

/* -------------------------------------------------
   GET CLIENT
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

  /*
    Start realtime listener after
    successful Telegram connection.
  */

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
   GET SINGLE MESSAGE
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
   ITERATE TELEGRAM MESSAGES
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

  /*
    Incremental indexing:
    only read messages newer than
    the last indexed message ID.
  */

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
        console.log(
          "Skipping message without ID"
        );

        continue;
      }

      /*
        Only media messages are useful
        for our Nuvio library.
      */

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
   GET DOCUMENT FROM MESSAGE
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

  /*
    Normal Telegram document.
  */

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

  /*
    Fallback for GramJS object structure.
  */

  if (
    media.document &&
    media.document instanceof
      Api.Document
  ) {
    return media.document;
  }

  /*
    Generic document object fallback.
  */

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
   STREAM TELEGRAM MESSAGE
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

  /*
    Telegram file downloads need
    aligned offsets.
  */

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

  /*
    Telegram document location.
  */

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

  /*
    IMPORTANT:
    GramJS expects big-integer
    for the offset.
  */

  const iterator =
    c.iterDownload({
      file: location,

      offset:
        bigInt(
          alignedStart
        ),

      limit:
        chunks,

      requestSize,

      chunkSize:
        requestSize
    });

  let skipped = 0;

  let remaining =
    bytesNeeded;

  /*
    Return async generator so
    server.js can stream chunks
    directly to Nuvio.
  */

  return (async function* () {
    for await (
      const chunk of iterator
    ) {
      let data =
        Buffer.from(chunk);

      /*
        Remove bytes before the
        requested HTTP range.
      */

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

      /*
        Never send more bytes than
        requested by the HTTP range.
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
  /*
    Prevent duplicate listeners.
  */

  if (
    updateHandlerStarted
  ) {
    return;
  }

  updateHandlerStarted =
    true;

  const c =
    client;

  /*
    Resolve configured channel once.
  */

  const channel =
    await c.getEntity(
      process.env.TELEGRAM_CHANNEL
    );

  const channelId =
    String(
      channel.id
    );

  console.log(
    `Realtime listener target channel: ${channelId}`
  );

  console.log(
    "Starting Telegram realtime listener..."
  );

  /*
    IMPORTANT:

    Do NOT use:

      new NewMessage({
        chats: [channel]
      })

    because GramJS may try to resolve
    the channel object again and produce:

      [object Object]

    Instead we listen for NewMessage
    events globally and manually filter
    by channel ID below.
  */

  c.addEventHandler(
    async (event) => {
      try {
        const message =
          event?.message;

        if (!message) {
          return;
        }

        const messageId =
          Number(
            message.id
          );

        if (!messageId) {
          return;
        }

        /*
          Get incoming message peer.
        */

        const peerId =
          message.peerId;

        const incomingChannelId =
          peerId?.channelId
            ? String(
                peerId.channelId
              )
            : null;

        /*
          Ignore messages that aren't
          from our configured channel.
        */

        if (
          !incomingChannelId ||
          incomingChannelId !==
            channelId
        ) {
          return;
        }

        /*
          Ignore text-only messages.
        */

        if (!message.media) {
          return;
        }

        console.log(
          `Realtime media received: ${messageId}`
        );

        /*
          Dynamically import indexer.

          This avoids a circular module
          initialization problem between
          telegram.js and indexer.js.
        */

        const {
          indexSingleMessage
        } = await import(
          "./indexer.js"
        );

        /*
          Index only this new message.
        */

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

    /*
      Empty NewMessage filter.

      We manually filter the configured
      channel above.
    */

    new NewMessage({})
  );

  console.log(
    "Telegram realtime listener started."
  );
}
