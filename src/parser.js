const QUALITY_RE = /\b(2160p|4k|1080p|720p|576p|480p)\b/i;
const YEAR_RE = /\b(19\d{2}|20\d{2})\b/;

export function parseMedia({ filename="", caption="" }) {
  const raw = (filename || caption || "").replace(/\.[a-z0-9]{2,5}$/i, "");
  const yearMatch = raw.match(YEAR_RE);
  const qualityMatch = raw.match(QUALITY_RE);

  let title = raw
    .replace(/[\[\(].*?[\]\)]/g, " ")
    .replace(/\b(2160p|4k|1080p|720p|576p|480p)\b/ig, " ")
    .replace(/\b(WEB[- .]?DL|WEBRIP|BLURAY|BDRIP|HDRIP|HEVC|H264|H265|X264|X265)\b/ig, " ")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!title) title = "Telegram Video";

  const type = /\b(s\d{1,2}e\d{1,2}|season\s*\d+|episode\s*\d+)\b/i.test(raw)
    ? "series" : "movie";

  return {
    title,
    year: yearMatch ? Number(yearMatch[1]) : null,
    quality: qualityMatch ? qualityMatch[1].toUpperCase() : null,
    type
  };
}