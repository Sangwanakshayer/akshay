import express from "express";
import dotenv from "dotenv";

import fs from "fs";
import path from "path";
import { spawn } from "child_process";

import ffmpegPath from "ffmpeg-static";
import { Decoder } from "ebml";

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


/* =========================================================
   POSTER CACHE
========================================================= */

const posterDir =
  path.resolve("./data/posters");

if (!fs.existsSync(posterDir)) {
  fs.mkdirSync(
    posterDir,
    {
      recursive: true
    }
  );
}


/* =========================================================
   CORS
========================================================= */

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


/* =========================================================
   BASE URL
========================================================= */

function getBaseUrl(req) {
  return (
    process.env.PUBLIC_BASE_URL ||
    `${req.protocol}://${req.get("host")}`
  );
}


/* =========================================================
   DATABASE
========================================================= */

function getMediaById(id) {
  const db =
    getDb();

  return db
    .prepare(
      "SELECT * FROM media WHERE id = ?"
    )
    .get(
      Number(id)
    );
}


/* =========================================================
   META
========================================================= */

function makeMeta(row, req) {
  const baseUrl =
    getBaseUrl(req);

  const posterUrl =
    `${baseUrl}/poster/${row.message_id}`;

  return {
    id:
      `tg:${row.id}`,

    type:
      row.type === "series"
        ? "series"
        : "movie",

    name:
      row.title ||
      row.filename ||
      `Telegram ${row.message_id}`,

    poster:
      posterUrl,

    background:
      posterUrl,

    description:
      row.caption || "",

    year:
      row.year || undefined,

    streams: [
      {
        title:
          "Play",

        url:
          `${baseUrl}/stream/${row.type}/tg:${row.id}.json`
      }
    ]
  };
}


/* =========================================================
   EXTRA PARSER
========================================================= */

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


/* =========================================================
   CATALOG
========================================================= */

function getCatalogRows(
  type,
  search = "",
  skip = 0
) {
  const db =
    getDb();

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


/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/",
  (req, res) => {
    res.json({
      ok: true,
      name:
        "Happy Telegram Media Addon",
      status:
        "running",
      version:
        "1.2.0"
    });
  }
);


/* =========================================================
   MANIFEST
========================================================= */

app.get(
  "/manifest.json",
  (req, res) => {
    res.sendFile(
      "manifest.json",
      {
        root:
          process.cwd()
      }
    );
  }
);


/* =========================================================
   CATALOG WITH EXTRA
========================================================= */

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
          row =>
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


/* =========================================================
   CATALOG WITHOUT EXTRA
========================================================= */

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
          row =>
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


