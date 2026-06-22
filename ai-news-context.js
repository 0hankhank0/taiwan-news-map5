const {
  getCityFallback,
  isCoordInCity,
  isValidTaiwanCoord,
  normalizeCity,
  normalizeText,
} = require("./location-resolver");

const DEFAULT_AI_CONTEXT_LIMIT = 6;
const DEFAULT_ARTICLE_TIMEOUT_MS = 1200;
const ARTICLE_CONTEXT_MAX_CHARS = 1600;
const MIN_AI_LOCATION_CONFIDENCE = 0.55;

const CLEAN_CITY_COORDS = {
  "台北市": { lat: 25.033, lng: 121.5654 },
  "新北市": { lat: 25.0169, lng: 121.4628 },
  "基隆市": { lat: 25.1276, lng: 121.7392 },
  "桃園市": { lat: 24.9937, lng: 121.3009 },
  "新竹市": { lat: 24.8138, lng: 120.9675 },
  "新竹縣": { lat: 24.8387, lng: 121.0177 },
  "苗栗縣": { lat: 24.5602, lng: 120.8214 },
  "台中市": { lat: 24.1477, lng: 120.6736 },
  "彰化縣": { lat: 24.0817, lng: 120.5384 },
  "南投縣": { lat: 23.9609, lng: 120.9719 },
  "雲林縣": { lat: 23.7092, lng: 120.4313 },
  "嘉義市": { lat: 23.4801, lng: 120.4491 },
  "嘉義縣": { lat: 23.452, lng: 120.255 },
  "台南市": { lat: 22.9997, lng: 120.227 },
  "高雄市": { lat: 22.6273, lng: 120.3014 },
  "屏東縣": { lat: 22.5519, lng: 120.5488 },
  "宜蘭縣": { lat: 24.7021, lng: 121.7378 },
  "花蓮縣": { lat: 23.9872, lng: 121.6015 },
  "台東縣": { lat: 22.7583, lng: 121.1444 },
  "澎湖縣": { lat: 23.5712, lng: 119.5793 },
  "金門縣": { lat: 24.4321, lng: 118.3171 },
  "連江縣": { lat: 26.1602, lng: 119.9517 },
};

const CLEAN_CITY_BOUNDS = {
  "台北市": { minLat: 24.94, maxLat: 25.22, minLng: 121.43, maxLng: 121.68 },
  "新北市": { minLat: 24.65, maxLat: 25.32, minLng: 121.20, maxLng: 122.05 },
  "桃園市": { minLat: 24.55, maxLat: 25.14, minLng: 120.95, maxLng: 121.50 },
  "台中市": { minLat: 23.95, maxLat: 24.45, minLng: 120.45, maxLng: 121.45 },
  "台南市": { minLat: 22.85, maxLat: 23.45, minLng: 120.00, maxLng: 120.65 },
  "高雄市": { minLat: 22.45, maxLat: 23.50, minLng: 120.15, maxLng: 121.10 },
};

function normalizeCleanCity(value = "") {
  const raw = normalizeText(value).replace(/臺/g, "台");
  return Object.keys(CLEAN_CITY_COORDS).find((city) => raw.includes(city)) || "";
}

function getAiCityFallback(city) {
  return getCityFallback(city) || CLEAN_CITY_COORDS[normalizeCleanCity(city)] || null;
}

function isAiCoordInCity(city, lat, lng) {
  const cleanCity = normalizeCleanCity(city);
  const bounds = CLEAN_CITY_BOUNDS[cleanCity];
  if (!bounds) return isCoordInCity(city, lat, lng);
  return lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng;
}

function decodeHtmlEntities(value = "") {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCharCode(value) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const value = Number.parseInt(code, 16);
      return Number.isFinite(value) ? String.fromCharCode(value) : " ";
    });
}

