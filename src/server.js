import "dotenv/config";
import express from "express";
import cors from "cors";

import { getDb } from "./db.js";
import { getMessage, streamMessage } from "./telegram.js";

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  `http://localhost:${PORT}`;

const MANIFEST = {
  id: "com.akshay.happytelegram",
  version: "1.0.0",
  name: "Happy Telegram",
  description: "Private Telegram media library",

  resources: [
    "catalog",
    "meta",
    "stream"
  ],

  types: [
    "movie",
    "series"
  ],

  idPrefixes: [
    "tg:"
  ],

  catalogs: [
    {
      type: "movie",
      id: "happy-movies",
      name: "Happy Movies",
      extra: [
        {
          name: "search",
          isRequired: false
        },
        {
          name: "skip",
          isRequired: false
        }
      ]
    },
    {
      type: "series",
      id: "happy-series",
      name: "Happy Series",
      extra: [
        {
          name: "search",
          isRequired: false
        },
        {
          name: "skip",
          isRequired: false
        }
      ]
    }
  ],

  behaviorHints: {
    adult: true,
    p2p: false,
    configurable: false,
    configurationRequired: false
  }
};


/* =========================================================
   DATABASE HELPERS
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


function getMediaByMessageId(messageId) {
  const db = getDb();

  return db
    .prepare(
      `
      SELECT *
      FROM media
      WHERE message_id = ?
      LIMIT 1
      `
    )
    .get(messageId);
}


/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function safeNumber(value, fallback = 0) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}


function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}


function decodeId(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}


function makeTelegramId(id) {
  return `tg:${id}`;
}


function getPosterUrl(row) {
  if (!row) {
    return null;
  }

  if (!row.tpdb_poster) {
    return null;
  }

  /*
   * IMPORTANT:
   * Do not directly use TPDB image URL.
   * Route artwork through our addon so Nuvio receives
   * the same image URL in catalog and detail metadata.
   */
  return `${BASE_URL}/poster/${row.id}`;
}


function getBackgroundUrl(row) {
  if (!row) {
    return null;
  }

  if (row.tpdb_background) {
    return `${BASE_URL}/background/${row.id}`;
  }

  if (row.tpdb_poster) {
    return `${BASE_URL}/poster/${row.id}`;
  }

  return null;
}


/* =========================================================
   CAST HELPERS
   ========================================================= */

function getPerformerName(item) {
  if (!item) {
    return null;
  }

  if (typeof item === "string") {
    return item.trim() || null;
  }

  return (
    item.name ||
    item.title ||
    item.full_name ||
    item.performer ||
    item.actor ||
    null
  );
}


function getPerformerPhoto(item) {
  if (!item || typeof item === "string") {
    return null;
  }

  return (
    item.photo ||
    item.image ||
    item.avatar ||
    item.thumbnail ||
    item.poster ||
    null
  );
}


function getPerformerCharacter(item) {
  if (!item || typeof item === "string") {
    return null;
  }

  return (
    item.character ||
    item.role ||
    null
  );
}


function parsePerformers(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return parsed;
    }

    return [];
  } catch {
    return [];
  }
}


function buildNuvioCast(row) {
  const performers = parsePerformers(
    row.tpdb_performers
  );

  const cast = [];

  for (const performer of performers) {
    const name = getPerformerName(performer);

    if (!name) {
      continue;
    }

    const actor = {
      name
    };

    const character =
      getPerformerCharacter(performer);

    const photo =
      getPerformerPhoto(performer);

    if (character) {
      actor.character = character;
    }

    if (photo) {
      actor.photo = photo;
    }

    cast.push(actor);
  }

  return cast;
}


/* =========================================================
   GENRE / TAG HELPERS
   ========================================================= */

function parseJsonArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return parsed;
    }

    return [];
  } catch {
    return [];
  }
}


