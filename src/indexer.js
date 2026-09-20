import dotenv from "dotenv";
import { Api } from "telegram";

import {
  getDb,
  getState,
  setState
} from "./db.js";

import {
  getClient,
  iterateMessages
} from "./telegram.js";

import {
  searchTPDB
} from "./tpdb.js";


dotenv.config();

const db = getDb();


// ======================================================
// TPDB PARSER VERSION
// ======================================================
//
// Increase this number whenever TPDB normalization/search
// logic changes. Existing media will then be searched again.
//

const TPDB_PARSER_VERSION = 3;


// ======================================================
// TEXT HELPERS
// ======================================================

function cleanText(value) {
  if (!value) {
    return "";
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}


// ======================================================
// SQLITE SAFE VALUE
// ======================================================
//
// better-sqlite3 does NOT accept undefined.
// Convert undefined -> null.
//

function sqlValue(value) {
  if (value === undefined) {
    return null;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  return String(value);
}


// ======================================================
// DOCUMENT
// ======================================================

function getDocument(message) {
  const media = message?.media;

  if (!media) {
    return null;
  }

  if (
    media instanceof Api.MessageMediaDocument
  ) {
    return media.document;
  }

  if (media.document) {
    return media.document;
  }

  return null;
}


// ======================================================
// FILENAME
// ======================================================

function getFilename(
  document,
  message
) {
  const attributes =
    document?.attributes || [];


  for (const attribute of attributes) {

    if (
      attribute instanceof
      Api.DocumentAttributeFilename
    ) {
      return (
        attribute.fileName ||
        attribute.filename ||
        ""
      );
    }
  }


  return (
    message?.file?.name ||
    message?.media?.document?.fileName ||
    "Telegram Media"
  );
}


// ======================================================
// VIDEO INFORMATION
// ======================================================

function getVideoInfo(
  document
) {
  const attributes =
    document?.attributes || [];


  let width = null;
  let height = null;
  let duration = null;


  for (const attribute of attributes) {

    if (
      attribute instanceof
      Api.DocumentAttributeVideo
    ) {

      width =
        Number(attribute.w || 0) ||
        null;

      height =
        Number(attribute.h || 0) ||
        null;

      duration =
        Number(attribute.duration || 0) ||
        null;

      break;
    }
  }


  return {
    width,
    height,
    duration
  };
}


// ======================================================
// YEAR
// ======================================================

function extractYear(
  text
) {
  const match =
    String(text).match(
      /\b(19\d{2}|20\d{2})\b/
    );


  return match
    ? Number(match[1])
    : null;
}


// ======================================================
// EPISODE
// ======================================================

function extractEpisode(
  text
) {

  let match =
    String(text).match(
      /\bS(\d{1,2})E(\d{1,3})\b/i
    );


  if (match) {
    return {
      season:
        Number(match[1]),

      episode:
        Number(match[2])
    };
  }


  match =
    String(text).match(
      /\b(\d{1,2})x(\d{1,3})\b/i
    );


  if (match) {
    return {
      season:
        Number(match[1]),

      episode:
        Number(match[2])
    };
  }


  return null;
}


// ======================================================
// TITLE CLEANING
// ======================================================

function cleanTitle(
  filename,
  caption
) {

  let title =
    filename ||
    caption ||
    "Untitled";


  // File extension

  title =
    title.replace(
      /\.(mkv|mp4|avi|mov|webm|ts|m4v)$/i,
      ""
    );


  // Separators

  title =
    title.replace(
      /[._]+/g,
      " "
    );


  // Episode

  title =
    title.replace(
      /\bS\d{1,2}E\d{1,3}\b/gi,
      ""
    );


  title =
    title.replace(
      /\b\d{1,2}x\d{1,3}\b/gi,
      ""
    );


  // Resolution

  title =
    title.replace(
      /\b(2160p|1080p|720p|576p|480p|4K|8K)\b/gi,
      ""
    );


  // Video source / codecs

  title =
    title.replace(
      /\b(WEB[- ]?DL|WEB[- ]?Rip|WEBRip|WEB|Blu[- ]?Ray|BluRay|BRRip|HDR10|HDR|HEVC|H\.?265|H\.?264|x265|x264|AV1)\b/gi,
      ""
    );


  // Audio

  title =
    title.replace(
      /\b(10bit|8bit|5\.1|7\.1|AAC|AC3|DTS|DDP|EAC3|DD)\b/gi,
      ""
    );


  // Release tags

  title =
    title.replace(
      /\bXXX\b/gi,
      ""
    );


  title =
    title.replace(
      /\bPRT\b/gi,
      ""
    );


  // Brackets

  title =
    title.replace(
      /[\[\](){}]/g,
      " "
    );


  // Multiple spaces

  title =
    title.replace(
      /\s+/g,
      " "
    );


  return title.trim();
}


// ======================================================
// TYPE DETECTION
// ======================================================

function detectType(
  filename,
  caption
) {

  const text =
    `${filename || ""} ${caption || ""}`;


  if (
    /\bS\d{1,2}E\d{1,3}\b/i.test(text) ||
    /\b\d{1,2}x\d{1,3}\b/i.test(text) ||
    /\bseason\s*\d+\b/i.test(text) ||
    /\bepisode\s*\d+\b/i.test(text)
  ) {
    return "series";
  }


  return "movie";
}


// ======================================================
// MIME
// ======================================================

function getMime(
  document
) {
  return (
    document?.mimeType ||
    "application/octet-stream"
  );
}


// ======================================================
// CREATED DATE
// ======================================================

function getCreatedAt(
  message
) {

  if (message?.date) {

    try {

      return new Date(
        Number(message.date) * 1000
      ).toISOString();

    } catch {
      return null;
    }
  }


  return null;
}


// ======================================================
// TELEGRAM THUMBNAIL
// ======================================================

function getThumbInfo(
  document
) {

  const thumbs =
    document?.thumbs || [];


  if (!thumbs.length) {
    return null;
  }


  const thumb =
    thumbs[thumbs.length - 1];


  return {
    type:
      thumb?.type || null,

    width:
      Number(thumb?.w || 0) || null,

    height:
      Number(thumb?.h || 0) || null
  };
}


// ======================================================
// TPDB LOOKUP
// ======================================================

async function getTPDBMetadata(
  filename,
  title,
  year,
  existingChecked
) {

  // If this media was already checked with the
  // current parser version, don't search again.

  if (
    existingChecked
  ) {
    return null;
  }


  const searchName =
    filename ||
    title;


  try {

    console.log(
      `Searching TPDB for: ${searchName}`
    );


    const result =
      await searchTPDB(
        searchName,
        year
      );


    return result;

  } catch (error) {

    console.error(
      "TPDB lookup failed:",
      error.message
    );


    return null;
  }
}


// ======================================================
// SAVE MEDIA
// ======================================================

function saveMedia(
  data
) {

  // ----------------------------------------------------
  // Make every value SQLite-safe
  // ----------------------------------------------------

  const safeData = {

    messageId:
      sqlValue(data.messageId),

    title:
      sqlValue(data.title),

    year:
      sqlValue(data.year),

    type:
      sqlValue(data.type),

    filename:
      sqlValue(data.filename),

    mime:
      sqlValue(data.mime),

    size:
      sqlValue(data.size),

    width:
      sqlValue(data.width),

    height:
      sqlValue(data.height),

    caption:
      sqlValue(data.caption),

    thumb:
      sqlValue(data.thumb),

    createdAt:
      sqlValue(data.createdAt),

    indexedAt:
      sqlValue(data.indexedAt),


    tpdbId:
      sqlValue(data.tpdbId),

    tpdbTitle:
      sqlValue(data.tpdbTitle),

    tpdbDescription:
      sqlValue(data.tpdbDescription),

    tpdbPoster:
      sqlValue(data.tpdbPoster),

    tpdbBackground:
      sqlValue(data.tpdbBackground),

    tpdbYear:
      sqlValue(data.tpdbYear),

    tpdbStudio:
      sqlValue(data.tpdbStudio),

    tpdbPerformers:
      sqlValue(data.tpdbPerformers),

    tpdbTags:
      sqlValue(data.tpdbTags),

    tpdbType:
      sqlValue(data.tpdbType),

    tpdbChecked:
      sqlValue(data.tpdbChecked),

    tpdbParserVersion:
      sqlValue(data.tpdbParserVersion)
  };


  // ----------------------------------------------------
  // Existing record
  // ----------------------------------------------------

  const existing =
    db.prepare(`
      SELECT
        id,
        tpdb_checked,
        tpdb_parser_version
      FROM media
      WHERE message_id = ?
    `).get(
      safeData.messageId
    );


  // ====================================================
  // INSERT
  // ====================================================

  if (!existing) {

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
          thumb,
          created_at,
          indexed_at,

          tpdb_id,
          tpdb_title,
          tpdb_description,
          tpdb_poster,
          tpdb_background,
          tpdb_year,
          tpdb_studio,
          tpdb_performers,
          tpdb_tags,
          tpdb_type,
          tpdb_checked,
          tpdb_parser_version

        )

        VALUES (

          @messageId,
          @title,
          @year,
          @type,
          @filename,
          @mime,
          @size,
          @width,
          @height,
          @caption,
          @thumb,
          @createdAt,
          @indexedAt,

          @tpdbId,
          @tpdbTitle,
          @tpdbDescription,
          @tpdbPoster,
          @tpdbBackground,
          @tpdbYear,
          @tpdbStudio,
          @tpdbPerformers,
          @tpdbTags,
          @tpdbType,
          @tpdbChecked,
          @tpdbParserVersion

        )
      `);


    insert.run(
      safeData
    );


    return;
  }


  // ====================================================
  // UPDATE
  // ====================================================

  const update =
    db.prepare(`
      UPDATE media

      SET

        title =
          @title,

        year =
          @year,

        type =
          @type,

        filename =
          @filename,

        mime =
          @mime,

        size =
          @size,

        width =
          @width,

        height =
          @height,

        caption =
          @caption,

        thumb =
          @thumb,

        created_at =
          @createdAt,

        indexed_at =
          @indexedAt,


        tpdb_id =
          COALESCE(
            @tpdbId,
            tpdb_id
          ),


        tpdb_title =
          COALESCE(
            @tpdbTitle,
            tpdb_title
          ),


        tpdb_description =
          COALESCE(
            @tpdbDescription,
            tpdb_description
          ),


        tpdb_poster =
          COALESCE(
            @tpdbPoster,
            tpdb_poster
          ),


        tpdb_background =
          COALESCE(
            @tpdbBackground,
            tpdb_background
          ),


        tpdb_year =
          COALESCE(
            @tpdbYear,
            tpdb_year
          ),


        tpdb_studio =
          COALESCE(
            @tpdbStudio,
            tpdb_studio
          ),


        tpdb_performers =
          COALESCE(
            @tpdbPerformers,
            tpdb_performers
          ),


        tpdb_tags =
          COALESCE(
            @tpdbTags,
            tpdb_tags
          ),


        tpdb_type =
          COALESCE(
            @tpdbType,
            tpdb_type
          ),


        tpdb_checked =
          CASE

            WHEN @tpdbChecked = 1
            THEN 1

            ELSE tpdb_checked

          END,


        tpdb_parser_version =
          CASE

            WHEN @tpdbParserVersion IS NOT NULL
            THEN @tpdbParserVersion

            ELSE tpdb_parser_version

          END


      WHERE message_id =
        @messageId
    `);


  update.run(
    safeData
  );
}


// ======================================================
// INDEX ONE TELEGRAM MESSAGE
// ======================================================

export async function indexSingleMessage(
  message
) {

  if (!message) {
    return null;
  }


  const messageId =
    Number(message.id);


  if (!messageId) {
    return null;
  }


  const document =
    getDocument(message);


  if (!document) {
    return null;
  }


  // ----------------------------------------------------
  // Basic Telegram data
  // ----------------------------------------------------

  const filename =
    cleanText(
      getFilename(
        document,
        message
      )
    );


  const caption =
    cleanText(
      message.message || ""
    );


  const title =
    cleanTitle(
      filename,
      caption
    );


  const year =
    extractYear(
      `${filename} ${caption}`
    );


  const type =
    detectType(
      filename,
      caption
    );


  const episode =
    extractEpisode(
      `${filename} ${caption}`
    );


  const video =
    getVideoInfo(
      document
    );


  const thumb =
    getThumbInfo(
      document
    );


  // ----------------------------------------------------
  // Existing TPDB state
  // ----------------------------------------------------

  const existing =
    db.prepare(`
      SELECT
        tpdb_checked,
        tpdb_parser_version
      FROM media
      WHERE message_id = ?
    `).get(
      messageId
    );


  const existingParserVersion =
    Number(
      existing?.tpdb_parser_version || 0
    );


  const tpdbAlreadyChecked =
    Number(
      existing?.tpdb_checked || 0
    ) === 1
    &&
    existingParserVersion ===
      TPDB_PARSER_VERSION;


  // ----------------------------------------------------
  // TPDB
  // ----------------------------------------------------

  let tpdb = null;


  if (
    !tpdbAlreadyChecked
  ) {

    tpdb =
      await getTPDBMetadata(
        filename,
        title,
        year,
        false
      );

  } else {

    console.log(
      `TPDB already checked with parser v${TPDB_PARSER_VERSION}: ${messageId}`
    );

  }


  // ----------------------------------------------------
  // Prepare TPDB data
  // ----------------------------------------------------

  const tpdbId =
    tpdb?.tpdbId ??
    null;


  const tpdbTitle =
    tpdb?.title ??
    null;


  const tpdbDescription =
    tpdb?.description ??
    null;


  const tpdbPoster =
    tpdb?.poster ??
    null;


  const tpdbBackground =
    tpdb?.background ??
    null;


  const tpdbYear =
    tpdb?.year ??
    null;


  const tpdbStudio =
    tpdb?.studio ??
    null;


  const tpdbPerformers =
    tpdb
      ? JSON.stringify(
          tpdb.performers || []
        )
      : null;


  const tpdbTags =
    tpdb
      ? JSON.stringify(
          tpdb.tags || []
        )
      : null;


  const tpdbType =
    tpdb?.tpdbType ??
    null;


  // ----------------------------------------------------
  // Data
  // ----------------------------------------------------

  const data = {

    messageId:
      Number(messageId),


    title:
      title ||
      null,


    year:
      year ??
      null,


    type:
      type ||
      "movie",


    filename:
      filename ||
      null,


    mime:
      getMime(document) ||
      "application/octet-stream",


    size:
      Number(
        document.size || 0
      ),


    width:
      video.width ??
      thumb?.width ??
      null,


    height:
      video.height ??
      thumb?.height ??
      null,


    caption:
      caption ||
      null,


    thumb:
      thumb
        ? JSON.stringify(thumb)
        : null,


    createdAt:
      getCreatedAt(message) ??
      null,


    indexedAt:
      new Date().toISOString(),


    // TPDB

    tpdbId,

    tpdbTitle,

    tpdbDescription,

    tpdbPoster,

    tpdbBackground,

    tpdbYear,

    tpdbStudio,

    tpdbPerformers,

    tpdbTags,

    tpdbType,


    tpdbChecked:
      1,


    tpdbParserVersion:
      TPDB_PARSER_VERSION
  };


  // ----------------------------------------------------
  // Save
  // ----------------------------------------------------

  saveMedia(
    data
  );


  // ----------------------------------------------------
  // Log
  // ----------------------------------------------------

  console.log(
    [
      `Indexed ${messageId}`,

      `title="${title}"`,

      `type=${type}`,

      episode
        ? `S${String(episode.season).padStart(2, "0")}E${String(episode.episode).padStart(2, "0")}`
        : "",

      tpdb
        ? `TPDB="${tpdb.title}"`
        : "TPDB=no-match",

      tpdb
        ? `TPDB_ID="${tpdb.tpdbId || "none"}"`
        : "",

      `parser=v${TPDB_PARSER_VERSION}`
    ]
      .filter(Boolean)
      .join(" | ")
  );


  return data;
}


// ======================================================
// INDEX TELEGRAM
// ======================================================

export async function indexTelegram() {

  const lastMessageId =
    Number(
      getState(
        "last_message_id"
      ) || 0
    );


  const firstRun =
    !lastMessageId;


  const limit =
    firstRun
      ? 10000
      : 1000;


  console.log(
    "======================================"
  );

  console.log(
    "Telegram indexing started"
  );

  console.log(
    `Last message ID: ${lastMessageId}`
  );

  console.log(
    `Mode: ${firstRun ? "FIRST RUN" : "INCREMENTAL"}`
  );

  console.log(
    `TPDB parser version: ${TPDB_PARSER_VERSION}`
  );

  console.log(
    "======================================"
  );


  const messages =
    await iterateMessages(
      limit,
      lastMessageId
    );


  if (!messages.length) {

    console.log(
      "No new Telegram media found."
    );

    return;
  }


  let highestMessageId =
    lastMessageId;


  // Oldest -> newest

  messages.sort(
    (a, b) =>
      Number(a.id) -
      Number(b.id)
  );


  let processed = 0;
  let failed = 0;


  for (
    const message
    of messages
  ) {

    try {

      const messageId =
        Number(message.id);


      if (
        messageId >
        highestMessageId
      ) {
        highestMessageId =
          messageId;
      }


      await indexSingleMessage(
        message
      );


      processed++;


    } catch (error) {

      failed++;


      console.error(
        `Failed indexing message ${message?.id}:`,
        error
      );
    }
  }


  // ----------------------------------------------------
  // IMPORTANT
  // ----------------------------------------------------
  //
  // Only advance last_message_id after processing.
  //
  // Failed messages below the highest ID will not be
  // automatically retried by incremental indexing.
  //
  // Therefore we separately log failures.
  //

  if (
    highestMessageId >
    lastMessageId
  ) {

    setState(
      "last_message_id",
      highestMessageId
    );
  }


  console.log(
    "======================================"
  );

  console.log(
    `Telegram indexing completed. Processed ${processed} messages.`
  );

  console.log(
    `Failed: ${failed}`
  );

  console.log(
    `New last message ID: ${highestMessageId}`
  );

  console.log(
    "======================================"
  );
}


// ======================================================
// DIRECT EXECUTION
// ======================================================

const isDirectRun =
  process.argv[1] &&
  process.argv[1]
    .replace(/\\/g, "/")
    .endsWith(
      "/src/indexer.js"
    );


if (isDirectRun) {

  indexTelegram()

    .then(
      async () => {

        const client =
          await getClient();


        await client.disconnect();


        process.exit(0);
      }
    )

    .catch(
      error => {

        console.error(
          error
        );

        process.exit(1);
      }
    );
}
