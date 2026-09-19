import express from "express";
import dotenv from "dotenv";

import {
  getMessage,
  streamMessage
} from "./telegram.js";

import {
  getDb
} from "./db.js";

dotenv.config();

const app = express();

const PORT =
  Number(process.env.PORT) || 7000;

const BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  `http://localhost:${PORT}`;


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

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, HEAD, OPTIONS"
  );

  next();
});


/* =========================================================
   HEALTH
========================================================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Happy Telegram Media Addon",
    status: "running",
    version: "1.0.0"
  });
});


/* =========================================================
   MANIFEST
========================================================= */

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


/* =========================================================
   DATABASE HELPER
========================================================= */

function getMediaById(id) {
  const db = getDb();

  return db
    .prepare(
      `
      SELECT *
      FROM media
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(id);
}


/* =========================================================
   BUILD META
========================================================= */

function makeMeta(row) {
  return {
    id: `tg:${row.id}`,

    type:
      row.type || "movie",

    name:
      row.title ||
      row.filename ||
      `Telegram ${row.message_id}`,

    description:
      row.caption || "",

    releaseInfo:
      row.year
        ? String(row.year)
        : undefined,

    poster:
      row.thumb
        ? `${BASE_URL}/thumb/${row.id}`
        : undefined,

    background:
      row.thumb
        ? `${BASE_URL}/thumb/${row.id}`
        : undefined,

    genres: [],

    videos: []
  };
}


/* =========================================================
   SEARCH / CATALOG HELPERS
========================================================= */

function parseExtra(extra) {
  if (!extra) {
    return {};
  }

  try {
    const params =
      new URLSearchParams(
        extra
      );

    return {
      search:
        params.get("search") || "",

      skip:
        Number(
          params.get("skip") || 0
        )
    };

  } catch {
    return {};
  }
}


function getCatalogRows(
  type,
  search = "",
  skip = 0
) {
  const db = getDb();

  const cleanSearch =
    String(search || "").trim();

  let rows;

  if (cleanSearch) {

    const pattern =
      `%${cleanSearch}%`;

    rows =
      db
        .prepare(
          `
          SELECT *
          FROM media
          WHERE type = ?
          AND (
            title LIKE ?
            OR filename LIKE ?
            OR caption LIKE ?
          )
          ORDER BY indexed_at DESC
          LIMIT 100
          OFFSET ?
          `
        )
        .all(
          type,
          pattern,
          pattern,
          pattern,
          skip
        );

  } else {

    rows =
      db
        .prepare(
          `
          SELECT *
          FROM media
          WHERE type = ?
          ORDER BY indexed_at DESC
          LIMIT 100
          OFFSET ?
          `
        )
        .all(
          type,
          skip
        );
  }

  return rows;
}


/* =========================================================
   CATALOG
========================================================= */

/*
   Normal:

   /catalog/movie/happy-movies.json

   Search:

   /catalog/movie/happy-movies/search=abc.json
*/

app.get(
  "/catalog/:type/:id.json",
  (req, res) => {

    handleCatalog(
      req,
      res,
      null
    );
  }
);


app.get(
  "/catalog/:type/:id/:extra.json",
  (req, res) => {

    handleCatalog(
      req,
      res,
      req.params.extra
    );
  }
);


function handleCatalog(
  req,
  res,
  extra
) {
  try {

    const type =
      req.params.type;

    /*
     * Search may arrive either:
     *
     * /catalog/.../search=abc.json
     *
     * or as query parameter.
     */

    const parsed =
      parseExtra(extra);

    const search =
      parsed.search ||
      req.query.search ||
      "";

    const skip =
      parsed.skip ||
      Number(
        req.query.skip || 0
      );

    const rows =
      getCatalogRows(
        type,
        search,
        skip
      );

    const metas =
      rows.map(
        (row) => ({
          id: `tg:${row.id}`,

          type:
            row.type || type,

          name:
            row.title ||
            row.filename ||
            `Telegram ${row.message_id}`,

          description:
            row.caption || "",

          releaseInfo:
            row.year
              ? String(row.year)
              : undefined,

          poster:
            row.thumb
              ? `${BASE_URL}/thumb/${row.id}`
              : undefined
        })
      );

    res.json({
      metas
    });

  } catch (err) {

    console.error(
      "CATALOG ERROR:",
      err
    );

    res.status(500).json({
      error: err.message
    });
  }
}


/* =========================================================
   META
========================================================= */

app.get(
  "/meta/:type/:id.json",
  (req, res) => {

    try {

      const id =
        req.params.id.replace(
          /^tg:/,
          ""
        );

      const row =
        getMediaById(id);

      if (!row) {
        return res
          .status(404)
          .json({
            error:
              "Media not found"
          });
      }

      res.json({
        meta:
          makeMeta(row)
      });

    } catch (err) {

      console.error(
        "META ERROR:",
        err
      );

      res.status(500).json({
        error: err.message
      });
    }
  }
);


/* =========================================================
   STREAM
========================================================= */

app.get(
  "/stream/:type/:id.json",
  (req, res) => {

    try {

      const id =
        req.params.id.replace(
          /^tg:/,
          ""
        );

      const row =
        getMediaById(id);

      if (!row) {
        return res
          .status(404)
          .json({
            error:
              "Media not found"
          });
      }

      const url =
        `${BASE_URL}/file/${row.message_id}`;

      res.json({
        streams: [
          {
            name:
              "Telegram",

            title:
              row.title ||
              row.filename ||
              "Telegram Media",

            url,

            behaviorHints: {
              notWebReady: false
            }
          }
        ]
      });

    } catch (err) {

      console.error(
        "STREAM ERROR:",
        err
      );

      res.status(500).json({
        error: err.message
      });
    }
  }
);


/* =========================================================
   DIRECT TELEGRAM FILE
========================================================= */

app.get(
  "/file/:messageId",
  async (req, res) => {

    try {

      const messageId =
        Number(
          req.params.messageId
        );

      if (
        !Number.isInteger(
          messageId
        )
      ) {
        return res
          .status(400)
          .send(
            "Invalid message ID"
          );
      }

      console.log(
        `\nFile request: Telegram message ${messageId}`
      );

      const message =
        await getMessage(
          messageId
        );

      const file =
        message.file;

      if (!file) {
        return res
          .status(404)
          .send(
            "Telegram message has no media"
          );
      }

      const fileSize =
        Number(
          file.size || 0
        );

      if (!fileSize) {
        return res
          .status(500)
          .send(
            "Telegram file size unavailable"
          );
      }

      const mime =
        file.mimeType ||
        "application/octet-stream";

      let start = 0;

      let end =
        fileSize - 1;

      const range =
        req.headers.range;


      /* =====================================================
         RANGE REQUEST
      ===================================================== */

      if (range) {

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

        const rangeStart =
          match[1];

        const rangeEnd =
          match[2];


        /* bytes=1000- */

        if (
          rangeStart !== ""
        ) {
          start =
            Number(
              rangeStart
            );
        }


        /* bytes=1000-2000 */

        if (
          rangeEnd !== ""
        ) {
          end =
            Number(
              rangeEnd
            );
        }


        /* bytes=-500000 */

        if (
          rangeStart === "" &&
          rangeEnd !== ""
        ) {

          const suffix =
            Number(
              rangeEnd
            );

          start =
            Math.max(
              fileSize - suffix,
              0
            );

          end =
            fileSize - 1;
        }


        if (
          end >= fileSize
        ) {
          end =
            fileSize - 1;
        }


        if (
          start < 0 ||
          start >= fileSize ||
          start > end
        ) {

          return res
            .status(416)
            .set(
              "Content-Range",
              `bytes */${fileSize}`
            )
            .end();
        }

        res.status(206);

        res.setHeader(
          "Content-Range",
          `bytes ${start}-${end}/${fileSize}`
        );

      } else {

        res.status(200);
      }


      /* =====================================================
         HEADERS
      ===================================================== */

      const contentLength =
        end - start + 1;

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
        "Content-Disposition",
        "inline"
      );

      res.setHeader(
        "Cache-Control",
        "no-cache"
      );


      console.log(
        `Streaming ${start}-${end} / ${fileSize}`
      );


      /* =====================================================
         TELEGRAM STREAM
      ===================================================== */

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

        res.write(chunk);
      }


      if (
        !res.destroyed
      ) {
        res.end();
      }


      console.log(
        `Stream finished: ${messageId}`
      );

    } catch (err) {

      console.error(
        "\nFILE STREAM ERROR:",
        err
      );

      if (
        !res.headersSent
      ) {

        res
          .status(500)
          .send(
            `Stream error: ${err.message}`
          );

      } else {

        res.destroy(err);
      }
    }
  }
);


/* =========================================================
   START
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log("");
    console.log(
      "======================================"
    );

    console.log(
      " Happy Telegram Media Addon"
    );

    console.log(
      "======================================"
    );

    console.log(
      `Local: http://localhost:${PORT}`
    );

    console.log(
      `Manifest: http://localhost:${PORT}/manifest.json`
    );

    console.log(
      `Catalog: http://localhost:${PORT}/catalog/movie/happy-movies.json`
    );

    console.log(
      "======================================"
    );

    console.log("");
  }
);