function buildGenres(row) {
  const tags = parseJsonArray(
    row.tpdb_tags
  );

  return tags
    .map((tag) => {
      if (typeof tag === "string") {
        return tag.trim();
      }

      if (tag && typeof tag === "object") {
        return (
          tag.name ||
          tag.title ||
          ""
        ).trim();
      }

      return "";
    })
    .filter(Boolean);
}


function buildActorLinks(row) {
  const performers = parsePerformers(
    row.tpdb_performers
  );

  return performers
    .map((performer) => {
      const name =
        getPerformerName(performer);

      if (!name) {
        return null;
      }

      const photo =
        getPerformerPhoto(performer);

      return {
        name,
        ...(photo ? { photo } : {})
      };
    })
    .filter(Boolean);
}


/* =========================================================
   META BUILDER
   ========================================================= */

function makeMeta(row) {
  const id = makeTelegramId(row.id);

  const title =
    cleanText(row.tpdb_title) ||
    cleanText(row.title) ||
    cleanText(row.filename) ||
    "Untitled";

  const year =
    safeNumber(
      row.tpdb_year ||
      row.year ||
      0,
      0
    );

  const description =
    cleanText(row.tpdb_description) ||
    cleanText(row.caption) ||
    "";

  const posterUrl =
    getPosterUrl(row);

  const backgroundUrl =
    getBackgroundUrl(row);

  const cast =
    buildNuvioCast(row);

  const genres =
    buildGenres(row);

  const actorLinks =
    buildActorLinks(row);

  const studio =
    cleanText(row.tpdb_studio);

  const type =
    row.type === "series"
      ? "series"
      : "movie";


  const meta = {
    id,
    type,
    name: title,

    description,

    posterShape: "poster"
  };


  /* =======================================================
     ARTWORK
     ======================================================= */

  if (posterUrl) {
    meta.poster = posterUrl;

    /*
     * Some clients use banner instead of poster
     * for the detail hero image.
     */
    meta.banner = posterUrl;
  }

  if (backgroundUrl) {
    meta.background = backgroundUrl;
  }


  /* =======================================================
     YEAR
     ======================================================= */

  if (year > 0) {
    meta.year = year;
  }


  /* =======================================================
     GENRES
     ======================================================= */

  if (genres.length) {
    meta.genre = genres;
  }


  /* =======================================================
     CAST
     ======================================================= */

  if (cast.length) {
    /*
     * Standard Stremio/Nuvio cast field.
     */
    meta.cast = cast.map(
      (actor) => actor.name
    );
  }


  /* =======================================================
     EXTRA DATA
     ======================================================= */

  meta.app_extras = {
    ...(posterUrl
      ? {
          poster: posterUrl
        }
      : {}),

    ...(backgroundUrl
      ? {
          background: backgroundUrl
        }
      : {}),

    ...(cast.length
      ? {
          cast
        }
      : {}),

    ...(actorLinks.length
      ? {
          actors: actorLinks
        }
      : {}),

    ...(studio
      ? {
          studio
        }
      : {})
  };


  return meta;
}


/* =========================================================
   HEALTH
   ========================================================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: MANIFEST.name,
    version: MANIFEST.version
  });
});


app.get("/health", (req, res) => {
  res.json({
    ok: true
  });
});


/* =========================================================
   MANIFEST
   ========================================================= */

app.get("/manifest.json", (req, res) => {
  res.json(MANIFEST);
});


/* =========================================================
   CATALOG
   ========================================================= */

