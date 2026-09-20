import dotenv from "dotenv";

dotenv.config();


// ======================================================
// CONFIG
// ======================================================

const API_BASE =
  "https://api.theporndb.net";

const TOKEN =
  process.env.THEPORNDB_API_TOKEN || "";


// ======================================================
// BASIC TEXT CLEANING
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
// NORMALIZE TITLE
// ======================================================

export function normalizeTitle(value) {
  let text =
    String(value || "");


  // ----------------------------------------------------
  // Remove file extension
  // ----------------------------------------------------

  text =
    text.replace(
      /\.(mkv|mp4|avi|mov|webm|m4v|ts)$/i,
      ""
    );


  // ----------------------------------------------------
  // Convert separators to spaces
  // ----------------------------------------------------

  text =
    text.replace(
      /[._]+/g,
      " "
    );

  text =
    text.replace(
      /[-]+/g,
      " "
    );


  // ----------------------------------------------------
  // Remove commas
  // ----------------------------------------------------

  text =
    text.replace(
      /,/g,
      " "
    );


  // ----------------------------------------------------
  // Remove dates
  //
  // 16 08 17
  // 16-08-17
  // 16_08_17
  // 16/08/17
  // 16 08 2017
  // 2017 08 16
  // 2017-08-16
  // ----------------------------------------------------

  text =
    text.replace(
      /\b\d{1,2}\s+\d{1,2}\s+\d{2,4}\b/g,
      " "
    );

  text =
    text.replace(
      /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g,
      " "
    );

  text =
    text.replace(
      /\b\d{4}\s+\d{1,2}\s+\d{1,2}\b/g,
      " "
    );

  text =
    text.replace(
      /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g,
      " "
    );


  // ----------------------------------------------------
  // Season / Episode
  // ----------------------------------------------------

  text =
    text.replace(
      /\bS\d{1,2}E\d{1,3}\b/gi,
      " "
    );

  text =
    text.replace(
      /\b\d{1,2}x\d{1,3}\b/gi,
      " "
    );


  // ----------------------------------------------------
  // Resolution
  // ----------------------------------------------------

  text =
    text.replace(
      /\b2160p\b/gi,
      " "
    );

  text =
    text.replace(
      /\b1080p\b/gi,
      " "
    );

  text =
    text.replace(
      /\b720p\b/gi,
      " "
    );

  text =
    text.replace(
      /\b576p\b/gi,
      " "
    );

  text =
    text.replace(
      /\b480p\b/gi,
      " "
    );

  text =
    text.replace(
      /\b4K\b/gi,
      " "
    );

  text =
    text.replace(
      /\b8K\b/gi,
      " "
    );


  // ----------------------------------------------------
  // Video source
  // ----------------------------------------------------

  text =
    text.replace(
      /\bWEB[- ]?DL\b/gi,
      " "
    );

  text =
    text.replace(
      /\bWEB[- ]?Rip\b/gi,
      " "
    );

  text =
    text.replace(
      /\bWEBRip\b/gi,
      " "
    );

  text =
    text.replace(
      /\bWEB\b/gi,
      " "
    );

  text =
    text.replace(
      /\bBlu[- ]?Ray\b/gi,
      " "
    );

  text =
    text.replace(
      /\bBluRay\b/gi,
      " "
    );

  text =
    text.replace(
      /\bBRRip\b/gi,
      " "
    );


  // ----------------------------------------------------
  // HDR / codecs
  // ----------------------------------------------------

  text =
    text.replace(
      /\bHDR10\b/gi,
      " "
    );

  text =
    text.replace(
      /\bHDR\b/gi,
      " "
    );

  text =
    text.replace(
      /\bHEVC\b/gi,
      " "
    );

  text =
    text.replace(
      /\bH\.?265\b/gi,
      " "
    );

  text =
    text.replace(
      /\bH\.?264\b/gi,
      " "
    );

  text =
    text.replace(
      /\bx265\b/gi,
      " "
    );

  text =
    text.replace(
      /\bx264\b/gi,
      " "
    );

  text =
    text.replace(
      /\bAV1\b/gi,
      " "
    );


  // ----------------------------------------------------
  // Bit depth
  // ----------------------------------------------------

  text =
    text.replace(
      /\b10bit\b/gi,
      " "
    );

  text =
    text.replace(
      /\b8bit\b/gi,
      " "
    );


  // ----------------------------------------------------
  // Audio tags
  // ----------------------------------------------------

  text =
    text.replace(
      /\b5\.1\b/g,
      " "
    );

  text =
    text.replace(
      /\b7\.1\b/g,
      " "
    );

  text =
    text.replace(
      /\bAAC\b/gi,
      " "
    );

  text =
    text.replace(
      /\bAC3\b/gi,
      " "
    );

  text =
    text.replace(
      /\bEAC3\b/gi,
      " "
    );

  text =
    text.replace(
      /\bDDP\b/gi,
      " "
    );

  text =
    text.replace(
      /\bDTS\b/gi,
      " "
    );

  text =
    text.replace(
      /\bDD\b/gi,
      " "
    );


  // ----------------------------------------------------
  // Generic release tags
  // ----------------------------------------------------

  text =
    text.replace(
      /\bXXX\b/gi,
      " "
    );

  text =
    text.replace(
      /\bPRT\b/gi,
      " "
    );

  text =
    text.replace(
      /\bRARBG\b/gi,
      " "
    );

  text =
    text.replace(
      /\bPROPER\b/gi,
      " "
    );

  text =
    text.replace(
      /\bREPACK\b/gi,
      " "
    );

  text =
    text.replace(
      /\bINTERNAL\b/gi,
      " "
    );


  // ----------------------------------------------------
  // Brackets
  // ----------------------------------------------------

  text =
    text.replace(
      /[\[\](){}]/g,
      " "
    );


  // ----------------------------------------------------
  // Remove duplicate spaces
  // ----------------------------------------------------

  text =
    text.replace(
      /\s+/g,
      " "
    );


  return text.trim();
}


