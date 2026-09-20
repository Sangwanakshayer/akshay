import dotenv from "dotenv";

dotenv.config();

const API_BASE =
  "https://api.theporndb.net";

const TOKEN =
  process.env.THEPORNDB_API_TOKEN || "";

function cleanText(value) {
  if (!value) return "";

  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(value) {
  return cleanText(value)
    .replace(
      /\.(mkv|mp4|avi|mov|webm)$/i,
      ""
    )
    .replace(/[._]+/g, " ")
    .replace(
      /\b(2160p|1080p|720p|480p|4k|8k)\b/gi,
      ""
    )
    .replace(
      /\b(WEB[- ]?DL|WEB[- ]?Rip|Blu[- ]?Ray|BRRip|HDR|HEVC|H265|H264|x265|x264)\b/gi,
      ""
    )
    .replace(
      /\bS\d{1,2}E\d{1,3}\b/gi,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function extractYear(text) {
  const match =
    String(text).match(
      /\b(19\d{2}|20\d{2})\b/
    );

  return match
    ? Number(match[1])
    : null;
}

function extractQuality(text) {
  const match =
    String(text).match(
      /\b(2160p|1080p|720p|480p|4K|8K)\b/i
    );

  return match
    ? match[1].toUpperCase()
    : null;
}

function extractEpisode(text) {
  let match =
    String(text).match(
      /\bS(\d{1,2})E(\d{1,3})\b/i
    );

  if (match) {
    return {
      season: Number(match[1]),
      episode: Number(match[2])
    };
  }

  match =
    String(text).match(
      /\b(\d{1,2})x(\d{1,3})\b/i
    );

  if (match) {
    return {
      season: Number(match[1]),
      episode: Number(match[2])
    };
  }

  return null;
}


// ======================================================
// TPDB REQUEST
// ======================================================

async function tpdbRequest(
  endpoint
) {
  if (!TOKEN) {
    console.log(
      "TPDB token not configured"
    );

    return null;
  }

  const response =
    await fetch(
      `${API_BASE}${endpoint}`,
      {
        method: "GET",

        headers: {
          Authorization:
            `Bearer ${TOKEN}`,

          Accept:
            "application/json",

          "User-Agent":
            "Happy-Telegram-Addon/1.0"
        }
      }
    );

  if (!response.ok) {
    const body =
      await response.text();

    console.error(
      `TPDB API ${response.status}:`,
      body.slice(0, 500)
    );

    return null;
  }

  return await response.json();
}


// ======================================================
// SEARCH
// ======================================================

export async function searchTPDB(
  filename,
  year = null
) {
  const original =
    cleanText(filename);

  const title =
    normalizeTitle(
      original
    );

  if (!title) {
    return null;
  }

  const detectedYear =
    year ||
    extractYear(original);

  const quality =
    extractQuality(
      original
    );

  const episode =
    extractEpisode(
      original
    );

  console.log(
    `TPDB search: "${title}"` +
    (
      detectedYear
        ? ` (${detectedYear})`
        : ""
    )
  );

  const params =
    new URLSearchParams();

  params.set(
    "q",
    title
  );

  if (detectedYear) {
    params.set(
      "year",
      String(
        detectedYear
      )
    );
  }

  let data =
    await tpdbRequest(
      `/scenes?${params.toString()}`
    );

  // Some API versions may return
  // an object containing scenes.
  const results =
    Array.isArray(data)
      ? data
      : (
          data?.data ||
          data?.scenes ||
          data?.results ||
          []
        );

  if (!results.length) {
    console.log(
      `TPDB: no match for "${title}"`
    );

    return null;
  }

  const result =
    results[0];

  return {
    tpdbId:
      result.id ||
      result._id ||
      result.uuid ||
      result.slug ||
      null,

    title:
      result.title ||
      title,

    description:
      result.description ||
      "",

    date:
      result.date ||
      result.release_date ||
      null,

    year:
      detectedYear ||
      (
        result.date
          ? Number(
              String(
                result.date
              ).slice(0, 4)
            )
          : null
      ),

    poster:
      result.poster ||
      result.image ||
      result.thumbnail ||
      null,

    background:
      result.background ||
      result.cover ||
      null,

    performers:
      result.performers ||
      result.actors ||
      [],

    studio:
      result.site ||
      result.studio ||
      result.paysite ||
      null,

    tags:
      result.tags ||
      [],

    quality,

    season:
      episode?.season ||
      null,

    episode:
      episode?.episode ||
      null,

    raw:
      result
  };
}


// ======================================================
// TEST
// ======================================================

export async function testTPDB() {
  if (!TOKEN) {
    return {
      ok: false,
      error:
        "THEPORNDB_API_TOKEN missing"
    };
  }

  const result =
    await tpdbRequest(
      "/scenes?per_page=1"
    );

  return {
    ok:
      result !== null
  };
}
