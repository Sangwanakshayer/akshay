import express from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";

import { getDb } from "./db.js";
import {
  getMessage,
  streamMessage
} from "./telegram.js";
import { indexTelegram } from "./indexer.js";

dotenv.config();


// ======================================================
// APP
// ======================================================

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
    return process.env
      .PUBLIC_BASE_URL
      .replace(/\/$/, "");
  }


  const forwardedProto =
    req.headers[
      "x-forwarded-proto"
    ];


  const protocol =
    forwardedProto ||
    req.protocol;


  return (
    `${protocol}://${req.get("host")}`
  );
}


// ======================================================
// JSON HELPER
// ======================================================

function parseJson(
  value,
  fallback = []
) {

  if (!value) {
    return fallback;
  }


  try {

    return JSON.parse(
      value
    );

  } catch {

    return fallback;
  }
}


// ======================================================
// SAFE STRING
// ======================================================

function safeString(
  value
) {

  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }


  return String(value).trim();
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


      const limit =
        100;


      let rows;


      // --------------------------------------------------
      // SEARCH
      // --------------------------------------------------

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

        // ------------------------------------------------
        // NORMAL CATALOG
        // ------------------------------------------------

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


      const meta =
        makeMeta(
          row,
          baseUrl
        );


      console.log(
        `Meta requested: ${row.id} | ${meta.name}`
      );


      res.json({
        meta
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




/* =========================================================
   POSTER PROXY
   ========================================================= */

app.get(
  "/poster/:id",
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isFinite(id)) {
        return res.status(400).end();
      }

      const row = db.prepare(`
        SELECT tpdb_poster
        FROM media
        WHERE id = ?
        LIMIT 1
      `).get(id);

      if (!row?.tpdb_poster) {
        return res.status(404).end();
      }

      const response = await fetch(row.tpdb_poster, {
        headers: {
          "User-Agent": "Happy-Telegram-Addon/1.0"
        }
      });

      if (!response.ok) {
        return res.status(response.status).end();
      }

      const contentType =
        response.headers.get("content-type") || "image/jpeg";

      const buffer =
        Buffer.from(await response.arrayBuffer());

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", buffer.length);
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
      console.error("Poster proxy error:", error);
      res.status(500).end();
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
// TELEGRAM FILE STREAM
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
            const chunk
            of iterator
          ) {

            if (
              !res.write(
                chunk
              )
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


      // --------------------------------------------------
      // Suffix range
      // --------------------------------------------------

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


      // --------------------------------------------------
      // Open-ended range
      // --------------------------------------------------

      if (
        start !== null &&
        end === null
      ) {

        end =
          fileSize - 1;
      }


      // --------------------------------------------------
      // Invalid range
      // --------------------------------------------------

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


      // --------------------------------------------------
      // Response headers
      // --------------------------------------------------

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
          const chunk
          of iterator
        ) {

          if (
            !res.write(
              chunk
            )
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
// PERFORMER NAME
// ======================================================

function getPerformerName(
  performer
) {

  if (
    typeof performer === "string"
  ) {
    return safeString(
      performer
    );
  }


  if (!performer) {
    return "";
  }


  return safeString(

    performer.name ||

    performer.display_name ||

    performer.displayName ||

    performer.title ||

    performer.full_name ||

    performer.fullName ||

    ""

  );
}


// ======================================================
// PERFORMER PHOTO
// ======================================================

function getPerformerPhoto(
  performer
) {

  if (
    !performer ||
    typeof performer === "string"
  ) {
    return null;
  }


  // ----------------------------------------------------
  // Direct fields
  // ----------------------------------------------------

  let photo =

    performer.photo ||

    performer.image ||

    performer.avatar ||

    performer.avatar_url ||

    performer.avatarUrl ||

    performer.image_url ||

    performer.imageUrl ||

    performer.profile_image ||

    performer.profileImage ||

    performer.thumbnail ||

    performer.poster ||

    null;


  // ----------------------------------------------------
  // Nested image object
  // ----------------------------------------------------

  if (
    photo &&
    typeof photo === "object"
  ) {

    photo =

      photo.url ||

      photo.src ||

      photo.href ||

      photo.image ||

      null;
  }


  // ----------------------------------------------------
  // Nested photo object
  // ----------------------------------------------------

  if (
    !photo &&
    performer.photo &&
    typeof performer.photo === "object"
  ) {

    photo =

      performer.photo.url ||

      performer.photo.src ||

      performer.photo.href ||

      null;
  }


  // ----------------------------------------------------
  // Nested image object
  // ----------------------------------------------------

  if (
    !photo &&
    performer.image &&
    typeof performer.image === "object"
  ) {

    photo =

      performer.image.url ||

      performer.image.src ||

      performer.image.href ||

      null;
  }


  if (!photo) {
    return null;
  }


  return safeString(
    photo
  );
}


// ======================================================
// PERFORMER CHARACTER
// ======================================================

function getPerformerCharacter(
  performer
) {

  if (
    !performer ||
    typeof performer === "string"
  ) {
    return "";
  }


  return safeString(

    performer.character ||

    performer.role ||

    performer.alias ||

    ""

  );
}


// ======================================================
// BUILD NUVIO CAST
// ======================================================
//
// Nuvio structured cast:
//
// app_extras: {
//   cast: [
//     {
//       name: "...",
//       character: "...",
//       photo: "..."
//     }
//   ]
// }
//
// This is supported by Nuvio's metadata pipeline.
// ------------------------------------------------------

function buildNuvioCast(
  performers
) {

  if (
    !Array.isArray(
      performers
    )
  ) {
    return [];
  }


  const result = [];


  for (
    const performer
    of performers
  ) {

    const name =
      getPerformerName(
        performer
      );


    if (!name) {
      continue;
    }


    const photo =
      getPerformerPhoto(
        performer
      );


    const character =
      getPerformerCharacter(
        performer
      );


    const actor = {
      name
    };


    if (character) {

      actor.character =
        character;
    }


    if (photo) {

      actor.photo =
        photo;
    }


    result.push(
      actor
    );
  }


  return result;
}


// ======================================================
// BUILD GENRES
// ======================================================

function buildGenres(
  tags
) {

  if (
    !Array.isArray(tags)
  ) {
    return [];
  }


  return tags

    .map(
      tag => {

        if (
          typeof tag === "string"
        ) {
          return tag.trim();
        }


        return safeString(

          tag?.name ||

          tag?.title ||

          tag?.label ||

          ""

        );
      }
    )

    .filter(Boolean)

    // Remove duplicates

    .filter(
      (value, index, array) =>
        array.indexOf(value) ===
        index
    );
}


// ======================================================
// BUILD ACTOR LINKS
// ======================================================

function buildActorLinks(
  cast
) {

  if (
    !Array.isArray(cast)
  ) {
    return [];
  }


  return cast
    .map(
      actor => ({

        name:
          actor.name,

        category:
          "actor",

        // Internal Nuvio/Stremio
        // metadata link.
        //
        // Keep this as a search-style
        // URL rather than inventing an
        // external actor page.

        url:
          `https://www.google.com/search?q=${encodeURIComponent(actor.name)}`

      })
    );
}


// ======================================================
// MAKE META
// ======================================================

function makeMeta(
  row,
  baseUrl
) {

  // ----------------------------------------------------
  // TPDB performers
  // ----------------------------------------------------

  const performers =
    parseJson(
      row.tpdb_performers,
      []
    );


  // ----------------------------------------------------
  // TPDB tags
  // ----------------------------------------------------

  const tags =
    parseJson(
      row.tpdb_tags,
      []
    );


  // ----------------------------------------------------
  // Cast
  // ----------------------------------------------------

  const cast =
    buildNuvioCast(
      performers
    );


  // ----------------------------------------------------
  // Standard Stremio cast
  //
  // Standard cast is an array of
  // names, not objects.
  // ----------------------------------------------------

  const simpleCast =
    cast.map(
      actor =>
        actor.name
    );


  // ----------------------------------------------------
  // Genres
  // ----------------------------------------------------

  const genres =
    buildGenres(
      tags
    );


  // ----------------------------------------------------
  // Type
  // ----------------------------------------------------

  const type =
    row.type === "series"
      ? "series"
      : "movie";


  // ----------------------------------------------------
  // Display title
  // ----------------------------------------------------

  const displayTitle =

    row.tpdb_title ||

    row.title ||

    row.filename ||

    `Telegram ${row.message_id}`;


  // ----------------------------------------------------
  // Description
  // ----------------------------------------------------

  const description =

    row.tpdb_description ||

    row.caption ||

    row.filename ||

    "";


  // ----------------------------------------------------
  // Year
  // ----------------------------------------------------

  const year =

    row.tpdb_year ||

    row.year ||

    undefined;


  // ----------------------------------------------------
  // Studio
  // ----------------------------------------------------

  const studio =
    safeString(
      row.tpdb_studio
    );


  // ----------------------------------------------------
  // Stream URL
  // ----------------------------------------------------

  const fileUrl =
    `${baseUrl}/file/${row.message_id}`;


  // ----------------------------------------------------
  // Base meta
  // ----------------------------------------------------

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


    // Standard Stremio format

    cast:
      simpleCast.length
        ? simpleCast
        : undefined,


    links:
      buildActorLinks(
        cast
      ),


    behaviorHints: {

      defaultVideoId:
        `tg:${row.id}`,

      adult:
        true

    },


    streams: [

      {

        name:
          displayTitle,

        title:
          row.filename ||
          displayTitle,

        url:
          fileUrl,

        behaviorHints: {

          notWebReady:
            true

        }

      }

    ]

  };


  // ====================================================
  // NUVIO EXTENDED CAST
  // ====================================================

  if (
    cast.length ||
    studio
  ) {

    meta.app_extras = {

      ...(cast.length
        ? {
            cast
          }
        : {}),


      ...(studio
        ? {
            studio
          }
        : {})

    };
  }


  // ====================================================
  // POSTER
  // ====================================================

  if (
    row.tpdb_poster
  ) {

    const posterUrl =
      `${baseUrl}/poster/${row.id}`;

    meta.poster =
      posterUrl;

    meta.posterShape =
      "poster";

    // Explicit artwork fields for catalog + detail views
    meta.banner =
      posterUrl;

    meta.background =
      meta.background ||
      posterUrl;

    meta.app_extras = {
      ...(meta.app_extras || {}),
      poster: posterUrl,
      background: meta.background,
      banner: posterUrl
    };
  }


  // ====================================================
  // BACKGROUND
  // ====================================================

  if (
    row.tpdb_background
  ) {

    const rawBackground =
      typeof row.tpdb_background === "string"
        ? row.tpdb_background.trim()
        : "";

    const validBackground =
      /^https?:\\/\\//i.test(rawBackground) &&
      rawBackground !== "[object Object]";

    meta.background =
      validBackground
        ? rawBackground
        : `${baseUrl}/poster/${row.id}`;
  }


  // ====================================================
  // STUDIO LINK
  // ====================================================

  if (studio) {

    meta.links.push({

      name:
        studio,

      category:
        "studio",

      url:
        `https://www.google.com/search?q=${encodeURIComponent(studio)}`

    });
  }


  // ====================================================
  // RELEASE DATE
  // ====================================================

  if (
    row.tpdb_year
  ) {

    meta.released =
      `${row.tpdb_year}-01-01T00:00:00.000Z`;
  }


  // ====================================================
  // DEBUG LOG
  // ====================================================

  console.log(
    [
      `Meta: ${row.id}`,

      `title="${displayTitle}"`,

      `poster=${row.tpdb_poster ? "yes" : "no"}`,

      `background=${row.tpdb_background ? "yes" : "no"}`,

      `cast=${cast.length}`,

      `genres=${genres.length}`,

      `studio=${studio || "none"}`
    ].join(" | ")
  );


  // ----------------------------------------------------
  // Remove undefined recursively
  // ----------------------------------------------------

  return JSON.parse(
    JSON.stringify(
      meta
    )
  );
}


// ======================================================
// INITIAL INDEX
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