/* =========================================================
   META
========================================================= */

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
        getMediaById(
          rawId
        );

      if (!row) {
        return res
          .status(404)
          .json({
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


/* =========================================================
   STREAM
========================================================= */

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
        getMediaById(
          rawId
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
            title:
              row.title ||
              row.filename ||
              "Play",

            url:
              `${baseUrl}/file/${row.message_id}`,

            behaviorHints: {
              notWebReady:
                false
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


/* =========================================================
   MKV / EBML DURATION
========================================================= */

async function getMkvDuration(
  message
) {

  /*
   * We progressively inspect the beginning
   * of the MKV file.
   *
   * Usually Matroska Info is near the beginning.
   */

  const probeSizes = [
    4 * 1024 * 1024,
    16 * 1024 * 1024,
    32 * 1024 * 1024
  ];

  let lastError = null;


  for (
    const probeSize of probeSizes
  ) {

    try {

      console.log(
        `Probing MKV metadata: ${probeSize} bytes`
      );


      /*
       * Download ONLY the requested
       * beginning portion from Telegram.
       */
      const stream =
        await streamMessage(
          message,
          0,
          probeSize - 1
        );


      const chunks = [];

      let total = 0;


      for await (
        const chunk of stream
      ) {

        chunks.push(
          Buffer.from(chunk)
        );

        total +=
          chunk.length;

        /*
         * Safety limit.
         */
        if (
          total >= probeSize
        ) {
          break;
        }
      }


      if (
        total === 0
      ) {
        throw new Error(
          "No MKV data received"
        );
      }


      const buffer =
        Buffer.concat(
          chunks
        );


      console.log(
        `Received ${buffer.length} bytes for MKV probe`
      );


      /*
       * Decode EBML.
       */
      const decoder =
        new Decoder();


      let elements;


      try {

        elements =
          decoder.decode(
            buffer
          );

      } catch (decodeError) {

        /*
         * Truncated EBML is possible
         * when metadata continues beyond
         * current probe size.
         *
         * Continue with a larger probe.
         */
        lastError =
          decodeError;

        console.log(
          `EBML decode incomplete at ${probeSize} bytes`
        );

        continue;
      }


      let timecodeScale =
        1000000;

      let durationValue =
        null;


      for (
        const element
        of elements
      ) {

        if (
          !element ||
          !element[1]
        ) {
          continue;
        }


        const info =
          element[1];


        if (
          info.name ===
          "TimecodeScale"
        ) {

          const value =
            Number(
              info.value
            );

          if (
            Number.isFinite(
              value
            ) &&
            value > 0
          ) {

            timecodeScale =
              value;
          }
        }


        if (
          info.name ===
          "Duration"
        ) {

          const value =
            Number(
              info.value
            );

          if (
            Number.isFinite(
              value
            ) &&
            value > 0
          ) {

            durationValue =
              value;
          }
        }


        /*
         * Once both values are found,
         * no need to parse further.
         */
        if (
          durationValue !== null
        ) {
          break;
        }
      }


      if (
        durationValue !== null
      ) {

        /*
         * Matroska:
         *
         * Duration × TimecodeScale
         * gives nanoseconds.
         *
         * Convert to seconds.
         */
        const durationSeconds =
          (
            durationValue *
            timecodeScale
          ) /
          1000000000;


        if (
          Number.isFinite(
            durationSeconds
          ) &&
          durationSeconds > 0
        ) {

          console.log(
            `MKV duration found: ${durationSeconds.toFixed(2)} seconds`
          );

          return durationSeconds;
        }
      }


      lastError =
        new Error(
          "Duration element not found in current MKV probe"
        );

    } catch (error) {

      lastError =
        error;

      console.error(
        `MKV probe error at ${probeSize} bytes:`,
        error.message
      );
    }
  }


  throw new Error(
    `MKV duration could not be found. ${
      lastError?.message ||
      "Unknown error"
    }`
  );
}


/* =========================================================
   GENERATE POSTER
========================================================= */

async function generatePoster(
  message,
  inputUrl
) {

  const messageId =
    Number(
      message.id
    );


  const outputPath =
    path.join(
      posterDir,
      `${messageId}.jpg`
    );


  /*
   * Already cached.
   */
  if (
    fs.existsSync(
      outputPath
    )
  ) {

    console.log(
      `Using cached poster: ${messageId}`
    );

    return outputPath;
  }


  /*
   * Get MKV duration.
   */
  const duration =
    await getMkvDuration(
      message
    );


  /*
   * 25% position.
   */
  let seekSeconds =
    duration * 0.25;


  /*
   * Avoid first/last frame.
   */
  seekSeconds =
    Math.max(
      1,
      Math.min(
        seekSeconds,
        duration - 1
      )
    );


  const hours =
    Math.floor(
      seekSeconds / 3600
    );


  const minutes =
    Math.floor(
      (seekSeconds % 3600) / 60
    );


  const seconds =
    seekSeconds % 60;


  const timestamp =
    [
      String(hours)
        .padStart(2, "0"),

      String(minutes)
        .padStart(2, "0"),

      seconds
        .toFixed(2)
        .padStart(5, "0")
    ].join(":");


  console.log(
    `Generating poster for message ${messageId}`
  );

  console.log(
    `Duration: ${duration.toFixed(2)} sec`
  );

  console.log(
    `25% position: ${timestamp}`
  );


  return new Promise(
    (resolve, reject) => {

      const ffmpeg =
        spawn(
          ffmpegPath,
          [
            "-hide_banner",

            "-loglevel",
            "error",

            /*
             * Seek to 25%.
             */
            "-ss",
            timestamp,

            /*
             * HTTP Range-enabled
             * video endpoint.
             */
            "-i",
            inputUrl,

            /*
             * One frame.
             */
            "-frames:v",
            "1",

            /*
             * Poster size.
             */
            "-vf",
            "scale=600:-2",

            /*
             * JPEG quality.
             */
            "-q:v",
            "3",

            "-y",
            outputPath
          ],
          {
            stdio: [
              "ignore",
              "ignore",
              "pipe"
            ]
          }
        );


      let stderr = "";


      ffmpeg.stderr.on(
        "data",
        data => {

          stderr +=
            data.toString();
        }
      );


      ffmpeg.on(
        "error",
        error => {

          reject(
            error
          );
        }
      );


      ffmpeg.on(
        "close",
        code => {

          if (
            code === 0 &&
            fs.existsSync(
              outputPath
            )
          ) {

            console.log(
              `Poster generated successfully: ${messageId}`
            );

            resolve(
              outputPath
            );

            return;
          }


          reject(
            new Error(
              `FFmpeg poster generation failed. code=${code}. ${stderr.slice(-2000)}`
            )
          );
        }
      );
    }
  );
}


/* =========================================================
   POSTER ROUTE
========================================================= */

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


      /*
       * Get fresh Telegram message.
       */
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


      /*
       * Must have a document.
       */
      if (
        !message.media?.document
      ) {

        return res
          .status(404)
          .send(
            "Telegram document not found"
          );
      }


      const baseUrl =
        getBaseUrl(req);


      const inputUrl =
        `${baseUrl}/file/${messageId}`;


      const posterPath =
        await generatePoster(
          message,
          inputUrl
        );


      const stat =
        fs.statSync(
          posterPath
        );


      res.setHeader(
        "Content-Type",
        "image/jpeg"
      );


      res.setHeader(
        "Content-Length",
        stat.size
      );


      res.setHeader(
        "Cache-Control",
        "public, max-age=31536000, immutable"
      );


      fs.createReadStream(
        posterPath
      ).pipe(
        res
      );


    } catch (error) {

      console.error(
        "Poster error:",
        error
      );


      if (
        !res.headersSent
      ) {

        res
          .status(500)
          .send(
            `Poster generation failed: ${error.message}`
          );

      } else {

        res.destroy();

      }
    }
  }
);


/* =========================================================
   VIDEO FILE STREAM
========================================================= */

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
          document?.size ||
          0
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


      /*
       * Parse HTTP Range.
       */
      if (range) {

        const match =
          range.match(
            /bytes=(\d*)-(\d*)/
          );


        if (match) {

          if (
            match[1]
          ) {

            start =
              Number(
                match[1]
              );
          }


          if (
            match[2]
          ) {

            end =
              Number(
                match[2]
              );
          }
        }
      }


      /*
       * Invalid range.
       */
      if (
        start >= fileSize ||
        end >= fileSize ||
        start > end
      ) {

        res.status(
          416
        );


        res.setHeader(
          "Content-Range",
          `bytes */${fileSize}`
        );


        return res.end();
      }


      const contentLength =
        end - start + 1;


      if (range) {

        res.status(
          206
        );


        res.setHeader(
          "Content-Range",
          `bytes ${start}-${end}/${fileSize}`
        );

      } else {

        res.status(
          200
        );
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


      /*
       * Stream requested portion
       * directly from Telegram.
       */
      const stream =
        await streamMessage(
          message,
          start,
          end
        );


      for await (
        const chunk of stream
      ) {

        if (
          res.destroyed
        ) {
          break;
        }


        res.write(
          chunk
        );
      }


      if (
        !res.destroyed
      ) {

        res.end();
      }


    } catch (error) {

      console.error(
        "File streaming error:",
        error
      );


      if (
        !res.headersSent
      ) {

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


/* =========================================================
   INITIAL INDEXING
========================================================= */

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
  }
}


/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Server running on port ${PORT}`
    );

    console.log(
      `Poster cache: ${posterDir}`
    );

    ensureIndexed();
  }
);
