import dotenv from "dotenv";
import { getDb } from "./db.js";
import { iterateMessages } from "./telegram.js";

dotenv.config();

export async function indexTelegram() {
  const db = getDb();

  console.log("Starting Telegram indexing...");

  const messages = await iterateMessages(10000);

  console.log(
    `Telegram media messages found: ${messages.length}`
  );

  const insert = db.prepare(`
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

  const run = db.transaction((rows) => {
    for (const message of rows) {
      try {
        let file = null;

        try {
          file = message.file;
        } catch {
          file = null;
        }

        if (!file) continue;

        const filename = file.name || "";
        const mime = file.mimeType || "";

        const caption =
          message.message ||
          message.text ||
          "";

        let title = filename
          ? filename.replace(/\.[^/.]+$/, "").trim()
          : "";

        if (!title && caption) {
          title = caption
            .split("\n")[0]
            .trim();
        }

        if (!title) {
          title = `Telegram ${message.id}`;
        }

        let type = "movie";

        if (
          /s\d{1,2}e\d{1,2}/i.test(title) ||
          /season|episode|series/i.test(title)
        ) {
          type = "series";
        }

        const yearMatch = title.match(
          /\b(19|20)\d{2}\b/
        );

        const year = yearMatch
          ? Number(yearMatch[0])
          : null;

        insert.run({
          message_id: Number(message.id),
          title,
          year,
          type,
          filename,
          mime,
          size: Number(file.size || 0),
          width:
            Number(file.width || 0) || null,
          height:
            Number(file.height || 0) || null,
          caption,
          created_at: message.date
            ? new Date(
                message.date * 1000
              ).toISOString()
            : null,
          indexed_at:
            new Date().toISOString()
        });

        console.log(
          `Indexed: ${message.id} - ${title}`
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

  const result = db
    .prepare(
      "SELECT COUNT(*) AS count FROM media"
    )
    .get();

  console.log(
    `Indexing complete. Database contains ${result.count} media items.`
  );

  return result.count;
}

/*
  Allows:
  npm run index
*/
if (
  process.argv[1]?.endsWith("indexer.js")
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