// ======================================================
// BUILD SEARCH QUERIES
// ======================================================
//
// Example:
//
// SisLovesMe Penelope Woods Elias Cash Nudes And Anal
//
// becomes:
//
// 1. SisLovesMe Penelope Woods Elias Cash Nudes And Anal
// 2. SisLovesMe Nudes And Anal
// 3. SisLovesMe Cash Nudes And Anal
// 4. SisLovesMe Elias Cash Nudes And Anal
// 5. Nudes And Anal
//
// This helps when performer names prevent an exact
// TPDB scene search from matching.
//

export function buildSearchQueries(
  original
) {
  const normalized =
    normalizeTitle(
      original
    );


  if (!normalized) {
    return [];
  }


  const queries = [];


  // ----------------------------------------------------
  // Full normalized title
  // ----------------------------------------------------

  queries.push(
    normalized
  );


  const words =
    normalized
      .split(/\s+/)
      .filter(Boolean);


  // Need at least site + title words

  if (
    words.length >= 4
  ) {

    const site =
      words[0];


    const last3 =
      words
        .slice(-3)
        .join(" ");


    queries.push(
      `${site} ${last3}`
    );
  }


  // ----------------------------------------------------
  // Last 4 words
  // ----------------------------------------------------

  if (
    words.length >= 5
  ) {

    const site =
      words[0];


    const last4 =
      words
        .slice(-4)
        .join(" ");


    queries.push(
      `${site} ${last4}`
    );
  }


  // ----------------------------------------------------
  // Last 5 words
  // ----------------------------------------------------

  if (
    words.length >= 6
  ) {

    const site =
      words[0];


    const last5 =
      words
        .slice(-5)
        .join(" ");


    queries.push(
      `${site} ${last5}`
    );
  }


  // ----------------------------------------------------
  // Last 6 words
  // ----------------------------------------------------

  if (
    words.length >= 7
  ) {

    const site =
      words[0];


    const last6 =
      words
        .slice(-6)
        .join(" ");


    queries.push(
      `${site} ${last6}`
    );
  }


  // ----------------------------------------------------
  // Title without site
  // ----------------------------------------------------

  if (
    words.length >= 3
  ) {

    queries.push(
      words
        .slice(-3)
        .join(" ")
    );
  }


  if (
    words.length >= 4
  ) {

    queries.push(
      words
        .slice(-4)
        .join(" ")
    );
  }


  // ----------------------------------------------------
  // Remove duplicate queries
  // ----------------------------------------------------

  return [
    ...new Set(
      queries
        .map(
          query =>
            query.trim()
        )
        .filter(Boolean)
    )
  ];
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
// QUALITY
// ======================================================

function extractQuality(
  text
) {
  const match =
    String(text).match(
      /\b(2160p|1080p|720p|576p|480p|4K|8K)\b/i
    );


  return match
    ? match[1].toUpperCase()
    : null;
}


// ======================================================
// TPDB API REQUEST
// ======================================================

async function tpdbRequest(
  endpoint
) {

  if (!TOKEN) {

    console.log(
      "TPDB: THEPORNDB_API_TOKEN is not configured"
    );

    return null;
  }


  try {

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
        `TPDB API ${response.status}: ${body.slice(0, 500)}`
      );


      return null;
    }


    return await response.json();

  } catch (error) {

    console.error(
      "TPDB network error:",
      error.message
    );


    return null;
  }
}


