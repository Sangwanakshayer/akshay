import express from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";

import {
  getDb
} from "./db.js";

import {
  getMessage,
  streamMessage
} from "./telegram.js";

import {
  indexTelegram
} from "./indexer.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT =
  Number(process.env.PORT) || 7000;

const db =
  getDb();

const MANIFEST_PATH =
  path.resolve("./manifest.json");


// ======================================================
// BASE URL
// ======================================================

function getBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(
      /\/$/,
      ""
    );
  }

  const forwardedProto =
    req.headers["x-forwarded-proto"];

  const protocol =
    forwardedProto || req.protocol;

  return `${protocol}://${req.get("host")}`;
}


// ======================================================
// SAFE JSON
// ======================================================

function parseJson(
  value,
  fallback = []
) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}


// ======================================================
// ROOT
// ======================================================

app.get(
  "/",
  (req, res) => {
    res.json({
      ok: true,
      name: "Happy Telegram Addon",
      status: "running"
    });
  }
);


// ======================================================
// MANIFEST
// ======================================================

app.get(
  "/manifest.json",
  (req, res) => {
    try {
      res.sendFile(
        MANIFEST_PATH
      );
    } catch (error) {
      console.error(
        "Manifest error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Manifest unavailable"
        });
    }
  }
);


// ======================================================
// CATALOG
// ======================================================