app.get(
  "/catalog/:type/:id.json",
  (req, res) => {
    try {
      const type =
        req.params.type;

      const catalogId =
        req.params.id;

      const search =
        cleanText(req.query.search);

      const skip =
        Math.max(
          0,
          safeNumber(
            req.query.skip,
            0
          )
        );


      if (
        catalogId !== "happy-movies" &&
        catalogId !== "happy-series"
      ) {
        return res.json({
          metas: []
        });
      }


      const requestedType =
        catalogId === "happy-series"
          ? "series"
          : "movie";


      const db = getDb();

      let rows;


      if (search) {
        const searchTerm =
          `%${search}%`;

        rows = db
          .prepare(
            `
            SELECT *
            FROM media
            WHERE type = ?
              AND (
                title LIKE ?
                OR filename LIKE ?
                OR tpdb_title LIKE ?
                OR tpdb_description LIKE ?
              )
            ORDER BY
              COALESCE(
                year,
                tpdb_year,
                0
              ) DESC,
              id DESC
            LIMIT 100 OFFSET ?
            `
          )
          .all(
            requestedType,
            searchTerm,
            searchTerm,
            searchTerm,
            searchTerm,
            skip
          );
      } else {
        rows = db
          .prepare(
            `
            SELECT *
            FROM media
            WHERE type = ?
            ORDER BY
              id DESC
            LIMIT 100 OFFSET ?
            `
          )
          .all(
            requestedType,
            skip
          );
      }


      const metas =
        rows.map((row) => {
          const meta =
            makeMeta(row);

          /*
           * Catalog cards sometimes need artwork
           * directly from the catalog object.
           */
          return {
            id: meta.id,
            type: meta.type,
            name: meta.name,

            ...(meta.poster
              ? {
                  poster: meta.poster
                }
              : {}),

            ...(meta.background
              ? {
                  background:
                    meta.background
                }
              : {}),

            ...(meta.year
              ? {
                  year: meta.year
                }
              : {}),

            ...(meta.genre
              ? {
                  genre: meta.genre
                }
              : {})
          };
        });


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
        error: "Catalog error"
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
        decodeId(req.params.id);

      let id = rawId;

      if (id.startsWith("tg:")) {
        id = id.slice(3);
      }

      const row =
        getMediaById(
          Number(id)
        );


      if (!row) {
        return res.status(404).json({
          meta: null
        });
      }


      const meta =
        makeMeta(row);


      console.log(
        "META:",
        meta.id,
        "poster:",
        meta.poster || null,
        "background:",
        meta.background || null,
        "cast:",
        meta.cast?.length || 0
      );


      res.json({
        meta
      });

    } catch (error) {
      console.error(
        "Meta error:",
        error
      );

      res.status(500).json({
        meta: null,
        error: "Meta error"
      });
    }
  }
);


/* =========================================================
   POSTER PROXY
   ========================================================= */

app.get(
  "/poster/:id",
  async (req, res) => {
    try {
      const id =
        Number(
          decodeId(req.params.id)
        );

      const row =
        getMediaById(id);


      if (!row) {
        return res.status(404).end();
      }


      if (!row.tpdb_poster) {
        return res.status(404).end();
      }


      const response =
        await fetch(
          row.tpdb_poster,
          {
            headers: {
              "User-Agent":
                "Happy-Telegram-Addon/1.0"
            }
          }
        );


      if (!response.ok) {
        console.error(
          "Poster fetch failed:",
          response.status,
          row.tpdb_poster
        );

        return res
          .status(response.status)
          .end();
      }


      const contentType =
        response.headers.get(
          "content-type"
        ) ||
        "image/jpeg";


      const buffer =
        Buffer.from(
          await response.arrayBuffer()
        );


      res.setHeader(
        "Content-Type",
        contentType
      );

      res.setHeader(
        "Content-Length",
        buffer.length
      );

      res.setHeader(
        "Cache-Control",
        "public, max-age=86400"
      );

      res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
      );

      res.end(buffer);

    } catch (error) {
      console.error(
        "Poster proxy error:",
        error
      );

      res.status(500).end();
    }
  }
);


/* =========================================================
   BACKGROUND PROXY
   ========================================================= */