// ======================================================
// EXTRACT RESULTS
// ======================================================

function extractResults(
  data
) {

  if (!data) {
    return [];
  }


  if (
    Array.isArray(data)
  ) {
    return data;
  }


  if (
    Array.isArray(data.data)
  ) {
    return data.data;
  }


  if (
    Array.isArray(data.scenes)
  ) {
    return data.scenes;
  }


  if (
    Array.isArray(data.movies)
  ) {
    return data.movies;
  }


  if (
    Array.isArray(data.jav)
  ) {
    return data.jav;
  }


  if (
    Array.isArray(data.results)
  ) {
    return data.results;
  }


  return [];
}


// ======================================================
// TPDB RESULT NORMALIZATION
// ======================================================

function normalizeTPDBResult(
  result,
  searchTitle,
  year,
  quality,
  episode,
  endpoint
) {

  if (!result) {
    return null;
  }


  const performers =
    result.performers ||
    result.actors ||
    [];


  const tags =
    result.tags ||
    [];


  // ----------------------------------------------------
  // Year
  // ----------------------------------------------------

  let resultYear =
    year;


  if (
    !resultYear &&
    result.date
  ) {

    const match =
      String(
        result.date
      ).match(
        /\b(19\d{2}|20\d{2})\b/
      );


    if (match) {
      resultYear =
        Number(
          match[1]
        );
    }
  }


  // ----------------------------------------------------
  // Studio / Site
  // ----------------------------------------------------

  let studio =
    null;


  if (
    result.site &&
    typeof result.site === "object"
  ) {

    studio =
      result.site.name ||
      result.site.title ||
      null;

  } else if (
    result.site
  ) {

    studio =
      result.site;

  } else if (
    result.studio &&
    typeof result.studio === "object"
  ) {

    studio =
      result.studio.name ||
      result.studio.title ||
      null;

  } else {

    studio =
      result.studio ||
      result.paysite ||
      null;
  }


  // ----------------------------------------------------
  // Return normalized metadata
  // ----------------------------------------------------

  return {

    tpdbId:
      result.id ||
      result.uuid ||
      result._id ||
      result.slug ||
      null,


    title:
      result.title ||
      result.name ||
      searchTitle,


    description:
      result.description ||
      result.synopsis ||
      "",


    date:
      result.date ||
      result.release_date ||
      null,


    year:
      resultYear ||
      null,


    poster:
      result.poster ||
      result.image ||
      result.thumbnail ||
      result.cover ||
      null,


    background:
      result.background ||
      result.cover ||
      result.poster ||
      result.image ||
      null,


    performers,


    studio,


    tags,


    quality:
      quality ||
      null,


    season:
      episode?.season ||
      null,


    episode:
      episode?.episode ||
      null,


    tpdbType:
      endpoint,


    slug:
      result.slug ||
      null,


    raw:
      result
  };
}


// ======================================================
// SEARCH ONE TPDB ENDPOINT
// ======================================================

