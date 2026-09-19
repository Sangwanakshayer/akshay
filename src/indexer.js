import dotenv from "dotenv";

import {
  getDb,
  getState,
  setState
} from "./db.js";

import {
  iterateMessages
} from "./telegram.js";

dotenv.config();

/* -------------------------------------------------
   DOCUMENT
------------------------------------------------- */

function getDocument(message) {
  const media =
    message?.media;

  if (!media) {
    return null;
  }

  if (
    media.document &&
    typeof media.document ===
      "object"
  ) {
    return media.document;
  }

  return null;
}

/* -------------------------------------------------
   FILENAME
------------------------------------------------- */

function getFilename(
  document
) {
  const attributes =
    document?.attributes || [];

  for (
    const attr of attributes
  ) {
    if (
      attr?.className ===
      "DocumentAttributeFilename"
    ) {
      return (
        attr.fileName || ""
      );
    }
  }

  return "";
}

/* -------------------------------------------------
   VIDEO DIMENSIONS
------------------------------------------------- */

function getDimensions(
  document
) {
  const attributes =
    document?.attributes || [];

  for (
    const attr of attributes
  ) {
    if (
      attr?.className ===
      "DocumentAttributeVideo"
    ) {
      return {
        width:
          Number(
            attr.w || 0
          ) || null,

        height:
          Number(
            attr.h || 0
          ) || null
      };
    }
  }

  return {
    width: null,
    height: null
  };
}

/* -------------------------------------------------
   TITLE
------------------------------------------------- */

function getTitle(
  message,
  filename
) {
  if (filename) {
    return filename
      .replace(
        /\.[^/.]+$/,
        ""
      )
      .trim();
  }

  const caption =
    message?.message || "";

  if (caption) {
    return caption
      .split("\n")[0]
      .trim()
      .slice(0, 300);
  }

  return `Telegram ${message.id}`;
}

/* -------------------------------------------------
   TYPE
------------------------------------------------- */

function getType(title) {
  if (
    /s\d{1,2}e\d{1,2}/i.test(
      title
    ) ||
    /season|episode|series/i.test(
      title
    )
  ) {
    return "series";
  }

  return "movie";
}

/* -------------------------------------------------
   YEAR
------------------------------------------------- */

function getYear(title) {
  const match =
    title.match(
      /\b(19|20)\d{2}\b/
    );

  return match
    ? Number(match[0])
    : null;
}

/* -------------------------------------------------
   CREATED DATE
------------------------------------------------- */

function getCreatedAt(
  message
) {
  try {
    if (
      message?.date instanceof
      Date
    ) {
      return message.date
        .toISOString();
    }

    if (message?.date) {
      return new Date(
        Number(
          message.date
        ) * 1000
      ).toISOString();
    }
  } catch {
    return null;
  }

  return null;
}

/* -------------------------------------------------
   INDEX ONE MESSAGE
------------------------------------------------- */

export async function indexSingleMessage(
  message
) {
  const db =
    getDb();

  if (!message) {
    return false;
  }

  const messageId =
    Number(
      message.id
    );

  if (!messageId) {
    return false;
  }

  const document =
    getDocument(
      message
    );

  if (!document) {
    console.log(
      `Message ${messageId} has no document media. Skipping.`
    );

    return false;
  }

  const filename =
    getFilename(
      document
    );

  const dimensions =
    getDimensions(
      document
    );

  const title =
    getTitle(
      message,
      filename
    );

  const type =
    getType(title);

  const year =
    getYear(title);

  const caption =
    message.message ||
    "";

  const mime =
    document.mimeType ||
    "video/mp4";

  const size =
    Number(
      document.size || 0
    );

  const insert =
    db.prepare(`
      INSERT INTO media (
        message_id,
        title,
        year,
        type,
        filename,
        mime,
        size,
        width,
        height,
        caption,
        created_at,
        indexed_at
      )
      VALUES (
        @message_id,
        @title,
        @year,
        @type,
        @filename,
        @mime,
        @size,
        @width,
        @height,
        @caption,
        @created_at,
        @indexed_at
      )
      ON CONFLICT(message_id)
      DO UPDATE SET
        title = excluded.title,
        year = excluded.year,
        type = excluded.type,
        filename = excluded.filename,
        mime = excluded.mime,
        size = excluded.size,
        width = excluded.width,
        height = excluded.height,
        caption = excluded.caption,
        indexed_at = excluded.indexed_at
    `);

  insert.run({
    message_id:
      messageId,

    title,

    year,

    type,

    filename,

    mime,

    size,

    width:
      dimensions.width,

    height:
      dimensions.height,

    caption,

    created_at:
      getCreatedAt(
        message
      ),

    indexed_at:
      new Date()
        .toISOString()
  });

  /*
    Update the highest known message ID.
  */

  const currentLastId =
    Number(
      getState(
        "last_message_id"
      ) || 0
    );

  if (
    messageId >
    currentLastId
  ) {
    setState(
      "last_message_id",
      messageId
    );
  }

  console.log(
    `Indexed realtime message: ${messageId} | ${title}`
  );

  return true;
}

/* -------------------------------------------------
   FULL / INCREMENTAL CATCH-UP INDEX
------------------------------------------------- */

export async function indexTelegram() {
  const db =
    getDb();

  const storedLastId =
    Number(
      getState(
        "last_message_id"
      ) || 0
    );

  console.log(
    `Last indexed Telegram message ID: ${storedLastId}`
  );

  const limit =
    storedLastId > 0
      ? 1000
      : 10000;

  const messages =
    await iterateMessages(
      limit,
      storedLastId
    );

  console.log(
    `Messages returned for indexing: ${messages.length}`
  );

  if (
    messages.length === 0
  ) {
    console.log(
      "No new Telegram media found."
    );

    return;
  }

  let indexed = 0;

  let skipped = 0;

  let highestMessageId =
    storedLastId;

  /*
    Process messages one by one.
    This is safer for realtime updates.
  */

  for (
    const message of messages
  ) {
    try {
      const messageId =
        Number(
          message.id
        );

      if (
        messageId >
        highestMessageId
      ) {
        highestMessageId =
          messageId;
      }

      const success =
        await indexSingleMessage(
          message
        );

      if (success) {
        indexed++;
      } else {
        skipped++;
      }
    } catch (error) {
      skipped++;

      console.error(
        `Failed to index message ${
          message?.id
        }:`,
        error.message
      );
    }
  }

  if (
    highestMessageId >
    storedLastId
  ) {
    setState(
      "last_message_id",
      highestMessageId
    );
  }

  const result =
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM media"
      )
      .get();

  console.log(
    `Indexed this run: ${indexed}`
  );

  console.log(
    `Skipped this run: ${skipped}`
  );

  console.log(
    `Database contains ${result.count} media items`
  );

  console.log(
    `Last indexed message ID: ${highestMessageId}`
  );

  return result.count;
}

/* -------------------------------------------------
   DIRECT EXECUTION
------------------------------------------------- */

if (
  process.argv[1]?.endsWith(
    "indexer.js"
  )
) {
  indexTelegram()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(
        "Indexing failed:",
        error
      );

      process.exit(1);
    });
}
