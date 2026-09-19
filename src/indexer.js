import dotenv from "dotenv";
import { getDb } from "./db.js";
import { iterateMessages } from "./telegram.js";

dotenv.config();

function getDocument(message) {
  const media = message?.media;

  if (!media) {
    return null;
  }

  // GramJS MessageMediaDocument
  if (
    media.document &&
    media.document.className === "Document"
  ) {
    return media.document;
  }

  // Fallback: document object exists
  if (
    media.document &&
    typeof media.document === "object"
  ) {
    return media.document;
  }

  return null;
}

function getFilename(document) {
  const attributes =
    document?.attributes || [];

  for (const attr of attributes) {
    if (
      attr?.className ===
      "DocumentAttributeFilename"
    ) {
      return attr.fileName || "";
    }
  }

  return "";
}

function getVideoDimensions(document) {
  const attributes =
    document?.attributes || [];

  for (const attr of attributes) {
    if (
      attr?.className ===
      "DocumentAttributeVideo"
    ) {
      return {
        width:
          Number(attr.w || 0) || null,

        height:
          Number(attr.h || 0) || null
      };
    }
  }

  return {
    width: null,
    height: null
  };
}

function getTitle(
  message,
  filename
) {
  if (filename) {
    return filename
      .replace(/\.[^/.]+$/, "")
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

  return `Telegram ${message?.id || "Unknown"}`;
}

function getType(title) {
  if (
    /s\d{1,2}e\d{1,2}/i.test(title) ||
    /season|episode|series/i.test(title)
  ) {
    return "series";
  }

  return "movie";
}

function getYear(title) {
  const match =
    title.match(
      /\b(19|20)\d{2}\b/
    );

  return match
    ? Number(match[0])
    : null;
}

function getCreatedAt(message) {
  try {
    if (
      message?.date instanceof Date
    ) {
      return message.date.toISOString();
    }

    if (message?.date) {
      return new Date(
        Number(message.date) * 1000
      ).toISOString();
    }
  } catch {
    return null;
  }

  return null;
}

export async function indexTelegram() {
  const db = getDb();

  console.log(
    "Starting Telegram indexing..."
  );

  const messages =
    await iterateMessages(10000);

  console.log(
    `Telegram media messages found: ${messages.length}`
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
        created_at = excluded.created_at,
        indexed_at = excluded.indexed_at
    `);

  let indexed = 0;
  let skipped = 0;

  const run =
    db.transaction((rows) => {
      for (const message of rows) {
        try {
          const document =
            getDocument(message);

          if (!document) {
            skipped++;

            console.log(
              `Skipped message ${message?.id}: no document`
            );

            continue;
          }

          const filename =
            getFilename(document);

          const dimensions =
            getVideoDimensions(
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
            message?.message || "";

          const mime =
            document?.mimeType ||
            "video/mp4";

          const size =
            Number(
              document?.size || 0
            );

          insert.run({
            message_id:
              Number(message.id),

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
              getCreatedAt(message),

            indexed_at:
              new Date().toISOString()
          });

          indexed++;

          console.log(
            `Indexed ${indexed}: ${title}`
          );
        } catch (error) {
          console.error(
            `Failed to index message ${message?.id}:`,
            error.message
          );
        }
      }
    });

  run(messages);

  const result =
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM media"
      )
      .get();

  console.log(
    `Indexing complete. Database contains ${result.count} media items.`
  );

  console.log(
    `Indexed this run: ${indexed}`
  );

  console.log(
    `Skipped this run: ${skipped}`
  );

  return result.count;
}

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
