import express from "express";
import dotenv from "dotenv";

import { getDb } from "./db.js";

import {
  getMessage,
  streamMessage
} from "./telegram.js";

import {
  indexTelegram
} from "./indexer.js";

dotenv.config();

const app = express();

const PORT =
  Number(process.env.PORT) || 7000;

/* -------------------------------------------------
   CORS
------------------------------------------------- */

app.use((req, res, next) => {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "*"
  );

  next();
});

/* -------------------------------------------------
   BASE URL
------------------------------------------------- */

function getBaseUrl(req) {
  return (
    process.env.PUBLIC_BASE_URL ||
    `${req.protocol}://${req.get("host")}`
  );
}

/* -------------------------------------------------
   DATABASE
------------------------------------------------- */

function getMediaById(id) {
  const db = getDb();

  return db
    .prepare(
      "SELECT * FROM media WHERE id = ?"
    )
    .get(Number(id));
}

/* -------------------------------------------------
   META
------------------------------------------------- */

function makeMeta(row, req) {
  const baseUrl =
    getBaseUrl(req);

  return {
    id: `tg:${row.id}`,

    type:
      row.type === "series"
        ? "series"
        : "movie",

    name:
      row.title ||
      row.filename ||
      `Telegram ${row.message_id}`,

    description:
      row.caption || "",

    year:
      row.year || undefined,

    streams: [
      {
        title: "Play",

        url:
          `${baseUrl}/stream/${row.type}/tg:${row.id}.json`
      }
    ]
  };
}

/* -------------------------------------------------
   EXTRA PARSER
------------------------------------------------- */

function parseExtra(value) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/* -------------------------------------------------
   CATALOG
------------------------------------------------- */

function getCatalogRows(
  type,
  search = "",
  skip = 0
) {
  const db = getDb();

  const safeType =
    type === "series"
      ? "series"
      : "movie";

  const offset =
    Math.max(
      0,
      Number(skip) || 0
    );

  if (search) {
    const q =
      `%${search}%`;

    return db
      .prepare(`
        SELECT *
        FROM media
        WHERE type = ?
        AND (
          title LIKE ?
          OR filename LIKE ?
          OR caption LIKE ?
        )
        ORDER BY id DESC
        LIMIT 100
        OFFSET ?
      `)
      .all(
        safeType,
        q,
        q,
        q,
        offset
      );
  }

  return db
    .prepare(`
      SELECT *
      FROM media
      WHERE type = ?
      ORDER BY id DESC
      LIMIT 100
      OFFSET ?
    `)
    .all(
      safeType,
      offset
    );
}

/* -------------------------------------------------
   HEALTH
------------------------------------------------- */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name:
      "Happy Telegram Media Addon",
    status: "running",
    version: "1.0.0"
  });
});

/* -------------------------------------------------
   MANIFEST
------------------------------------------------- */

app.get(
  "/manifest.json",
  (req, res) => {
    res.sendFile(
      "manifest.json",
      {
        root: process.cwd()
      }
    );
  }
);

/* -------------------------------------------------
   CATALOG WITH EXTRA
------------------------------------------------- */

app.get(
  "/catalog/:type/:id/:extra.json",
  (req, res) => {
    try {
      const extra =
        parseExtra(
          req.params.extra
        );

      const rows =
        getCatalogRows(
          req.params.type,
          extra.search || "",
          extra.skip || 0
        );

      const metas =
        rows.map(
          (row) =>
            makeMeta(
              row,
              req
            )
        );

      res.json({
        metas
      });
    } catch (error) {
      console.error(
        "Catalog error:",
        error
      );

      res.status(500).json({
        metas: [],
        error:
          error.message
      });
    }
  }
);

/* -------------------------------------------------
   CATALOG WITHOUT EXTRA
------------------------------------------------- */

app.get(
  "/catalog/:type/:id.json",
  (req, res) => {
    try {
      const rows =
        getCatalogRows(
          req.params.type,
          "",
          0
        );

      const metas =
        rows.map(
          (row) =>
            makeMeta(
              row,
              req
            )
        );

      res.json({
        metas
      });
    } catch (error) {
      console.error(
        "Catalog error:",
        error
      );

      res.status(500).json({
        metas: [],
        error:
          error.message
      });
    }
  }
);

/* -------------------------------------------------
   META
------------------------------------------------- */