function cleanArticleText(value = "") {
  return decodeHtmlEntities(value)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripHtmlToLines(html = "") {
  return cleanArticleText(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(?:nav|header|footer|aside)[\s\S]*?<\/(?:nav|header|footer|aside)>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h1|h2|h3)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function extractMetaDescription(html = "") {
  const source = String(html || "");
  const patterns = [
    /<meta[^>]+(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]*>/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return cleanArticleText(match[1]);
  }
  return "";
}

function isLikelyBoilerplate(line = "") {
  return /訂閱|登入|會員|廣告|推薦閱讀|相關新聞|熱門新聞|分享|facebook|line|instagram|cookie|版權|客服|下載App|APP下載/i.test(line);
}

function extractArticleContextFromHtml(html = "", options = {}) {
  const maxChars = Number(options.maxChars) || ARTICLE_CONTEXT_MAX_CHARS;
  const metaDescription = extractMetaDescription(html);
  const lines = stripHtmlToLines(html)
    .filter((line) => line.length >= 18)
    .filter((line) => !isLikelyBoilerplate(line));
  const body = lines.slice(0, 8).join("\n");
  return cleanArticleText([metaDescription, body].filter(Boolean).join("\n")).slice(0, maxChars);
}

function rssSnippetFromItem(item = "") {
  if (typeof item === "string") return cleanArticleText(item).slice(0, ARTICLE_CONTEXT_MAX_CHARS);
  return cleanArticleText([
    item.contentSnippet,
    item.content,
    item.summary,
    item.description,
  ].filter(Boolean).join("\n")).slice(0, ARTICLE_CONTEXT_MAX_CHARS);
}

function buildFallbackNewsContext(item = {}, options = {}) {
  const maxChars = Number(options.maxChars) || ARTICLE_CONTEXT_MAX_CHARS;
  return {
    title: cleanArticleText(item.title || ""),
    content: rssSnippetFromItem(item).slice(0, maxChars),
    link: String(item.link || item.url || "").trim(),
    contextSource: "rss",
  };
}

async function fetchNewsContext(item = {}, options = {}) {
  const maxChars = Number(options.maxChars) || ARTICLE_CONTEXT_MAX_CHARS;
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_ARTICLE_TIMEOUT_MS;
  const httpClient = options.axios;
  const fallback = buildFallbackNewsContext(item, { maxChars });
  const url = fallback.link;
  if (!httpClient || !/^https?:\/\//i.test(url)) return fallback;

  try {
    const response = await httpClient.get(url, {
      timeout: timeoutMs,
      responseType: "text",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const contentType = String(response.headers?.["content-type"] || "");
    if (contentType && !/html|text/i.test(contentType)) return fallback;
    const articleContext = extractArticleContextFromHtml(response.data, { maxChars });
    if (!articleContext || articleContext.length < Math.min(80, fallback.content.length || 80)) return fallback;
    return {
      ...fallback,
      content: articleContext,
      contextSource: "article",
    };
  } catch {
    return fallback;
  }
}

async function prepareNewsContexts(newsItems = [], options = {}) {
  const maxArticles = Number(options.maxArticles) || DEFAULT_AI_CONTEXT_LIMIT;
  const candidates = newsItems.slice(0, maxArticles);
  return Promise.all(candidates.map((item) => fetchNewsContext(item, options)));
}

function normalizePrecision(value) {
  const precision = String(value || "").trim().toLowerCase();
  return ["exact", "district", "city", "unknown"].includes(precision) ? precision : "unknown";
}

function normalizeAiExtractedEvents(events = []) {
  if (!Array.isArray(events)) return [];
  return events.map((item) => {
    const title = normalizeText(item.title || "");
    const content = normalizeText(item.content || "");
    const city = normalizeCleanCity(item.city || "") || normalizeCity(item.city || "");
    const locationText = normalizeText(item.locationText || item.location || item.address || "");
    const locationEvidence = normalizeText(item.locationEvidence || "");
    const confidence = Math.max(0, Math.min(1, Number(item.locationConfidence) || 0));
    let locationPrecision = normalizePrecision(item.locationPrecision);

    if (!title || !content || !city) return null;
    if (!locationEvidence || confidence < MIN_AI_LOCATION_CONFIDENCE) return null;
    if (!locationText && locationPrecision !== "city") return null;

    const fallback = getAiCityFallback(city);
    let lat = Number(item.lat);
    let lng = Number(item.lng);
    const invalidCoord = !isValidTaiwanCoord(lat, lng) || !isAiCoordInCity(city, lat, lng);
    if (locationPrecision === "city" || invalidCoord) {
      if (!fallback) return null;
      lat = fallback.lat;
      lng = fallback.lng;
      locationPrecision = "city";
    }

    return {
      ...item,
      title,
      content,
      city,
      lat,
      lng,
      location: locationText || city,
      address: locationText || "",
      locationQuery: locationText || city,
      locationPrecision,
      locationSource: "ai-context",
      locationEvidence,
      locationConfidence: confidence,
    };
  }).filter(Boolean);
}

module.exports = {
  ARTICLE_CONTEXT_MAX_CHARS,
  DEFAULT_AI_CONTEXT_LIMIT,
  DEFAULT_ARTICLE_TIMEOUT_MS,
  MIN_AI_LOCATION_CONFIDENCE,
  buildFallbackNewsContext,
  cleanArticleText,
  decodeHtmlEntities,
  extractArticleContextFromHtml,
  fetchNewsContext,
  normalizeAiExtractedEvents,
  prepareNewsContexts,
};
