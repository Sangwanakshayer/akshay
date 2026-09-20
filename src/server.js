import express from "express";
import cors from "cors";
import fs from "fs";
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

import {
  generatePoster
} from "./poster.js";

dotenv.config();

const app = express();

app.use(cors());

app.use(
  express.json()
);

const PORT =
  Number(process.env.PORT) || 7000;

const db =
  getDb();

const MANIFEST_PATH =
  path.resolve(
    "./manifest.json"
  );


// ======================================================
// BASE URL
// ======================================================

function getBaseUrl(req) {
  if (
    process.env.PUBLIC_BASE_URL
  ) {
    return process.env.PUBLIC_BASE_URL
      .replace(/\/$/, "");
  }

  const forwardedProto =
    req.headers["x-forwarded-proto"];

  const protocol =
    forwardedProto ||
    req.protocol;

  return `${protocol}://${req.get("host")}`;
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

      const catalogId =
        req.params.id;

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

      const limit =
        100;

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
              )
            ORDER BY
              COALESCE(year, 0) DESC,
              id DESC
            LIMIT ?
            OFFSET ?
          `).all(
            type,
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
            ORDER BY
              id DESC
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
// POSTER
// ======================================================

app.get(
  "/poster/:messageId",
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

      const posterPath =
        path.resolve(
          "./data/posters",
          `${messageId}.jpg`
        );

      // --------------------------------------------------
      // CACHE HIT
      // --------------------------------------------------

      if (
        fs.existsSync(
          posterPath
        )
      ) {
        res.setHeader(
          "Content-Type",
          "image/jpeg"
        );

        res.setHeader(
          "Cache-Control",
          "public, max-age=31536000, immutable"
        );

        return res.sendFile(
          posterPath
        );
      }

      // --------------------------------------------------
      // GENERATE POSTER AT 02:30
      // --------------------------------------------------

      console.log(
        `Poster not cached. Generating for message ${messageId}`
      );

      const generatedPath =
        await generatePoster(
          messageId
        );

      if (
        !generatedPath ||
        !fs.existsSync(
          generatedPath
        )
      ) {
        throw new Error(
          "Poster file was not generated"
        );
      }

      res.setHeader(
        "Content-Type",
        "image/jpeg"
      );

      res.setHeader(
        "Cache-Control",
        "public, max-age=31536000, immutable"
      );

      return res.sendFile(
        generatedPath
      );

    } catch (error) {
      console.error(
        "Poster error:",
        error
      );

      return res
        .status(500)
        .send(
          "Poster generation failed"
        );
    }
  }
);


// ======================================================
// STREAM
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

      res.json({
        streams: [
          {
            name:
              row.title ||
              row.filename ||
              "Telegram",

            title:
              row.filename ||
              row.title ||
              "Telegram",

            url:
              `${baseUrl}/file/${row.message_id}`,

            behaviorHints: {
              notWebReady:
                true
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


      // ==================================================
      // RANGE REQUEST
      // ==================================================

      const range =
        req.headers.range;

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
            if (
              !res.write(chunk)
            ) {
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

          if (
            !res.headersSent
          ) {
            res
              .status(500)
              .end();
          } else {
            res.destroy();
          }
        }

        return;
      }


      // ==================================================
      // PARSE RANGE
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
        const suffixLength =
          end;

        start =
          Math.max(
            0,
            fileSize -
              suffixLength
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
        end -
        start +
        1;


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


      // ==================================================
      // TELEGRAM STREAM
      // ==================================================

      console.log(
        `HTTP range request: ${start}-${end}/${fileSize}`
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
          if (
            !res.write(chunk)
          ) {
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

      if (
        !res.headersSent
      ) {
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
  const posterUrl =
    `${baseUrl}/poster/${row.message_id}`;

  const streamUrl =
    `${baseUrl}/file/${row.message_id}`;

  const type =
    row.type === "series"
      ? "series"
      : "movie";

  const meta = {
    id:
      `tg:${row.id}`,

    type,

    name:
      row.title ||
      row.filename ||
      `Telegram ${row.message_id}`,

    poster:
      posterUrl,

    background:
      posterUrl,

    description:
      row.caption ||
      row.filename ||
      "",

    year:
      row.year ||
      undefined,

    releaseInfo:
      row.year
        ? String(row.year)
        : undefined,

    runtime:
      undefined,

    website:
      undefined,

    videos:
      undefined,

    behaviorHints: {
      defaultVideoId:
        `tg:${row.id}`
    },

    links: [],

    streams: [
      {
        name:
          row.title ||
          row.filename ||
          "Telegram",

        title:
          row.filename ||
          row.title ||
          "Telegram",

        url:
          streamUrl,

        behaviorHints: {
          notWebReady: true
        }
      }
    ]
  };

  // Remove undefined fields
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
