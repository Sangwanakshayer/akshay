import dotenv from "dotenv";

import {
  Api
} from "telegram";

import {
  getDb,
  getState,
  setState
} from "./db.js";

import {
  getClient,
  getChannel,
  iterateMessages
} from "./telegram.js";

import {
  searchTPDB
} from "./tpdb.js";

dotenv.config();

const db =
  getDb();


// ======================================================
// HELPERS
// ======================================================

function cleanText(
  value
) {
  if (!value) {
    return "";
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}


function getDocument(
  message
) {
  const media =
    message?.media;

  if (!media) {
    return null;
  }

  if (
    media instanceof
    Api.MessageMediaDocument
  ) {
    return media.document;
  }

  if (
    media.document
  ) {
    return media.document;
  }

  return null;
}


function getFilename(
  document,
  message
) {
  const attributes =
    document?.attributes || [];

  for (
    const attribute
    of attributes
  ) {
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


function getVideoInfo(
  document
) {
  const attributes =
    document?.attributes || [];

  let width = null;
  let height = null;
  let duration = null;

  for (
    const attribute
    of attributes
  ) {
    if (
      attribute instanceof
      Api.DocumentAttributeVideo
    ) {
      width =
        Number(
          attribute.w || 0
        ) || null;

      height =
        Number(
          attribute.h || 0
        ) || null;

      duration =
        Number(
          attribute.duration || 0
        ) || null;

      break;
    }
  }

  return {
    width,
    height,
    duration
  };
}


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


function cleanTitle(
  filename,
  caption
) {
  let title =
    filename ||
    caption ||
    "Untitled";

  title =
    title
      .replace(
        /\.(mkv|mp4|avi|mov|webm|ts|m4v)$/i,
        ""
      );

  title =
    title.replace(
      /[._]+/g,
      " "
    );

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

  title =
    title.replace(
      /\b(2160p|1080p|720p|480p|4K|8K)\b/gi,
      ""
    );

  title =
    title.replace(
      /\b(WEB[- ]?DL|WEB[- ]?Rip|Blu[- ]?Ray|BRRip|HDR|HEVC|H\.?265|H\.?264|x265|x264)\b/gi,
      ""
    );

  title =
    title.replace(
      /\b(10bit|8bit|5\.1|7\.1|AAC|AC3|DTS)\b/gi,
      ""
    );

  title =
    title.replace(
      /\s+/g,
      " "
    );

  return title.trim();
}


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


function getMime(
  document
) {
  return (
    document?.mimeType ||
    "application/octet-stream"
  );
}


function getCreatedAt(
  message
) {
  if (
    message?.date
  ) {
    try {
      return new Date(
        Number(message.date) *
          1000
      ).toISOString();
    } catch {}
  }

  return null;
}


// ======================================================
// TPDB
// ======================================================

async function getTPDBMetadata(
  filename,
  title,
  year,
  existingChecked
) {
  if (
    existingChecked
  ) {
    return null;
  }

  const searchName =
    filename ||
    title;

  try {
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
// UPSERT
// ======================================================

function saveMedia(
  data
) {
  const existing =
    db.prepare(`
      SELECT
        id,
        tpdb_checked
      FROM media
      WHERE message_id = ?
    `).get(
      data.messageId
    );

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
          tpdb_checked
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
          @tpdbChecked
        )
      `);

    insert.run(
      data
    );

    return;
  }


  const update =
    db.prepare(`
      UPDATE media
      SET
        title = @title,
        year = @year,
        type = @type,
        filename = @filename,
        mime = @mime,
        size = @size,
        width = @width,
        height = @height,
        caption = @caption,
        thumb = @thumb,
        created_at = @createdAt,
        indexed_at = @indexedAt,

        tpdb_id = COALESCE(
          @tpdbId,
          tpdb_id
        ),

        tpdb_title = COALESCE(
          @tpdbTitle,
          tpdb_title
        ),

        tpdb_description = COALESCE(
          @tpdbDescription,
          tpdb_description
        ),

        tpdb_poster = COALESCE(
          @tpdbPoster,
          tpdb_poster
        ),

        tpdb_background = COALESCE(
          @tpdbBackground,
          tpdb_background
        ),

        tpdb_year = COALESCE(
          @tpdbYear,
          tpdb_year
        ),

        tpdb_studio = COALESCE(
          @tpdbStudio,
          tpdb_studio
        ),

        tpdb_performers = COALESCE(
          @tpdbPerformers,
          tpdb_performers
        ),

        tpdb_tags = COALESCE(
          @tpdbTags,
          tpdb_tags
        ),

        tpdb_type = COALESCE(
          @tpdbType,
          tpdb_type
        ),

        tpdb_checked =
          CASE
            WHEN @tpdbChecked = 1
            THEN 1
            ELSE tpdb_checked
          END

      WHERE message_id =
        @messageId
    `);

  update.run(
    data
  );
}


// ======================================================
// THUMBNAIL INFO
// ======================================================

function getThumbInfo(
  document
) {
  const thumbs =
    document?.thumbs || [];

  if (
    !thumbs.length
  ) {
    return null;
  }

  const thumb =
    thumbs[
      thumbs.length - 1
    ];

  return {
    type:
      thumb?.type ||
      null,

    width:
      Number(
        thumb?.w || 0
      ) || null,

    height:
      Number(
        thumb?.h || 0
      ) || null
  };
}


// ======================================================
// INDEX ONE MESSAGE
// ======================================================

export async function indexSingleMessage(
  message
) {
  if (!message) {
    return null;
  }

  const messageId =
    Number(
      message.id
    );

  if (!messageId) {
    return null;
  }

  const document =
    getDocument(
      message
    );

  if (!document) {
    return null;
  }

  const filename =
    cleanText(
      getFilename(
        document,
        message
      )
    );

  const caption =
    cleanText(
      message.message ||
      ""
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

  const existing =
    db.prepare(`
      SELECT
        tpdb_checked
      FROM media
      WHERE message_id = ?
    `).get(
      messageId
    );

  let tpdb = null;

  if (
    !existing ||
    Number(
      existing.tpdb_checked
    ) !== 1
  ) {
    console.log(
      `Searching TPDB for: ${filename}`
    );

    tpdb =
      await getTPDBMetadata(
        filename,
        title,
        year,
        false
      );
  }

  const indexedAt =
    new Date().toISOString();

  const tpdbChecked =
    1;

  const data = {
    messageId,

    title,

    year,

    type,

    filename,

    mime:
      getMime(
        document
      ),

    size:
      Number(
        document.size || 0
      ),

    width:
      video.width ||
      thumb?.width ||
      null,

    height:
      video.height ||
      thumb?.height ||
      null,

    caption,

    thumb:
      thumb
        ? JSON.stringify(
            thumb
          )
        : null,

    createdAt:
      getCreatedAt(
        message
      ),

    indexedAt,

    tpdbId:
      tpdb?.tpdbId ||
      null,

    tpdbTitle:
      tpdb?.title ||
      null,

    tpdbDescription:
      tpdb?.description ||
      null,

    tpdbPoster:
      tpdb?.poster ||
      null,

    tpdbBackground:
      tpdb?.background ||
      null,

    tpdbYear:
      tpdb?.year ||
      null,

    tpdbStudio:
      tpdb?.studio ||
      null,

    tpdbPerformers:
      tpdb
        ? JSON.stringify(
            tpdb.performers ||
            []
          )
        : null,

    tpdbTags:
      tpdb
        ? JSON.stringify(
            tpdb.tags ||
            []
          )
        : null,

    tpdbType:
      tpdb?.tpdbType ||
      null,

    tpdbChecked
  };


  saveMedia(
    data
  );


  console.log(
    [
      `Indexed ${messageId}`,
      `title="${title}"`,
      `type=${type}`,
      episode
        ? `S${String(
            episode.season
          ).padStart(2, "0")}E${String(
            episode.episode
          ).padStart(2, "0")}`
        : "",
      tpdb
        ? `TPDB="${tpdb.title}"`
        : "TPDB=no-match"
    ]
      .filter(Boolean)
      .join(" | ")
  );


  return data;
}


// ======================================================
// FULL TELEGRAM INDEX
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
    `Mode: ${
      firstRun
        ? "FIRST RUN"
        : "INCREMENTAL"
    }`
  );

  console.log(
    "======================================"
  );


  const messages =
    await iterateMessages(
      limit,
      lastMessageId
    );


  if (
    !messages.length
  ) {
    console.log(
      "No new Telegram media found."
    );

    return;
  }


  let highestMessageId =
    lastMessageId;


  // Telegram iterator is normally
  // newest -> oldest, so process
  // oldest -> newest.

  messages.sort(
    (
      a,
      b
    ) =>
      Number(a.id) -
      Number(b.id)
  );


  for (
    const message
    of messages
  ) {
    try {
      const messageId =
        Number(
          message.id
        );

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

    } catch (error) {
      console.error(
        `Failed indexing message ${message?.id}:`,
        error
      );
    }
  }


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
    `Telegram indexing completed. Processed ${messages.length} messages.`
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