app.get(
  "/background/:id",
  async (req, res) => {
    try {
      const id =
        Number(
          decodeId(req.params.id)
        );

      const row =
        getMediaById(id);


      if (!row) {
        return res.status(404).end();
      }


      const imageUrl =
        row.tpdb_background ||
        row.tpdb_poster;


      if (!imageUrl) {
        return res.status(404).end();
      }


      const response =
        await fetch(
          imageUrl,
          {
            headers: {
              "User-Agent":
                "Happy-Telegram-Addon/1.0"
            }
          }
        );


      if (!response.ok) {
        return res
          .status(response.status)
          .end();
      }


      const contentType =
        response.headers.get(
          "content-type"
        ) ||
        "image/jpeg";


      const buffer =
        Buffer.from(
          await response.arrayBuffer()
        );


      res.setHeader(
        "Content-Type",
        contentType
      );

      res.setHeader(
        "Content-Length",
        buffer.length
      );

      res.setHeader(
        "Cache-Control",
        "public, max-age=86400"
      );

      res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
      );

      res.end(buffer);

    } catch (error) {
      console.error(
        "Background proxy error:",
        error
      );

      res.status(500).end();
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
      const rawId =
        decodeId(req.params.id);

      let id =
        rawId;

      if (id.startsWith("tg:")) {
        id = id.slice(3);
      }


      const row =
        getMediaById(
          Number(id)
        );


      if (!row) {
        return res.json({
          streams: []
        });
      }


      const title =
        cleanText(
          row.tpdb_title
        ) ||
        cleanText(
          row.title
        ) ||
        cleanText(
          row.filename
        ) ||
        "Telegram Video";


      const streamUrl =
        `${BASE_URL}/file/${row.message_id}`;


      const stream = {
        name: "Happy Telegram",

        title,

        url: streamUrl,

        behaviorHints: {
          notWebReady: true,

          bingeGroup:
            "happy-telegram",

          videoSize:
            safeNumber(
              row.size,
              undefined
            )
        }
      };


      res.json({
        streams: [
          stream
        ]
      });

    } catch (error) {
      console.error(
        "Stream error:",
        error
      );

      res.status(500).json({
        streams: []
      });
    }
  }
);


/* =========================================================
   TELEGRAM FILE STREAM
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
        !Number.isFinite(
          messageId
        )
      ) {
        return res.status(400).end();
      }


      const row =
        getMediaByMessageId(
          messageId
        );


      if (!row) {
        return res.status(404).end();
      }


      const totalSize =
        safeNumber(
          row.size,
          0
        );


      if (
        !totalSize ||
        totalSize <= 0
      ) {
        return res.status(416).end();
      }


      const range =
        req.headers.range;


      let start = 0;
      let end =
        totalSize - 1;


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
              `bytes */${totalSize}`
            )
            .end();
        }


        if (match[1]) {
          start =
            Number(
              match[1]
            );
        }


        if (match[2]) {
          end =
            Number(
              match[2]
            );
        } else {
          end =
            totalSize - 1;
        }


        if (
          start < 0 ||
          start >= totalSize ||
          end < start
        ) {
          return res
            .status(416)
            .set(
              "Content-Range",
              `bytes */${totalSize}`
            )
            .end();
        }


        if (
          end >= totalSize
        ) {
          end =
            totalSize - 1;
        }
      }


      const contentLength =
        end - start + 1;


      const mime =
        row.mime ||
        "video/mp4";


      res.setHeader(
        "Content-Type",
        mime
      );

      res.setHeader(
        "Accept-Ranges",
        "bytes"
      );

      res.setHeader(
        "Content-Length",
        contentLength
      );

      res.setHeader(
        "Cache-Control",
        "no-cache"
      );


      if (range) {
        res.status(206);

        res.setHeader(
          "Content-Range",
          `bytes ${start}-${end}/${totalSize}`
        );
      }


      /*
       * streamMessage() is responsible for fetching
       * aligned Telegram chunks.
       */
      const stream =
        await streamMessage(
          messageId,
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
        res.status(500).end();
      } else {
        res.destroy();
      }
    }
  }
);


/* =========================================================
   START SERVER
   ========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Happy Telegram addon running on port ${PORT}`
    );

    console.log(
      `Base URL: ${BASE_URL}`
    );
  }
);