async function searchEndpoint(
  endpoint,
  title,
  year
) {

  const params =
    new URLSearchParams();


  // IMPORTANT:
  // TPDB uses parse for filename/title parsing.

  params.set(
    "parse",
    title
  );


  params.set(
    "limit",
    "25"
  );


  if (year) {

    params.set(
      "year",
      String(year)
    );
  }


  const url =
    `/${endpoint}?${params.toString()}`;


  console.log(
    `TPDB request: ${url}`
  );


  const data =
    await tpdbRequest(
      url
    );


  const results =
    extractResults(
      data
    );


  console.log(
    `TPDB ${endpoint}: ${results.length} result(s)`
  );


  return results;
}


// ======================================================
// SEARCH TPDB
// ======================================================

export async function searchTPDB(
  filename,
  year = null
) {

  const original =
    cleanText(
      filename
    );


  if (!original) {
    return null;
  }


  const normalized =
    normalizeTitle(
      original
    );


  if (!normalized) {
    return null;
  }


  const detectedYear =
    year ||
    extractYear(
      original
    );


  const quality =
    extractQuality(
      original
    );


  const episode =
    extractEpisode(
      original
    );


  const queries =
    buildSearchQueries(
      original
    );


  console.log(
    "======================================"
  );


  console.log(
    `TPDB original: ${original}`
  );


  console.log(
    `TPDB normalized: ${normalized}`
  );


  console.log(
    `TPDB year: ${detectedYear || "none"}`
  );


  console.log(
    `TPDB queries: ${queries.join(" | ")}`
  );


  console.log(
    "======================================"
  );


  // ====================================================
  // TRY EACH SEARCH QUERY
  // ====================================================

  for (
    const query
    of queries
  ) {

    console.log(
      `TPDB trying query: "${query}"`
    );


    // --------------------------------------------------
    // 1. SCENES
    // --------------------------------------------------

    let results =
      await searchEndpoint(
        "scenes",
        query,
        detectedYear
      );


    if (
      results.length
    ) {

      console.log(
        `TPDB MATCH: scenes -> "${query}"`
      );


      return normalizeTPDBResult(
        results[0],
        query,
        detectedYear,
        quality,
        episode,
        "scenes"
      );
    }


    // --------------------------------------------------
    // 2. MOVIES
    // --------------------------------------------------

    results =
      await searchEndpoint(
        "movies",
        query,
        detectedYear
      );


    if (
      results.length
    ) {

      console.log(
        `TPDB MATCH: movies -> "${query}"`
      );


      return normalizeTPDBResult(
        results[0],
        query,
        detectedYear,
        quality,
        episode,
        "movies"
      );
    }


    // --------------------------------------------------
    // 3. JAV
    // --------------------------------------------------

    results =
      await searchEndpoint(
        "jav",
        query,
        detectedYear
      );


    if (
      results.length
    ) {

      console.log(
        `TPDB MATCH: jav -> "${query}"`
      );


      return normalizeTPDBResult(
        results[0],
        query,
        detectedYear,
        quality,
        episode,
        "jav"
      );
    }
  }


  // ====================================================
  // NO MATCH
  // ====================================================

  console.log(
    `TPDB: no match for "${normalized}"`
  );


  return null;
}


// ======================================================
// TPDB CONNECTION TEST
// ======================================================

export async function testTPDB() {

  if (!TOKEN) {

    return {
      ok: false,

      error:
        "THEPORNDB_API_TOKEN is missing"
    };
  }


  const result =
    await tpdbRequest(
      "/scenes?limit=1"
    );


  return {
    ok:
      result !== null
  };
}


// ======================================================
// NORMALIZATION TEST
// ======================================================

export function testNormalization() {

  const tests = [

    "Vixen 16 08 17 Kylie Page Behind Her Back",

    "Vixen_16_12_21_Keisha_Grey_Almost_Caught_XXX_1080p_HEVC_x265_PRT",

    "Vixen.2021.12.16.Keisha.Grey.Almost.Caught.1080p.HEVC.x265.PRT.mkv",

    "Vixen_1080p_HEVC_x265_Kylie_Page_Behind_Her_Back.mkv",

    "SisLovesMe_2024_10_04_Penelope_Woods,_Elias_Cash_Nudes_And_Anal.mkv"

  ];


  return tests.map(
    input => ({

      input,

      normalized:
        normalizeTitle(
          input
        ),

      queries:
        buildSearchQueries(
          input
        )

    })
  );
}