app.get(
  "/meta/:type/:id.json",
  (req, res) => {
    try {
      const rawId =
        req.params.id.replace(
          /^tg:/,
          ""
        );

      const row =
        getMediaById(rawId);

      if (!row) {
        return res.status(404).json({
          meta: null
        });
      }

      res.json({
        meta:
          makeMeta(
            row,
            req
          )
      });
    } catch (error) {
      console.error(
        "Meta error:",
        error
      );

      res.status(500).json({
        meta: null,
        error:
          error.message
      });
    }
  }
);

/* -------------------------------------------------
   STREAM
------------------------------------------------- */

app.get(
  "/stream/:type/:id.json",
  async (req, res) => {
    try {
      const rawId =
        req.params.id.replace(
          /^tg:/,
          ""
        );

      const row =
        getMediaById(rawId);

      if (!row) {
        return res.status(404).json({
          streams: []
        });
      }

      const baseUrl =
        getBaseUrl(req);

      res.json({
        streams: [
          {
            title:
              row.title ||
              row.filename ||
              "Play",

            url:
              `${baseUrl}/file/${row.message_id}`,

            behaviorHints: {
              notWebReady: false
            }
          }
        ]
      });
    } catch (error) {
      console.error(
        "Stream error:",
        error
      );

      res.status(500).json({
        streams: [],
        error:
          error.message
      });
    }
  }
);

/* -------------------------------------------------
   TELEGRAM FILE STREAM
------------------------------------------------- */

app.get(
  "/file/:messageId",
  async (req, res) => {
    try {
      const messageId =
        Number(
          req.params.messageId
        );

      const message =
        await getMessage(
          messageId
        );

      if (!message) {
        return res
          .status(404)
          .send(
            "Telegram message not found"
          );
      }

      const media =
        message.media;

      const document =
        media?.document;

      const fileSize =
        Number(
          document?.size || 0
        );

      if (!fileSize) {
        return res
          .status(500)
          .send(
            "File size unavailable"
          );
      }

      const mime =
        document?.mimeType ||
        "video/mp4";

      const range =
        req.headers.range;

      let start = 0;

      let end =
        fileSize - 1;

      if (range) {
        const match =
          range.match(
            /bytes=(\d*)-(\d*)/
          );

        if (match) {
          if (match[1]) {
            start =
              Number(match[1]);
          }

          if (match[2]) {
            end =
              Number(match[2]);
          }
        }
      }

      if (
        start >= fileSize ||
        end >= fileSize ||
        start > end
      ) {
        res.status(416);

        res.setHeader(
          "Content-Range",
          `bytes */${fileSize}`
        );

        return res.end();
      }

      const contentLength =
        end - start + 1;

      if (range) {
        res.status(206);

        res.setHeader(
          "Content-Range",
          `bytes ${start}-${end}/${fileSize}`
        );
      } else {
        res.status(200);
      }

      res.setHeader(
        "Content-Type",
        mime
      );

      res.setHeader(
        "Content-Length",
        contentLength
      );

      res.setHeader(
        "Accept-Ranges",
        "bytes"
      );

      res.setHeader(
        "Cache-Control",
        "no-cache"
      );

      const stream =
        await streamMessage(
          message,
          start,
          end
        );

      for await (
        const chunk of stream
      ) {
        if (res.destroyed) {
          break;
        }

        res.write(chunk);
      }

      if (!res.destroyed) {
        res.end();
      }
    } catch (error) {
      console.error(
        "File streaming error:",
        error
      );

      if (!res.headersSent) {
        res
          .status(500)
          .send(
            `Streaming error: ${error.message}`
          );
      } else {
        res.destroy();
      }
    }
  }
);

/* -------------------------------------------------
   INCREMENTAL TELEGRAM INDEXING
------------------------------------------------- */

async function ensureIndexed() {
  console.log(
    "Checking Telegram for new media..."
  );

  try {
    await indexTelegram();

    console.log(
      "Telegram indexing check completed."
    );
  } catch (error) {
    console.error(
      "Telegram indexing failed:",
      error
    );

    /*
      Do not crash the web server if
      Telegram indexing fails.
    */
  }
}

/* -------------------------------------------------
   START SERVER
------------------------------------------------- */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Server running on port ${PORT}`
    );

    /*
      Start indexing in background.
      Server remains available even if
      Telegram indexing encounters an error.
    */

    ensureIndexed();
  }
);