app.get(
  "/catalog/:type/:id.json",
  (req, res) => {
    try {
      const type =
        req.params.type;

      const search =
        String(
          req.query.search || ""
        ).trim();

      const skip =
        Math.max(
          0,
          Number(
            req.query.skip || 0
          )
        );

      const limit = 100;

      let rows;

      if (search) {
        rows =
          db.prepare(`
            SELECT *
            FROM media
            WHERE type = ?
              AND (
                title LIKE ?
                OR filename LIKE ?
                OR caption LIKE ?
                OR tpdb_title LIKE ?
                OR tpdb_studio LIKE ?
              )
            ORDER BY id DESC
            LIMIT ?
            OFFSET ?
          `).all(
            type,
            `%${search}%`,
            `%${search}%`,
            `%${search}%`,
            `%${search}%`,
            `%${search}%`,
            limit,
            skip
          );
      } else {
        rows =
          db.prepare(`
            SELECT *
            FROM media
            WHERE type = ?
            ORDER BY id DESC
            LIMIT ?
            OFFSET ?
          `).all(
            type,
            limit,
            skip
          );
      }

      const baseUrl =
        getBaseUrl(req);

      const metas =
        rows.map(
          row =>
            makeMeta(
              row,
              baseUrl
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

      res
        .status(500)
        .json({
          metas: []
        });
    }
  }
);


// ======================================================
// META
// ======================================================

app.get(
  "/meta/:type/:id.json",
  (req, res) => {
    try {
      const rawId =
        String(
          req.params.id
        );

      const numericId =
        rawId.startsWith("tg:")
          ? Number(
              rawId.substring(3)
            )
          : Number(rawId);

      if (!numericId) {
        return res
          .status(400)
          .json({
            error:
              "Invalid media ID"
          });
      }

      const row =
        db.prepare(`
          SELECT *
          FROM media
          WHERE id = ?
        `).get(
          numericId
        );

      if (!row) {
        return res
          .status(404)
          .json({
            error:
              "Media not found"
          });
      }

      const baseUrl =
        getBaseUrl(req);

      res.json({
        meta:
          makeMeta(
            row,
            baseUrl
          )
      });

    } catch (error) {
      console.error(
        "Meta error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Meta unavailable"
        });
    }
  }
);


// ======================================================
// STREAM METADATA
// ======================================================

app.get(
  "/stream/:type/:id.json",
  async (req, res) => {
    try {
      const rawId =
        String(
          req.params.id
        );

      const numericId =
        rawId.startsWith("tg:")
          ? Number(
              rawId.substring(3)
            )
          : Number(rawId);

      if (!numericId) {
        return res
          .status(400)
          .json({
            streams: []
          });
      }

      const row =
        db.prepare(`
          SELECT *
          FROM media
          WHERE id = ?
        `).get(
          numericId
        );

      if (!row) {
        return res
          .status(404)
          .json({
            streams: []
          });
      }

      const baseUrl =
        getBaseUrl(req);

      const displayTitle =
        row.tpdb_title ||
        row.title ||
        row.filename ||
        "Telegram";

      res.json({
        streams: [
          {
            name:
              displayTitle,

            title:
              row.filename ||
              displayTitle,

            url:
              `${baseUrl}/file/${row.message_id}`,

            behaviorHints: {
              notWebReady: true
            }
          }
        ]
      });

    } catch (error) {
      console.error(
        "Stream metadata error:",
        error
      );

      res
        .status(500)
        .json({
          streams: []
        });
    }
  }
);


// ======================================================
// FILE STREAM
// ======================================================

app.get(
  "/file/:messageId",
  async (req, res) => {
    try {
      const messageId =
        Number(
          req.params.messageId
        );

      if (!messageId) {
        return res
          .status(400)
          .send(
            "Invalid message ID"
          );
      }

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

      const document =
        message?.media?.document;

      if (!document) {
        return res
          .status(404)
          .send(
            "Telegram document not found"
          );
      }

      const fileSize =
        Number(
          document.size || 0
        );

      if (!fileSize) {
        return res
          .status(500)
          .send(
            "File size unavailable"
          );
      }

      const mime =
        document.mimeType ||
        "application/octet-stream";

      const range =
        req.headers.range;


      // ==================================================
      // FULL FILE
      // ==================================================

      if (!range) {
        res.status(200);

        res.setHeader(
          "Content-Type",
          mime
        );

        res.setHeader(
          "Content-Length",
          fileSize
        );

        res.setHeader(
          "Accept-Ranges",
          "bytes"
        );

        res.setHeader(
          "Cache-Control",
          "no-cache"
        );

        const iterator =
          await streamMessage(
            message,
            0,
            fileSize - 1
          );

        try {
          for await (
            const chunk of iterator
          ) {
            if (!res.write(chunk)) {
              await new Promise(
                resolve =>
                  res.once(
                    "drain",
                    resolve
                  )
              );
            }
          }

          res.end();

        } catch (error) {
          console.error(
            "Full stream error:",
            error
          );

          res.destroy();
        }

        return;
      }


      // ==================================================
      // RANGE REQUEST
      // ==================================================

      const match =
        range.match(
          /bytes=(\d*)-(\d*)/
        );

      if (!match) {
        return res
          .status(416)
          .set(
            "Content-Range",
            `bytes */${fileSize}`
          )
          .end();
      }

      let start =
        match[1]
          ? Number(match[1])
          : null;

      let end =
        match[2]
          ? Number(match[2])
          : null;


      // bytes=-500000

      if (
        start === null &&
        end !== null
      ) {
        const suffix =
          end;

        start =
          Math.max(
            0,
            fileSize - suffix
          );

        end =
          fileSize - 1;
      }


      // bytes=500000-

      if (
        start !== null &&
        end === null
      ) {
        end =
          fileSize - 1;
      }


      if (
        start === null ||
        end === null ||
        start < 0 ||
        end < start ||
        start >= fileSize
      ) {
        return res
          .status(416)
          .set(
            "Content-Range",
            `bytes */${fileSize}`
          )
          .end();
      }


      end =
        Math.min(
          end,
          fileSize - 1
        );

      const contentLength =
        end - start + 1;


      // ==================================================
      // PARTIAL RESPONSE
      // ==================================================

      res.status(206);

      res.setHeader(
        "Content-Type",
        mime
      );

      res.setHeader(
        "Content-Length",
        contentLength
      );

      res.setHeader(
        "Content-Range",
        `bytes ${start}-${end}/${fileSize}`
      );

      res.setHeader(
        "Accept-Ranges",
        "bytes"
      );

      res.setHeader(
        "Cache-Control",
        "no-cache"
      );


      console.log(
        `HTTP range: ${start}-${end}/${fileSize}`
      );


      const iterator =
        await streamMessage(
          message,
          start,
          end
        );


      try {
        for await (
          const chunk of iterator
        ) {
          if (!res.write(chunk)) {
            await new Promise(
              resolve =>
                res.once(
                  "drain",
                  resolve
                )
            );
          }
        }

        res.end();

      } catch (error) {
        console.error(
          "Range stream error:",
          error
        );

        res.destroy();
      }

    } catch (error) {
      console.error(
        "File endpoint error:",
        error
      );

      if (!res.headersSent) {
        res
          .status(500)
          .send(
            "File streaming failed"
          );
      } else {
        res.destroy();
      }
    }
  }
);


// ======================================================
// MAKE META
// ======================================================

function makeMeta(
  row,
  baseUrl
) {
  const performers =
    parseJson(
      row.tpdb_performers,
      []
    );

  const tags =
    parseJson(
      row.tpdb_tags,
      []
    );


  const cast =
    performers
      .map(
        performer => {
          if (
            typeof performer ===
            "string"
          ) {
            return performer;
          }

          return (
            performer?.name ||
            performer?.display_name ||
            performer?.title ||
            ""
          );
        }
      )
      .filter(Boolean);


  const genres =
    tags
      .map(
        tag => {
          if (
            typeof tag ===
            "string"
          ) {
            return tag;
          }

          return (
            tag?.name ||
            tag?.title ||
            ""
          );
        }
      )
      .filter(Boolean);


  const type =
    row.type === "series"
      ? "series"
      : "movie";


  const displayTitle =
    row.tpdb_title ||
    row.title ||
    row.filename ||
    `Telegram ${row.message_id}`;


  const description =
    row.tpdb_description ||
    row.caption ||
    row.filename ||
    "";


  const year =
    row.tpdb_year ||
    row.year ||
    undefined;


  const meta = {
    id:
      `tg:${row.id}`,

    type,

    name:
      displayTitle,

    description,

    year,

    releaseInfo:
      year
        ? String(year)
        : undefined,

    genres:
      genres.length
        ? genres
        : undefined,

    cast:
      cast.length
        ? cast
        : undefined,

    links: [],

    behaviorHints: {
      defaultVideoId:
        `tg:${row.id}`,

      adult: true
    },

    streams: [
      {
        name:
          displayTitle,

        title:
          row.filename ||
          displayTitle,

        url:
          `${baseUrl}/file/${row.message_id}`,

        behaviorHints: {
          notWebReady: true
        }
      }
    ]
  };


  // TPDB poster only.
  // No FFmpeg/local poster fallback.

  if (row.tpdb_poster) {
    meta.poster =
      row.tpdb_poster;
  }

  if (row.tpdb_background) {
    meta.background =
      row.tpdb_background;
  } else if (
    row.tpdb_poster
  ) {
    meta.background =
      row.tpdb_poster;
  }


  return JSON.parse(
    JSON.stringify(meta)
  );
}


// ======================================================
// STARTUP INDEX
// ======================================================

async function ensureIndexed() {
  try {
    console.log(
      "Checking Telegram index..."
    );

    await indexTelegram();

    console.log(
      "Telegram index check completed."
    );

  } catch (error) {
    console.error(
      "Initial indexing failed:",
      error
    );
  }
}


// ======================================================
// START SERVER
// ======================================================

app.listen(
  PORT,
  "0.0.0.0",
  async () => {
    console.log(
      `Happy Telegram addon running on port ${PORT}`
    );

    await ensureIndexed();
  }
);
