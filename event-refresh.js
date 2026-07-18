const {
  getCachedEvents,
  getOfficialEvents,
  getCachedValue,
  setCachedEvents,
  setOfficialEvents,
  createEventCandidates,
  setCachedValue,
  setRefreshStatus,
  appendRefreshLog,
  cleanRefreshLogError,
  saveRefreshRunDetail,
  writeEventBuckets: writeEventBucketsToStore,
} = require("./event-store");
const {
  DEFAULT_AI_CONTEXT_LIMIT,
  DEFAULT_ARTICLE_TIMEOUT_MS,
  ARTICLE_CONTEXT_MAX_CHARS,
  normalizeAiExtractedEvents,
  prepareNewsContexts,
} = require("./ai-news-context");
const {
  buildLocationQuery,
  getCityBounds,
  inferCityFromText: inferTaiwanCityFromText,
  isCoordInCity,
  isValidTaiwanCoord,
  makeGeocodingCacheKey,
  normalizeCity,
  rankGeocodingCandidates,
  resolveLocationSync,
  withLocationQuality,
} = require("./location-resolver");
const { classifyEventVisibility, isLowRealtimeEvent } = require("./event-content-filter");
const { notifyRefreshAlert } = require("./refresh-alerts");

const Parser = require("rss-parser");
const os = require("os");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ?? ??????????????????????
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function buildRequestUrl(input, params = {}) {
  const url = new URL(String(input));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url;
}

async function fetchResponse(input, { method = "GET", headers, body, params, timeout = 2000 } = {}) {
  const response = await fetch(buildRequestUrl(input, params), {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(timeout),
  });
  if (response.ok) return response;
  let payload;
  let bodyText = "";
  try {
    bodyText = await response.text();
    try { payload = JSON.parse(bodyText); } catch { /* non-JSON error response */ }
  } catch { /* error diagnostics must never hide the original HTTP failure */ }
  const responseMessage = String(payload?.message || payload?.error || payload?.detail || bodyText || "").replace(/\s+/g, " ").trim();
  const error = new Error(responseMessage ? `HTTP ${response.status}: ${sanitizeKktixBodyPreview(responseMessage, 240)}` : `HTTP ${response.status}`);
  error.httpStatus = Number(response.status) || null;
  error.responseMessage = sanitizeKktixBodyPreview(responseMessage, 240);
  error.bodyPreview = sanitizeKktixBodyPreview(bodyText, 400);
  error.response = { status: error.httpStatus };
  throw error;
}

const parser = new Parser();

const AZURE_OPENAI_CONFIG_KEYS = Object.freeze([
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_VERSION",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_DEPLOYMENT",
]);

const DEFAULT_RSS_SOURCES = [
  "https://news.ltn.com.tw/rss/all.xml",
  "https://udn.com/rssfeed/news/2/6638?ch=news",
  "https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
];

const RSS_TIMEOUT_MS = 2200;
const TDX_TIMEOUT_MS = 1800;
const AZURE_OPENAI_TIMEOUT_MS = 5000;
const MAX_NEWS_FOR_AI = Number(process.env.MAX_NEWS_FOR_AI || DEFAULT_AI_CONTEXT_LIMIT);
const AI_ARTICLE_CONTEXT_TIMEOUT_MS = Number(process.env.AI_ARTICLE_CONTEXT_TIMEOUT_MS || DEFAULT_ARTICLE_TIMEOUT_MS);
const SOFT_DEADLINE_MS = 7000;
const TDX_PUBLIC_SOURCE_LIMIT = 2;
const TDX_STATIC_CACHE_MS = 1000 * 60 * Number(process.env.TDX_STATIC_CACHE_MINUTES || 360);
const TDX_LIVE_CACHE_MS = 1000 * 60 * Number(process.env.TDX_LIVE_CACHE_MINUTES || 30);
const TDX_CONSTRUCTION_CACHE_MS = 1000 * 60 * Number(process.env.TDX_CONSTRUCTION_CACHE_MINUTES || 360);
const TDX_BACKOFF_MS = 1000 * 60 * Number(process.env.TDX_BACKOFF_MINUTES || 60);
const TDX_STATIC_CACHE_KEY = "tdx:static_cms";
const TDX_LIVE_CACHE_KEY = "tdx:live_cms_events";
const TDX_CONSTRUCTION_CACHE_KEY = "tdx:construction_events";
const GEOCODING_CACHE_PREFIX = "geocode:v2:";
const GEOCODING_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_GEOCODING_PER_CRON = Number(process.env.MAX_GEOCODING_PER_CRON || 20);
const MIN_EVENT_CACHE_TTL_SECONDS = 60 * 60;
const DEFAULT_EVENT_CACHE_TTL_SECONDS = 60 * 60 * 6;
const KKTIX_ACTIVITY_FEED = "https://kktix.com/events.atom";
const KKTIX_RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const ICULTURE_ACTIVITY_FEED = "https://cloud.culture.tw/frontsite/trans/SearchShowAction.do?category=all&method=doFindTypeJ";
const ICULTURE_TIMEOUT_MS = 3000;
const ICULTURE_MAX_EVENTS = 30;
const TOURISM_EVENTS_FEED = "https://media.taiwan.net.tw/XMLReleaseAll_public/v2.0/Zh_tw/Event-json.zip";
const TOURISM_EVENTS_TIMEOUT_MS = 5000;
const TOURISM_EVENTS_MAX_EVENTS = 100;
const { recordEventIntegrationStatus } = require("./integration-store");

const TDX_CONSTRUCTION_404_SKIP = new Set(["Taoyuan", "Tainan"]);

const CMS_DIRECT_EVENT_PATTERN = /事故|車禍|壅塞|回堵|封閉|封路|管制|施工|改道|坍方|落石|淹水|積水|號誌|車道|匝道|交流道|排除|拖吊|救援|警察|消防|救護|緊急|故障車|拋錨|障礙物|掉落物|塞車|車多|禁止通行|單線|雙向|邊坡|土石流|停電|停水|closure|closed|accident|congestion|construction|flood|rockfall|debris/i;
const CMS_GENERIC_NOTICE_PATTERN = /小心駕駛|安全駕駛|請小心|注意安全|保持車距|請保持|請減速|減速慢行|勿疲勞|疲勞駕駛|酒後不開車|開車不喝酒|嚴禁酒駕|請繫安全帶|繫安全帶|天候不佳|雨天路滑|路況資訊|收聽警廣|旅途平安|祝.*平安|遵守交通規則|請勿超速|勿超速|注意車前|請開大燈|開亮頭燈|drive safely|safe driving|slow down|seat belt|weather|rainy|road information/i;

function resolveEventCacheTtlSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_EVENT_CACHE_TTL_SECONDS;
  return Math.max(MIN_EVENT_CACHE_TTL_SECONDS, Math.floor(parsed));
}

const TDX_CITY_SOURCES = [
  { path: "Taipei", city: "Taipei", lat: 25.033, lng: 121.5654 },
  { path: "NewTaipei", city: "New Taipei", lat: 25.0169, lng: 121.4628 },
  { path: "Taoyuan", city: "Taoyuan", lat: 24.9937, lng: 121.3009 },
  { path: "Taichung", city: "Taichung", lat: 24.1477, lng: 120.6736 },
  { path: "Tainan", city: "Tainan", lat: 22.9997, lng: 120.227 },
  { path: "Kaohsiung", city: "Kaohsiung", lat: 22.6273, lng: 120.3014 },
];

const TDX_CMS_SOURCES = [
  ...TDX_CITY_SOURCES.map((item) => ({
    type: "City",
    path: item.path,
    city: item.city,
    lat: item.lat,
    lng: item.lng,
  })),
  { type: "Highway", path: "Highway", city: "Highway", lat: 23.8, lng: 120.9 },
  { type: "Freeway", path: "Freeway", city: "Freeway", lat: 23.8, lng: 120.9 },
];

const TDX_PRIORITY_SOURCE_KEYS = new Set([
  "Freeway:Freeway",
  "Highway:Highway",
  "City:Taipei",
  "City:NewTaipei",
  "City:Taoyuan",
  "City:Taichung",
  "City:Tainan",
  "City:Kaohsiung",
]);

const TDX_CONSTRUCTION_SOURCES = [
  ...TDX_CITY_SOURCES.map((item) => ({
    type: "City",
    path: item.path,
    city: item.city,
    lat: item.lat,
    lng: item.lng,
  })),
  { type: "Highway", path: "Highway", city: "Highway", lat: 23.8, lng: 120.9 },
];

const BACKOFF_FILE = path.join(os.tmpdir(), "tdx_backoff_state.json");

function loadBackoffState() {
  try {
    const raw = fs.readFileSync(BACKOFF_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveBackoffState(state) {
  try {
    fs.writeFileSync(BACKOFF_FILE, JSON.stringify(state), "utf8");
  } catch {}
}

function getBackoffUntil(key) {
  const state = loadBackoffState();
  return state[key] || 0;
}

function setBackoffUntil(key, until) {
  const state = loadBackoffState();
  state[key] = until;
  saveBackoffState(state);
}

let tdxConstructionCache = { expiresAt: 0, events: [] };
let tdxStaticCmsCache = { expiresAt: 0, bySource: new Map() };
let tdxLiveCmsCache = { expiresAt: 0, events: [] };

function mapStaticCacheToRows(bySource) {
  return Array.from(bySource.entries()).map(([key, records]) => [key, Array.from(records.entries())]);
}

function rowsToStaticCacheMap(rows) {
  if (!Array.isArray(rows)) return new Map();
  return new Map(rows.map(([key, records]) => [key, new Map(Array.isArray(records) ? records : [])]));
}

const CITY_FALLBACKS = Object.fromEntries(
  TDX_CITY_SOURCES.map((item) => [item.city, { city: item.city, lat: item.lat, lng: item.lng }])
);

const CITY_ALIASES = [
  { keywords: ["\u53f0\u5317", "\u81fa\u5317", "Taipei"], city: "Taipei" },
  { keywords: ["\u65b0\u5317", "New Taipei"], city: "New Taipei" },
  { keywords: ["\u6843\u5712", "Taoyuan"], city: "Taoyuan" },
  { keywords: ["\u53f0\u4e2d", "\u81fa\u4e2d", "Taichung"], city: "Taichung" },
  { keywords: ["\u53f0\u5357", "\u81fa\u5357", "Tainan"], city: "Tainan" },
  { keywords: ["\u9ad8\u96c4", "Kaohsiung"], city: "Kaohsiung" },
  { keywords: ["\u57fa\u9686", "Keelung"], city: "Keelung", lat: 25.1276, lng: 121.7392 },
  { keywords: ["\u65b0\u7af9", "Hsinchu"], city: "Hsinchu", lat: 24.8138, lng: 120.9675 },
  { keywords: ["\u82d7\u6817", "Miaoli"], city: "Miaoli", lat: 24.5602, lng: 120.8214 },
  { keywords: ["\u5f70\u5316", "Changhua"], city: "Changhua", lat: 24.0817, lng: 120.5384 },
  { keywords: ["\u5357\u6295", "Nantou"], city: "Nantou", lat: 23.9609, lng: 120.9719 },
  { keywords: ["\u96f2\u6797", "Yunlin"], city: "Yunlin", lat: 23.7092, lng: 120.4313 },
  { keywords: ["\u5609\u7fa9", "Chiayi"], city: "Chiayi", lat: 23.4801, lng: 120.4491 },
  { keywords: ["\u5c4f\u6771", "Pingtung"], city: "Pingtung", lat: 22.5519, lng: 120.5488 },
  { keywords: ["\u5b9c\u862d", "Yilan"], city: "Yilan", lat: 24.7021, lng: 121.7378 },
  { keywords: ["\u82b1\u84ee", "Hualien"], city: "Hualien", lat: 23.9872, lng: 121.6015 },
  { keywords: ["\u53f0\u6771", "\u81fa\u6771", "Taitung"], city: "Taitung", lat: 22.7583, lng: 121.1444 },
  { keywords: ["\u6f8e\u6e56", "Penghu"], city: "Penghu", lat: 23.5712, lng: 119.5793 },
  { keywords: ["\u91d1\u9580", "Kinmen"], city: "Kinmen", lat: 24.4321, lng: 118.3171 },
  { keywords: ["\u9023\u6c5f", "\u99ac\u7956", "Lienchiang"], city: "Lienchiang", lat: 26.1602, lng: 119.9517 },
];

const CATEGORY_KEYWORDS = [
  { category: "traffic", keywords: ["\u8eca\u798d", "\u4e8b\u6545", "\u585e\u8eca", "\u58c5\u585e", "\u5c01\u9589", "\u6539\u9053", "\u9053\u8def", "\u570b\u9053", "\u7701\u9053", "\u4ea4\u901a"] },
  { category: "disaster", keywords: ["\u5730\u9707", "\u98b1\u98a8", "\u8c6a\u96e8", "\u6df9\u6c34", "\u571f\u77f3\u6d41", "\u707d\u5bb3", "\u505c\u73ed", "\u505c\u8ab2"] },
  { category: "fire", keywords: ["\u706b\u8b66", "\u706b\u707d", "\u8d77\u706b", "\u71c3\u71d2"] },
  { category: "police", keywords: ["\u8b66\u65b9", "\u8b66\u5bdf", "\u902e\u6355", "\u7aca\u76dc", "\u8a50\u9a19", "\u5211\u6848"] },
  { category: "construction", keywords: ["\u65bd\u5de5", "\u5de5\u7a0b", "\u5c01\u8def", "\u9053\u8def\u65bd\u5de5", "\u7ba1\u5236"] },
  { category: "activity", keywords: ["\u6d3b\u52d5", "\u5c55\u89bd", "\u6f14\u5531\u6703", "\u5e02\u96c6", "\u8cfd\u4e8b", "\u8b1b\u5ea7", "\u796d\u5178"] },
  { category: "politics", keywords: ["\u7acb\u6cd5\u9662", "\u5e02\u8b70\u6703", "\u7e23\u8b70\u6703", "\u9078\u8209", "\u653f\u7b56", "\u6297\u8b70"] },
  { category: "finance", keywords: ["\u80a1\u5e02", "\u532f\u7387", "\u7269\u50f9", "\u6295\u8cc7", "\u8ca1\u5831"] },
  { category: "social", keywords: ["\u793e\u5340", "\u6c11\u773e", "\u516c\u76ca", "\u7cfe\u7d1b", "\u751f\u6d3b"] },
];
function getRemainingTime(startedAt) {
  return Math.max(0, SOFT_DEADLINE_MS * 4 - (Date.now() - startedAt));
}

async function fetchOneRssFeed(rssUrl, startedAt) {
  try {
    const xmlResponse = await fetchResponse(rssUrl, {
      timeout: Math.max(800, Math.min(RSS_TIMEOUT_MS, getRemainingTime(startedAt) - 200)),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });
    const feed = await parser.parseString(await xmlResponse.text());
    return feed.items || [];
  } catch (error) {
    console.warn(`[cron] RSS fetch failed for ${rssUrl}:`, error.message);
    return [];
  }
}

async function fetchTDXAccessToken(startedAt) {
  const response = await fetchResponse(
    "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token",
    {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.TDX_CLIENT_ID,
        client_secret: process.env.TDX_CLIENT_SECRET,
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: Math.max(800, Math.min(TDX_TIMEOUT_MS, getRemainingTime(startedAt) - 200)),
    }
  );
  return (await response.json())?.access_token || "";
}

function getTdxHeaders(accessToken) {
  const headers = { Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function buildTdxCmsUrl(source, isLive = false) {
  const basePath = isLive
    ? ["api", "basic", "v2", "Road", "Traffic", "Live", "CMS"]
    : ["api", "basic", "v2", "Road", "Traffic", "CMS"];

  if (source.type === "City") {
    basePath.push("City", encodeURIComponent(source.path));
  } else if (source.type === "Highway" || source.type === "Freeway") {
    basePath.push(source.type);
  } else {
    throw new Error(`Unsupported TDX CMS source type: ${source.type}`);
  }
  return `https://tdx.transportdata.tw/${basePath.join("/")}?$format=JSON`;
}

function getSelectedTdxSources(hasCredentials) {
  if (!hasCredentials) {
    return TDX_CMS_SOURCES.filter((source) => TDX_PRIORITY_SOURCE_KEYS.has(`${source.type}:${source.path}`)).slice(0, TDX_PUBLIC_SOURCE_LIMIT);
  }
  return TDX_CMS_SOURCES.filter((source) => TDX_PRIORITY_SOURCE_KEYS.has(`${source.type}:${source.path}`));
}

function extractArrayFromTdxPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of Object.keys(payload)) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function getCmsKey(item) {
  return String(item.CMSID || item.CmsID || item.cmsId || item.CMSId || item.DeviceID || item.id || "").trim();
}

function normalizeCmsStaticRecord(item, source) {
  const cmsId = getCmsKey(item);
  const lng = Number(item.PositionLon ?? item.positionLon ?? item.px ?? item.Location?.PositionLon ?? item.LocationPt?.PositionLon);
  const lat = Number(item.PositionLat ?? item.positionLat ?? item.py ?? item.Location?.PositionLat ?? item.LocationPt?.PositionLat);

  if (!cmsId || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    cmsId,
    city: source.city,
    lat,
    lng,
    roadName: String(item.RoadName || item.roadName || item.LinkName || "").trim(),
    location: String(item.LocationDescription || item.locationDescription || "").trim(),
  };
}

function normalizeCmsNoticeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isGenericCmsNotice(message) {
  const text = normalizeCmsNoticeText(message);
  if (!text) return false;
  return CMS_GENERIC_NOTICE_PATTERN.test(text) && !CMS_DIRECT_EVENT_PATTERN.test(text);
}

function isGenericCmsNoticeRecord(item) {
  const source = normalizeCmsNoticeText(`${item?.source || ""} ${item?.sourceName || ""}`).toLowerCase();
  const title = normalizeCmsNoticeText(item?.title || "");
  if (!source.includes("tdx cms") && !title.endsWith("- CMS")) return false;
  return isGenericCmsNotice(`${title} ${item?.content || ""} ${item?.summary || ""}`);
}

function normalizeCmsLiveRecord(item, source, staticLookup) {
  const cmsId = getCmsKey(item);
  const staticInfo = cmsId ? staticLookup.get(cmsId) : null;
  const lng = Number(item.PositionLon ?? item.positionLon ?? item.LocationPt?.PositionLon ?? staticInfo?.lng ?? source.lng);
  const lat = Number(item.PositionLat ?? item.positionLat ?? item.LocationPt?.PositionLat ?? staticInfo?.lat ?? source.lat);
  const messageStatus = Number(item.MessageStatus ?? item.messageStatus ?? item.MsgStatus ?? item.msgStatus ?? 1);
  const messagesValue = Array.isArray(item.Messages) ? item.Messages : Array.isArray(item.messages) ? item.messages : [];
  
  const joinedMessages = messagesValue
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (!entry || typeof entry !== "object") return "";
      return String(entry.Text || entry.text || entry.Message || entry.message || entry.DisplayMessage || entry.displayMessage || entry.Msg || "").trim();
    })
    .filter(Boolean)
    .join(" / ");
    
  const message = String(joinedMessages || item.Text || item.text || item.Message || item.message || item.DisplayMessage || item.displayMessage || item.Msg || "")
    .replace(/\s+/g, " ").trim();

  if (messageStatus === 0 || !message || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (isGenericCmsNotice(message)) return null;

  const roadName = staticInfo?.roadName || String(item.RoadName || item.roadName || item.LinkName || "").trim();
  const location = staticInfo?.location || String(item.LocationDescription || item.locationDescription || "").trim();
  const titleBase = roadName || location || `${source.city} CMS`;

  return {
    title: `${titleBase} - CMS`.slice(0, 120),
    content: message.slice(0, 220),
    category: "traffic",
    lat,
    lng,
    city: staticInfo?.city || source.city,
    source: "TDX CMS",
    locationPrecision: "exact",
    locationSource: "official",
    locationConfidence: 1,
    locationQuality: "high",
    locationDisplayMode: "point",
    url: "",
  };
}

function buildTdxConstructionUrl(source) {
  const basePath = ["api", "basic", "v2", "Road", "Construction", "Live"];
  if (source.type === "City") basePath.push("City", encodeURIComponent(source.path));
  else if (source.type === "Highway") basePath.push("Highway");
  else throw new Error(`Unsupported TDX Construction source type: ${source.type}`);
  return `https://tdx.transportdata.tw/${basePath.join("/")}?$format=JSON`;
}

function normalizeCmsConstructionRecord(item, source) {
  const lng = Number(item.PositionLon ?? item.positionLon ?? item.StartPositionLon ?? item.Location?.PositionLon ?? source.lng);
  const lat = Number(item.PositionLat ?? item.positionLat ?? item.StartPositionLat ?? item.Location?.PositionLat ?? source.lat);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const roadName = String(item.RoadName || item.roadName || item.LinkName || "").trim();
  const location = String(item.LocationDescription || item.locationDescription || item.WorkScope || "").trim();
  const description = String(item.ConstructionDescription || item.Description || item.WorkContent || item.Memo || "").trim();
  const titleBase = roadName || location || `${source.city} construction`;

  if (!description && !location) return null;

  return {
    title: `${titleBase} - construction`.slice(0, 120),
    content: (description || location).slice(0, 220),
    category: "construction",
    lat,
    lng,
    city: source.city,
    source: "TDX CMS",
    locationPrecision: "exact",
    locationSource: "official",
    locationConfidence: 1,
    locationQuality: "high",
    locationDisplayMode: "point",
    url: "",
  };
}
async function fetchTdxJson(url, headers, startedAt) {
  const response = await fetchResponse(url, {
    headers,
    timeout: Math.max(800, Math.min(TDX_TIMEOUT_MS, getRemainingTime(startedAt) - 150)),
  });
  return response.json();
}

// ?? ????? for...of ???????????
async function loadStaticCmsCache(accessToken, startedAt) {
  const now = Date.now();
  if (now < getBackoffUntil("staticCms")) return tdxStaticCmsCache.bySource;
  if (now < tdxStaticCmsCache.expiresAt && tdxStaticCmsCache.bySource.size > 0) return tdxStaticCmsCache.bySource;

  const persistedRows = await getCachedValue(TDX_STATIC_CACHE_KEY);
  const persistedMap = rowsToStaticCacheMap(persistedRows);
  if (persistedMap.size > 0) {
    tdxStaticCmsCache = { bySource: persistedMap, expiresAt: now + TDX_STATIC_CACHE_MS };
    return persistedMap;
  }

  const headers = getTdxHeaders(accessToken);
  const bySource = new Map();
  const sourcesToFetch = getSelectedTdxSources(Boolean(accessToken));
  let sawRateLimit = false;

  for (const source of sourcesToFetch) {
    if (getRemainingTime(startedAt) < 800) break;
    try {
      const url = buildTdxCmsUrl(source, false);
      const data = await fetchTdxJson(url, headers, startedAt);
      const rawRecords = extractArrayFromTdxPayload(data);
      const records = rawRecords.map((item) => normalizeCmsStaticRecord(item, source)).filter(Boolean);
      bySource.set(`${source.type}:${source.path}`, new Map(records.map((item) => [item.cmsId, item])));
    } catch (error) {
      const status = error.response?.status;
      if (status === 429) sawRateLimit = true;
      console.warn(`[cron] TDX static CMS failed for ${source.type}/${source.path}:`, status ? `HTTP ${status}` : error.message);
      bySource.set(`${source.type}:${source.path}`, new Map());
    }
    await delay(500); // ??? 0.5 ??
  }

  if (sawRateLimit) setBackoffUntil("staticCms", now + TDX_BACKOFF_MS);

  tdxStaticCmsCache = { bySource, expiresAt: now + TDX_STATIC_CACHE_MS };
  await setCachedValue(TDX_STATIC_CACHE_KEY, mapStaticCacheToRows(bySource), { ex: Math.floor(TDX_STATIC_CACHE_MS / 1000) });
  return bySource;
}

// ?? ????? for...of ???????????????????
async function fetchTDXTrafficEvents(startedAt, preloadedToken = "") {
  try {
    if (getRemainingTime(startedAt) < 1200) return [];

    const now = Date.now();
    if (now < getBackoffUntil("liveCms")) return tdxLiveCmsCache.events;
    if (now < tdxLiveCmsCache.expiresAt && tdxLiveCmsCache.events.length > 0) return tdxLiveCmsCache.events;

    const persistedLive = await getCachedValue(TDX_LIVE_CACHE_KEY);
    const persistedLiveEvents = Array.isArray(persistedLive?.events) ? persistedLive.events : persistedLive;
    if (Array.isArray(persistedLiveEvents)) {
      tdxLiveCmsCache = { events: persistedLiveEvents, expiresAt: now + TDX_LIVE_CACHE_MS };
      return persistedLiveEvents;
    }

    let accessToken = preloadedToken;
    const headers = getTdxHeaders(accessToken);
    const staticCache = await loadStaticCmsCache(accessToken, startedAt);
    const sourcesToFetch = getSelectedTdxSources(Boolean(accessToken));
    let sawRateLimit = false;
    const trafficEvents = []; const subrequests = []; let successes = 0;

    for (const source of sourcesToFetch) {
      if (getRemainingTime(startedAt) < 500) break;
      try {
        const requestStarted = Date.now(); const url = buildTdxCmsUrl(source, true);
        const data = await fetchTdxJson(url, headers, startedAt);
        const rawRecords = extractArrayFromTdxPayload(data);
        const staticLookup = staticCache.get(`${source.type}:${source.path}`) || new Map();
        const records = rawRecords.map((item) => normalizeCmsLiveRecord(item, source, staticLookup)).filter(Boolean);
        trafficEvents.push(...records); successes += 1; subrequests.push({ endpoint:`${source.type}/${source.path}`, status:"success", httpStatus:200, durationMs:Date.now()-requestStarted, fetchedCount:rawRecords.length, errorCode:null, errorMessage:null });
      } catch (error) {
        const status = error.response?.status; subrequests.push({ endpoint:`${source.type}/${source.path}`, status:"failed", httpStatus:Number(status)||null, durationMs:0, fetchedCount:0, errorCode:status?`HTTP_${status}`:"REQUEST_ERROR", errorMessage:cleanRefreshLogError(error.message) }); if ([401,403].includes(Number(status))) throw new Error(`TDX authorization failed (HTTP ${status})`);
        if (status === 429) sawRateLimit = true;
        console.warn(`[cron] TDX live CMS failed for ${source.type}/${source.path}:`, status ? `HTTP ${status}` : error.message);
      }
      await delay(500); // ??? 0.5 ??
    }

    if (sourcesToFetch.length && successes === 0) throw new Error("All TDX traffic subrequests failed");
    const filteredEvents = trafficEvents.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng)); Object.defineProperty(filteredEvents,"collector",{value:{status:subrequests.some(x=>x.status==="failed")?"warning":"success",subrequests,successfulSubrequestCount:successes,failedSubrequestCount:subrequests.length-successes}});
    if (sawRateLimit) setBackoffUntil("liveCms", now + TDX_BACKOFF_MS);

    tdxLiveCmsCache = { events: filteredEvents, expiresAt: now + TDX_LIVE_CACHE_MS };
    await setCachedValue(TDX_LIVE_CACHE_KEY, { events: filteredEvents, fetchedAt: now }, { ex: Math.floor(TDX_LIVE_CACHE_MS / 1000) });
    return filteredEvents;
  } catch (error) {
    console.error("[cron] TDX fetch failed:", error.message);
    throw error;
  }
}

// ?? ????? for...of ????????????????
async function fetchTDXConstructionEvents(accessToken, startedAt) {
  try {
    if (getRemainingTime(startedAt) < 1000) return [];

    const now = Date.now();
    if (now < getBackoffUntil("construction")) return tdxConstructionCache.events;
    if (now < tdxConstructionCache.expiresAt && tdxConstructionCache.events.length > 0) return tdxConstructionCache.events;

    const persistedConstruction = await getCachedValue(TDX_CONSTRUCTION_CACHE_KEY);
    const persistedConstructionEvents = Array.isArray(persistedConstruction?.events) ? persistedConstruction.events : persistedConstruction;
    if (Array.isArray(persistedConstructionEvents)) {
      tdxConstructionCache = { events: persistedConstructionEvents, expiresAt: now + TDX_CONSTRUCTION_CACHE_MS };
      return persistedConstructionEvents;
    }

    const headers = getTdxHeaders(accessToken);
    let sawRateLimit = false;
    const sourcesToFetch = TDX_CONSTRUCTION_SOURCES.filter((source) => !TDX_CONSTRUCTION_404_SKIP.has(source.path));
    const constructionEvents = []; const subrequests = []; let successes = 0;

    for (const source of sourcesToFetch) {
      if (getRemainingTime(startedAt) < 500) break;
      try {
        const requestStarted = Date.now(); const url = buildTdxConstructionUrl(source);
        const data = await fetchTdxJson(url, headers, startedAt);
        const rawRecords = extractArrayFromTdxPayload(data);
        const records = rawRecords.map((item) => normalizeCmsConstructionRecord(item, source)).filter(Boolean);
        constructionEvents.push(...records); successes += 1; subrequests.push({ endpoint:`${source.type}/${source.path}`, status:"success", httpStatus:200, durationMs:Date.now()-requestStarted, fetchedCount:rawRecords.length, errorCode:null, errorMessage:null });
      } catch (error) {
        const status = error.response?.status; subrequests.push({ endpoint:`${source.type}/${source.path}`, status:"failed", httpStatus:Number(status)||null, durationMs:0, fetchedCount:0, errorCode:status?`HTTP_${status}`:"REQUEST_ERROR", errorMessage:cleanRefreshLogError(error.message) }); if ([401,403].includes(Number(status))) throw new Error(`TDX authorization failed (HTTP ${status})`);
        if (status === 429) sawRateLimit = true;
        console.warn(`[cron] TDX construction failed for ${source.type}/${source.path}:`, status ? `HTTP ${status}` : error.message);
      }
      await delay(500); // ??? 0.5 ??
    }

    if (sourcesToFetch.length && successes === 0) throw new Error("All TDX construction subrequests failed"); Object.defineProperty(constructionEvents,"collector",{value:{status:subrequests.some(x=>x.status==="failed")?"warning":"success",subrequests,successfulSubrequestCount:successes,failedSubrequestCount:subrequests.length-successes}});
    if (sawRateLimit) setBackoffUntil("construction", now + TDX_BACKOFF_MS);

    tdxConstructionCache = { events: constructionEvents, expiresAt: now + TDX_CONSTRUCTION_CACHE_MS };
    await setCachedValue(TDX_CONSTRUCTION_CACHE_KEY, { events: constructionEvents, fetchedAt: now }, { ex: Math.floor(TDX_CONSTRUCTION_CACHE_MS / 1000) });
    return constructionEvents;
  } catch (error) {
    console.error("[cron] TDX construction fetch failed:", error.message);
    throw error;
  }
}

function cleanNewsText(text) {
  return String(text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

function cleanMultilineText(text) {
  return String(text || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function extractDistrict(text = "") {
  const source = cleanNewsText(text).replace(/\u53f0/g, "\u81fa");
  const matches = [...source.matchAll(/([\u4e00-\u9fff]{1,5}(?:\u5340|\u9109|\u93ae|\u5e02))/g)]
    .map((match) => match[1])
    .filter((name) => !/[\u7e23\u5e02]$/.test(name) || name.length <= 3);
  return matches[0] || "";
}

function parseEventTime(value) {
  if (!value) return null;
  const ts = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function inferEventStatus(event, now = Date.now()) {
  const startAt = parseEventTime(event.startsAt || event.startAt);
  const endAt = parseEventTime(event.endsAt || event.endAt || event.expiresAt);
  if (endAt && endAt < now) return "expired";
  if (startAt && startAt > now) return "upcoming";
  return "active";
}

function inferImpact(event) {
  const category = event.category || "";
  const text = `${event.title || ""} ${event.content || ""} ${event.text || ""}`;
  if (category === "activity") return "May affect nearby crowds and traffic.";
  if (category === "traffic" || category === "construction") return "May affect travel time; consider alternate routes.";
  if (category === "accident") return "May affect safety and local traffic near the scene.";
  if (category === "disaster" || /\u706b\u707d|\u6df9\u6c34|\u5730\u9707|\u98b1\u98a8|\u8c6a\u96e8|\u571f\u77f3\u6d41/.test(text)) return "May affect public safety; follow official alerts.";
  if (category === "police" || category === "criminal") return "May affect nearby safety; follow on-site controls.";
  return "May affect nearby residents or travel plans.";
}

function inferAdvice(event) {
  const category = event.category || "";
  const text = `${event.title || ""} ${event.content || ""} ${event.text || ""}`;
  if (category === "activity") return "Check event, transit, and parking updates before going.";
  if (category === "traffic" || category === "construction" || /\u585e\u8eca|\u58c5\u585e|\u65bd\u5de5|\u5c01\u9589|\u6539\u9053/.test(text)) return "Avoid the affected road section and monitor live traffic.";
  if (category === "accident") return "Avoid the scene and follow police or emergency instructions.";
  if (category === "disaster" || /\u706b\u707d|\u6df9\u6c34|\u5730\u9707|\u98b1\u98a8|\u8c6a\u96e8|\u571f\u77f3\u6d41/.test(text)) return "Monitor official alerts and avoid the affected area.";
  if (category === "police" || category === "criminal") return "Avoid the scene and report urgent information to police.";
  return "Check source updates and nearby conditions.";
}

function inferSeverity(event) {
  if (Number.isFinite(Number(event.severity))) return Number(event.severity);
  const text = `${event.title || ""} ${event.content || ""} ${event.text || ""}`;
  if (/\u6b7b\u4ea1|\u91cd\u50b7|\u7206\u70b8|\u5927\u706b|\u571f\u77f3\u6d41|\u6df9\u6c34|\u505c\u73ed|\u505c\u8ab2|\u5c01\u9589/.test(text)) return 4;
  if (/\u8eca\u798d|\u706b\u707d|\u4e8b\u6545|\u65bd\u5de5|\u58c5\u585e|\u8b66\u6212|\u758f\u6563|\u902e\u6355/.test(text)) return 3;
  if ((event.category || "") === "activity") return 1;
  return 2;
}
function enrichCronEvent(event) {
  const now = Date.now();
  const title = String(event.title || event.text || "").trim();
  const content = String(event.content || event.summary || event.text || title).trim();
  const locationText = `${event.address || ""} ${event.location || ""} ${event.city || ""} ${title} ${content}`;
  const publishedAt = event.publishedAt || event.pubDate || event.createdAt || now;
  const createdAt = Number(event.createdAt) || parseEventTime(publishedAt) || now;
  const sourceUrl = String(event.sourceUrl || event.url || event.link || "").trim();

  return {
    ...event,
    title,
    content,
    summary: event.summary || content || title,
    sourceName: event.sourceName || event.source || "cron",
    sourceUrl,
    url: event.url || sourceUrl,
    district: event.district || extractDistrict(locationText),
    address: event.address || event.location || "",
    venue: event.venue || "",
    publishedAt: new Date(parseEventTime(publishedAt) || createdAt).toISOString(),
    updatedAt: new Date(now).toISOString(),
    createdAt,
    status: event.status || inferEventStatus(event, now),
    severity: inferSeverity(event),
    impact: event.impact || inferImpact(event),
    advice: event.advice || inferAdvice(event),
    tags: event.tags || [event.category, event.city, event.district].filter(Boolean),
  };
}

function inferCityFromText(text) {
  const sourceText = String(text || "");
  const matched = CITY_ALIASES.find(({ keywords }) => keywords.some((keyword) => sourceText.includes(keyword)));
  if (!matched) return null;
  const fallback = CITY_FALLBACKS[matched.city];
  return { city: matched.city, lat: matched.lat ?? fallback?.lat, lng: matched.lng ?? fallback?.lng };
}

function inferCategoryFromText(text) {
  const sourceText = String(text || "");
  const matched = CATEGORY_KEYWORDS.find(({ keywords }) => keywords.some((keyword) => sourceText.includes(keyword)));
  return matched?.category || "other";
}

function isInstitutionalNewsText(text = "") {
  return isLowRealtimeEvent(cleanNewsText(text));
}

function isInstitutionalEvent(event) {
  const source = String(`${event.source || ""} ${event.sourceName || ""}`).toLowerCase();
  if (source.includes("kktix") || source.includes("tdx") || source.includes("pbs") || source.includes("ubike")) return false;
  return isLowRealtimeEvent(event);
}

function extractRuleBasedEvents(newsItems) {
  const seen = new Set();
  return newsItems
    .map((item) => {
      const title = String(item.title || "").trim();
      const content = cleanNewsText(item.contentSnippet || item.content || "");
      const combinedText = `${title} ${content}`;
      const cityInfo = inferCityFromText(combinedText);

      if (!cityInfo || !title) return null;
      if (isInstitutionalNewsText(combinedText)) return null;

      const dedupeKey = `${cityInfo.city}:${title.slice(0, 40)}`.toLowerCase();
      if (seen.has(dedupeKey)) return null;
      seen.add(dedupeKey);

      return {
        title: title.slice(0, 120),
        content: content || title,
        category: inferCategoryFromText(combinedText),
        url: String(item.link || ""),
        lat: cityInfo.lat,
        lng: cityInfo.lng,
        city: cityInfo.city,
        source: "RSS",
      };
    })
    .filter(Boolean)
    .slice(0, 40);
}

function parseKktixDate(value = "") {
  const match = String(value).match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi}:00+08:00`;
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? ts : null;
}

function readKktixMetaLine(text, labels) {
  const lines = String(text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^\\s*${escaped}\\s*[:：]\\s*(.+)$`, "i");
    const matched = lines.find((line) => pattern.test(line));
    if (matched) return matched.match(pattern)?.[1]?.trim() || "";
  }
  return "";
}

function parseKktixMeta(item) {
  const text = cleanMultilineText(`${item.content || ""}\n${item.contentSnippet || ""}`);
  const timeLine = readKktixMetaLine(text, ["\u6642\u9593", "Time"]);
  const locationLine = readKktixMetaLine(text, ["\u5730\u9ede", "\u5730\u5740", "Location", "Venue"]);
  const [startText, endText] = timeLine.split(/\s*~\s*/);
  const locationParts = locationLine.split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean);
  return {
    timeLine,
    startAt: parseKktixDate(startText),
    endAt: parseKktixDate(endText || startText),
    venue: locationParts[0] || "",
    address: locationParts[1] || locationParts[0] || "",
    location: locationLine,
  };
}

function sanitizeKktixBodyPreview(value, maxLength = 200) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\bauthorization\b\s*[:=]\s*(?:bearer\s+)?[^\s;,&<>"']+/gi, "[redacted-secret]")
    .replace(/\b(?:set-?cookie|cookie|token|api[_-]?key|secret|password)\b\s*[:=]\s*[^\s;,&<>"']+/gi, "[redacted-secret]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:bearer\s+)?(?:sk|pk|rk)_[A-Za-z0-9_-]{8,}\b/gi, "[redacted-secret]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function getKktixHeader(response, name) {
  const value = response?.headers?.get?.(name);
  return String(value || "").trim().slice(0, 200);
}

function buildKktixResponseDiagnostic(response, body) {
  return {
    httpStatus: Number(response?.status) || null,
    url: String(response?.url || "").trim().slice(0, 1000),
    contentType: getKktixHeader(response, "content-type"),
    server: getKktixHeader(response, "server"),
    retryAfter: getKktixHeader(response, "retry-after"),
    requestId: getKktixHeader(response, "x-request-id") || getKktixHeader(response, "cf-ray"),
    bodyPreview: sanitizeKktixBodyPreview(body),
  };
}

async function createKktixHttpError(response) {
  let body = "";
  try { body = await response.text(); } catch {}
  const error = new Error(`KKTIX HTTP ${Number(response?.status) || "request failed"}`);
  error.name = "KktixHttpError";
  error.httpStatus = Number(response?.status) || null;
  error.kktixDiagnostic = buildKktixResponseDiagnostic(response, body);
  return error;
}

async function fetchKktixActivityEvents(startedAt) {
  const attemptedAt = new Date().toISOString();
  try {
    if (getRemainingTime(startedAt) < 1200) throw new Error("refresh deadline exceeded");
    // KKTIX publishes this Atom feed. Other providers must be explicitly configured;
    // no private or undocumented endpoint is inferred here.
    const endpoint = String(process.env.KKTIX_EVENTS_FEED_URL || KKTIX_ACTIVITY_FEED).trim();
    let response;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await fetch(endpoint, {
          signal: AbortSignal.timeout(Math.max(800, Math.min(RSS_TIMEOUT_MS, getRemainingTime(startedAt) - 200))),
          headers: { "User-Agent": "Taiwan-News-Map/1.0 (+event integration)", Accept: "application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8" },
        });
        if (response.ok) break;
        lastError = await createKktixHttpError(response);
        if (!KKTIX_RETRYABLE_STATUS_CODES.has(Number(response.status))) break;
      } catch (error) {
        lastError = error;
        break;
      }
      if (attempt < 2) await delay(250 * (2 ** attempt));
    }
    if (!response?.ok) throw lastError || new Error("KKTIX fetch failed");
    const feed = await parser.parseString(await response.text());
    const now = Date.now();
    const windowEnd = now + 30 * 24 * 60 * 60 * 1000;
    const events = [];

    for (const item of (feed.items || []).slice(0, 60)) {
      const meta = parseKktixMeta(item);
      if (!item.title || !item.link || !meta.endAt) continue;
      if (meta.endAt < now) continue;
      if (meta.startAt && meta.startAt > windowEnd) continue;

      const cityInfo = inferCityFromText(`${meta.address} ${meta.location} ${item.title} ${item.contentSnippet || ""}`);
      if (!cityInfo?.city || !Number.isFinite(cityInfo.lat) || !Number.isFinite(cityInfo.lng)) continue;

      const expiresAt = Math.min(meta.endAt + 2 * 60 * 60 * 1000, now + 30 * 24 * 60 * 60 * 1000);
      const title = String(item.title || "").trim().slice(0, 120);
      const content = [
        meta.timeLine ? `Time: ${meta.timeLine}` : "",
        meta.location ? `Location: ${meta.location}` : "",
        item.creator ? `Organizer: ${item.creator}` : "",
      ].filter(Boolean).join(" / ");
      events.push(enrichCronEvent({
        id: `KKTIX_${Buffer.from(item.link).toString("base64").slice(0, 20)}`,
        title,
        content,
        category: "activity",
        url: item.link,
        sourceUrl: item.link,
        lat: cityInfo.lat,
        lng: cityInfo.lng,
        city: cityInfo.city,
        district: extractDistrict(meta.address || meta.location || ""),
        address: meta.address,
        venue: meta.venue,
        location: meta.address || meta.location || cityInfo.city,
        source: "KKTIX",
        sourceName: "KKTIX",
        eventFingerprint: `${cityInfo.city}_activity_${title.slice(0, 24)}`,
        startsAt: meta.startAt ? new Date(meta.startAt).toISOString() : null,
        endsAt: meta.endAt ? new Date(meta.endAt).toISOString() : null,
        expiresAt,
        createdAt: now,
      }));
    }

    const result = events.slice(0, 30);
    await recordEventIntegrationStatus("kktix", { status: "success", lastAttemptAt: attemptedAt, fetchedCount: (feed.items || []).length, insertedCount: result.length, duplicateCount: Math.max(0, (feed.items || []).length - result.length), failedCount: 0, lastErrorType: null, lastDiagnostic: null });
    return result;
  } catch (error) {
    const providerBlocked = Number(error.httpStatus) === 403;
    const diagnostic = error.kktixDiagnostic || null;
    console.warn("[cron] KKTIX activity fetch failed:", diagnostic || error.message);
    await recordEventIntegrationStatus("kktix", {
      status: providerBlocked ? "provider_blocked" : "error",
      lastAttemptAt: attemptedAt,
      lastErrorType: providerBlocked ? "provider_blocked" : (error.name === "TimeoutError" ? "timeout" : "request_error"),
      lastDiagnostic: diagnostic,
      failedCount: 1,
    });
    throw error;
  }
}

function parseICultureDate(value = "") {
  const match = String(value || "").trim().match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  const timestamp = Date.parse(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:${second.padStart(2, "0")}+08:00`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getICultureShowInfo(activity) {
  const value = activity?.showinfo ?? activity?.showInfo ?? [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return []; }
  }
  return [];
}

function buildICultureSourceUrl(uid) {
  const endpoint = String(process.env.ICULTURE_ACTIVITY_FEED_URL || ICULTURE_ACTIVITY_FEED).trim();
  return uid ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}uid=${encodeURIComponent(uid)}` : endpoint;
}

async function fetchCultureActivityEvents(startedAt) {
  const attemptedAt = new Date().toISOString();
  try {
    if (getRemainingTime(startedAt) < 1000) throw new Error("refresh deadline exceeded");
    const endpoint = String(process.env.ICULTURE_ACTIVITY_FEED_URL || ICULTURE_ACTIVITY_FEED).trim();
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(Math.max(800, Math.min(ICULTURE_TIMEOUT_MS, getRemainingTime(startedAt) - 150))),
      headers: { "User-Agent": "Taiwan-News-Map/1.0 (+event integration)", Accept: "application/json, text/json;q=0.9, */*;q=0.8" },
    });
    if (!response.ok) {
      const error = new Error(`iCulture HTTP ${Number(response.status) || "request failed"}`);
      error.httpStatus = Number(response.status) || null;
      throw error;
    }
    const payload = await response.json();
    const activities = Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : []);
    const now = Date.now();
    const windowEnd = now + 30 * 24 * 60 * 60 * 1000;
    const seen = new Set();
    const events = [];
    for (const activity of activities) {
      const uid = String(activity?.UID ?? activity?.uid ?? activity?.id ?? "").trim();
      const title = String(activity?.title ?? activity?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (!uid || !title) continue;
      for (const show of getICultureShowInfo(activity)) {
        const startsAt = parseICultureDate(show?.time ?? show?.startTime ?? show?.startDate);
        const endsAt = parseICultureDate(show?.endTime ?? show?.endtime) || startsAt;
        if (!startsAt || !endsAt || endsAt < now || startsAt > windowEnd) continue;
        const lat = Number(show?.latitude ?? show?.lat);
        const lng = Number(show?.longitude ?? show?.lng ?? show?.lon);
        const address = String(show?.location ?? show?.address ?? "").replace(/\s+/g, " ").trim();
        const venue = String(show?.locationName ?? show?.venue ?? "").replace(/\s+/g, " ").trim();
        const city = inferTaiwanCityFromText(`${address} ${venue} ${title}`) || inferCityFromText(`${address} ${venue} ${title}`)?.city;
        if (!isValidTaiwanCoord(lat, lng) || !city) continue;
        const dedupeKey = `${uid}:${startsAt}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const sourceUrl = buildICultureSourceUrl(uid);
        events.push(enrichCronEvent({
          id: `iCulture_${uid}_${startsAt}`.replace(/[^A-Za-z0-9_-]/g, "_"), title,
          content: String(activity?.descriptionFilterHtml ?? activity?.description ?? venue ?? title).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220),
          category: "activity", url: sourceUrl, sourceUrl, address, venue, location: address || venue,
          lat, lng, city, district: extractDistrict(address), source: "iCulture", sourceName: "iCulture",
          eventFingerprint: `iculture:${dedupeKey}`, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(),
          expiresAt: Math.min(endsAt + 2 * 60 * 60 * 1000, windowEnd), createdAt: now,
        }));
        if (events.length >= ICULTURE_MAX_EVENTS) break;
      }
      if (events.length >= ICULTURE_MAX_EVENTS) break;
    }
    await recordEventIntegrationStatus("iculture", { status: "success", lastAttemptAt: attemptedAt, fetchedCount: activities.length, insertedCount: events.length, duplicateCount: Math.max(0, activities.length - events.length), failedCount: 0, lastErrorType: null, lastDiagnostic: null });
    return events;
  } catch (error) {
    console.warn("[cron] iCulture activity fetch failed:", error.message);
    await recordEventIntegrationStatus("iculture", { status: "error", lastAttemptAt: attemptedAt, lastErrorType: error.name === "TimeoutError" ? "timeout" : "request_error", lastDiagnostic: error.httpStatus ? { httpStatus: error.httpStatus } : null, failedCount: 1 });
    throw error;
  }
}

function extractZipJson(buffer) {
  const archive = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const endOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0) throw new Error("Tourism Events response is not a ZIP archive");
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16);
  let offset = centralDirectoryOffset;
  while (offset + 46 <= archive.length && archive.readUInt32LE(offset) === 0x02014b50) {
    const compression = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const fileName = archive.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    if (/\.json$/i.test(fileName)) {
      if (archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Tourism Events ZIP has an invalid local entry");
      const localNameLength = archive.readUInt16LE(localOffset + 26);
      const localExtraLength = archive.readUInt16LE(localOffset + 28);
      const bodyStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = archive.subarray(bodyStart, bodyStart + compressedSize);
      if (compression === 0) return JSON.parse(compressed.toString("utf8").replace(/^\uFEFF/, ""));
      if (compression === 8) return JSON.parse(zlib.inflateRawSync(compressed).toString("utf8").replace(/^\uFEFF/, ""));
      throw new Error(`Tourism Events ZIP uses unsupported compression ${compression}`);
    }
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  throw new Error("Tourism Events ZIP does not contain a JSON file");
}

function parseTourismDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeTourismEvent(item, now = Date.now()) {
  const id = String(item?.EventID || "").trim();
  const title = String(item?.EventName || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const lat = Number(item?.PositionLat);
  const lng = Number(item?.PositionLon);
  const address = String(item?.PostalAddress || "").replace(/\s+/g, " ").trim();
  const locatedCities = Array.isArray(item?.LocatedCities) ? item.LocatedCities.join(" ") : String(item?.LocatedCities || "");
  const startsAt = parseTourismDate(item?.StartDateTime);
  const endsAt = parseTourismDate(item?.EndDateTime);
  const status = String(item?.EventStatus || "").trim().toLowerCase();
  if (!id || !title || !isValidTaiwanCoord(lat, lng) || (endsAt && endsAt < now) || /end|ended|closed|結束/.test(status)) return null;
  const city = inferTaiwanCityFromText(`${locatedCities} ${address} ${title}`) || inferCityFromText(`${locatedCities} ${address} ${title}`)?.city;
  if (!city) return null;
  const images = Array.isArray(item?.Images) ? item.Images : [];
  const image = images.map((value) => typeof value === "string" ? value : (value?.Src || value?.src || value?.URL || value?.url || "")).find(Boolean) || "";
  const sourceUrl = String(item?.WebsiteURL || "").trim() || TOURISM_EVENTS_FEED;
  return enrichCronEvent({
    id: `tourism-events_${id}`.replace(/[^A-Za-z0-9_-]/g, "_"), title,
    content: String(item?.Description || title).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220),
    category: "activity", url: sourceUrl, sourceUrl, address, location: address || locatedCities,
    lat, lng, city, district: extractDistrict(address), source: "Tourism Events", sourceName: "Tourism Events",
    image, images, eventFingerprint: `tourism-events:${id}`,
    startsAt: startsAt ? new Date(startsAt).toISOString() : null,
    endsAt: endsAt ? new Date(endsAt).toISOString() : null,
    expiresAt: endsAt || (startsAt ? startsAt + 30 * 24 * 60 * 60 * 1000 : now + 30 * 24 * 60 * 60 * 1000),
    publishedAt: item?.UpdateTime || now, createdAt: now, tourismEvent: {
      EventID: id, EventName: title, Description: item?.Description || "", PositionLat: lat, PositionLon: lng,
      PostalAddress: address, LocatedCities: item?.LocatedCities || [], WebsiteURL: item?.WebsiteURL || "", Images: images,
      StartDateTime: item?.StartDateTime || "", EndDateTime: item?.EndDateTime || "", EventStatus: item?.EventStatus || "", UpdateTime: item?.UpdateTime || "",
    },
  });
}

async function fetchTourismEvents(startedAt) {
  const attemptedAt = new Date().toISOString();
  try {
    if (getRemainingTime(startedAt) < 1000) throw new Error("refresh deadline exceeded");
    const response = await fetch(TOURISM_EVENTS_FEED, {
      signal: AbortSignal.timeout(Math.max(800, Math.min(TOURISM_EVENTS_TIMEOUT_MS, getRemainingTime(startedAt) - 150))),
    });
    if (!response.ok) { const error = new Error(`Tourism Events HTTP ${response.status}`); error.httpStatus = response.status; throw error; }
    const payload = extractZipJson(Buffer.from(await response.arrayBuffer()));
    const rawEvents = Array.isArray(payload) ? payload : (Array.isArray(payload?.Events) ? payload.Events : (Array.isArray(payload?.XML_Head?.Infos?.Info) ? payload.XML_Head.Infos.Info : (Array.isArray(payload?.data) ? payload.data : [])));
    const seen = new Set();
    const events = rawEvents.map((item) => normalizeTourismEvent(item)).filter(Boolean).filter((item) => {
      if (seen.has(item.eventFingerprint)) return false;
      seen.add(item.eventFingerprint); return true;
    }).slice(0, TOURISM_EVENTS_MAX_EVENTS);
    await recordEventIntegrationStatus("tourismEvents", { status: "success", lastAttemptAt: attemptedAt, fetchedCount: rawEvents.length, insertedCount: events.length, duplicateCount: Math.max(0, rawEvents.length - events.length), failedCount: 0, lastErrorType: null, lastDiagnostic: null });
    return events;
  } catch (error) {
    console.warn("[cron] Tourism Events fetch failed:", error.message);
    await recordEventIntegrationStatus("tourismEvents", { status: "error", lastAttemptAt: attemptedAt, lastErrorType: error.name === "TimeoutError" ? "timeout" : "request_error", lastDiagnostic: error.httpStatus ? { httpStatus: error.httpStatus } : null, failedCount: 1 });
    throw error;
  }
}

function getAzureOpenAiConfig() {
  const endpoint = String(process.env.AZURE_OPENAI_ENDPOINT || "").trim().replace(/\/+$/, "");
  const apiVersion = String(process.env.AZURE_OPENAI_API_VERSION || "").trim();
  const apiKey = String(process.env.AZURE_OPENAI_API_KEY || "").trim();
  const deployment = String(process.env.AZURE_OPENAI_DEPLOYMENT || "").trim();
  const values = { AZURE_OPENAI_ENDPOINT: endpoint, AZURE_OPENAI_API_VERSION: apiVersion, AZURE_OPENAI_API_KEY: apiKey, AZURE_OPENAI_DEPLOYMENT: deployment };
  const missing = AZURE_OPENAI_CONFIG_KEYS.filter((name) => !values[name]);

  if (missing.length) return { missing, error: `Azure OpenAI configuration incomplete: missing ${missing.join(", ")}` };

  return {
    missing: [],
    url: `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
  };
}

function requireAzureOpenAiConfig() {
  const config = getAzureOpenAiConfig();
  if (config.error) throw new Error(config.error);
  return config;
}

function azureOpenAiErrorForStatus(status) {
  if (status === 401) return "Azure OpenAI authentication failed (HTTP 401)";
  if (status === 429) return "Azure OpenAI rate limit or quota exceeded (HTTP 429)";
  return `Azure OpenAI request failed (HTTP ${Number.isInteger(status) ? status : "unknown"})`;
}

async function createAzureOpenAiChatCompletion(body, timeoutMs = AZURE_OPENAI_TIMEOUT_MS) {
  const config = requireAzureOpenAiConfig();
  let response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: config.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(800, timeoutMs)),
    });
  } catch {
    throw new Error("Azure OpenAI request failed");
  }

  if (!response.ok) throw new Error(azureOpenAiErrorForStatus(response.status));
  return response.json();
}

function parseAiJsonCompletion(completion) {
  const content = completion?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(content);
}

async function extractAiEvents(newsItems) {
  if (!newsItems.length) return [];
  requireAzureOpenAiConfig();

  const simplifiedNews = newsItems.slice(0, MAX_NEWS_FOR_AI).map((item) => ({
    title: item.title || "",
    content: cleanNewsText(item.contentSnippet || item.content || ""),
    link: item.link || "",
  }));

  const systemPrompt = [
    "Extract only real-world Taiwan events from the provided news.",
    "Return strict JSON with an events array.",
    "Keep only items with a physical place in Taiwan.",
    "Omit institutional, policy, subsidy, budget, council, application, public-service, or government process news unless it creates an immediate on-site traffic, safety, utility, disaster, or crowd impact.",
    "Use one category from the allowed enum.",
    "Deduplicate reports of the same real-world event into one event.",
    "Use the provided city fallback coordinates when exact coordinates are unknown.",
    "If no Taiwan location is found, omit the event.",
    "Set source to news.",
  ].join(" ");

  try {
    const completion = await createAzureOpenAiChatCompletion({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify({ cityFallbacks: CITY_FALLBACKS, news: simplifiedNews }) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "taiwan_events",
          strict: true,
          schema: {
            type: "object",
            properties: {
              events: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    content: { type: "string" },
                    category: { type: "string", enum: ["traffic", "construction", "disaster", "police", "activity", "politics", "social", "life", "tech", "finance", "international", "entertainment", "fire", "other"] },
                    url: { type: "string" },
                    lat: { type: "number" },
                    lng: { type: "number" },
                    city: { type: "string" },
                    source: { type: "string" },
                    eventFingerprint: { type: "string" },
                  },
                  required: ["title", "content", "category", "url", "lat", "lng", "city", "source", "eventFingerprint"],
                  additionalProperties: false,
                },
              },
            },
            required: ["events"],
            additionalProperties: false,
          },
        },
      },
    }, AZURE_OPENAI_TIMEOUT_MS);

    const parsed = parseAiJsonCompletion(completion);
    return Array.isArray(parsed?.events) ? parsed.events : [];
  } catch (error) {
    console.error("[cron] Azure OpenAI extraction failed:", error.message);
    throw error;
  }
}

async function extractAiEventsWithContext(newsItems, startedAt = Date.now()) {
  if (!newsItems.length) return [];
  requireAzureOpenAiConfig();

  const simplifiedNews = await prepareNewsContexts(newsItems, {
    maxArticles: Math.min(MAX_NEWS_FOR_AI, DEFAULT_AI_CONTEXT_LIMIT),
    maxChars: ARTICLE_CONTEXT_MAX_CHARS,
    timeoutMs: Math.max(500, Math.min(AI_ARTICLE_CONTEXT_TIMEOUT_MS, getRemainingTime(startedAt) - 500)),
  });

  const systemPrompt = [
    "Extract only real-world Taiwan events from the provided news.",
    "Read the article context, not only the title. Prefer the event location over background locations.",
    "Return strict JSON with an events array.",
    "Keep only items with a physical place in Taiwan.",
    "locationText must be the physical place, road section, venue, district, or city found in the article.",
    "locationEvidence must quote or closely paraphrase the sentence fragment that supports locationText.",
    "locationConfidence is 0 to 1. Use at least 0.55 only when the location is supported by evidence.",
    "Set locationAmbiguity true when the article contains multiple plausible event locations or only background locations.",
    "locationReason must briefly explain why locationText is the event location.",
    "Use locationPrecision exact for venue/road/address, district for district/township, city for city-only.",
    "Use one category from the allowed enum.",
    "Omit institutional, policy, subsidy, budget, council, application, public-service, or government process news unless it creates an immediate on-site traffic, safety, utility, disaster, or crowd impact.",
    "Deduplicate reports of the same real-world event into one event.",
    "Same event criteria: Same location + Same time + Same nature.",
    "Generate a unique eventFingerprint in format city_type_keyword.",
    "Use the provided city fallback coordinates when exact coordinates are unknown.",
    "If no Taiwan location is found, omit the event.",
    'Set source to "news".',
  ].join(" ");

  try {
    const completion = await createAzureOpenAiChatCompletion({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify({ cityFallbacks: CITY_FALLBACKS, news: simplifiedNews }) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "taiwan_events",
          strict: true,
          schema: {
            type: "object",
            properties: {
              events: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    content: { type: "string" },
                    category: { type: "string", enum: ["traffic", "construction", "disaster", "police", "activity", "politics", "social", "life", "tech", "finance", "international", "entertainment", "fire", "other"] },
                    url: { type: "string" },
                    lat: { type: "number" },
                    lng: { type: "number" },
                    city: { type: "string" },
                    locationText: { type: "string" },
                    locationEvidence: { type: "string" },
                    locationPrecision: { type: "string", enum: ["exact", "district", "city", "unknown"] },
                    locationConfidence: { type: "number" },
                    locationAmbiguity: { type: "boolean" },
                    locationReason: { type: "string" },
                    source: { type: "string" },
                    eventFingerprint: { type: "string" },
                  },
                  required: ["title", "content", "category", "url", "lat", "lng", "city", "locationText", "locationEvidence", "locationPrecision", "locationConfidence", "locationAmbiguity", "locationReason", "source", "eventFingerprint"],
                  additionalProperties: false,
                },
              },
            },
            required: ["events"],
            additionalProperties: false,
          },
        },
      },
    }, Math.max(800, Math.min(AZURE_OPENAI_TIMEOUT_MS, getRemainingTime(startedAt) - 300)));

    const parsed = parseAiJsonCompletion(completion);
    return normalizeAiExtractedEvents(parsed?.events);
  } catch (error) {
    console.error("[cron] Azure OpenAI context extraction failed:", error.message);
    throw error;
  }
}

function normalizeFinalEvents(events) {
  const dedupe = new Set();
  return events
    .filter((item) => {
      const lat = Number(item.lat);
      const lng = Number(item.lng);
      return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 21 && lat <= 26.5 && lng >= 118 && lng <= 123;
    })
    .map((item) => {
      return {
        ...item,
        title: String(item.title || "").trim(),
        content: String(item.content || "").trim(),
        city: String(item.city || "Taiwan").trim(),
        source: String(item.source || "news").trim(),
        url: String(item.url || "").trim(),
        lat: Number(item.lat),
        lng: Number(item.lng),
      };
    })
    .map(enrichCronEvent)
    .map((item) => ({
      ...item,
      visibilityReason: classifyEventVisibility(item).reason,
    }))
    .filter((item) => !isGenericCmsNoticeRecord(item))
    .filter((item) => !isInstitutionalEvent(item))
    .filter((item) => {
      const key = item.eventFingerprint || `${item.city}:${item.title.slice(0, 50)}:${item.category}`.toLowerCase();
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      return true;
    });
}

function getMapboxGeocodingToken() {
  return String(process.env.MAPBOX_GEOCODING_TOKEN || process.env.MAPBOX_PUBLIC_TOKEN || process.env.MAPBOX_TOKEN || "").trim();
}

function getGeoapifyGeocodingToken() {
  return String(process.env.GEOAPIFY_API_KEY || process.env.GEOAPIFY_KEY || "").trim();
}

function useMapboxPermanentGeocoding() {
  return process.env.MAPBOX_GEOCODING_PERMANENT === "1";
}

function shouldTryExternalGeocoding(event, location) {
  if (!getMapboxGeocodingToken() && !getGeoapifyGeocodingToken()) return false;
  if (location.locationQuality === "high" && location.locationPrecision === "exact") return false;
  if (!["city", "district", "unknown"].includes(location.locationPrecision) && location.locationQuality !== "low") return false;
  const query = buildLocationQuery(event, location.city, event.title, event.content);
  if (!query || query.length < 4) return false;

  const normalized = query.trim().toLowerCase();
  const vagueQueries = new Set(["taiwan", "\u53f0\u7063", "\u81fa\u7063", "\u53f0\u5317", "\u81fa\u5317"]);
  if (vagueQueries.has(normalized)) return false;

  return /\u8def|\u8857|\u5927\u9053|\u6bb5|\u5df7|\u5f04|\u865f|\u5340|\u9109|\u93ae|\u6751|\u91cc|\u6a4b|\u7ad9|\u5b78\u6821|\u516c\u5712|\u4e2d\u5fc3|\u9928|road|street|station|park|center/i.test(query);
}
function getCityBboxParam(city) {
  const bounds = getCityBounds(city);
  const values = [bounds?.minLng, bounds?.minLat, bounds?.maxLng, bounds?.maxLat].map(Number);
  const [minLng, minLat, maxLng, maxLat] = values;
  return values.every(Number.isFinite) && minLng < maxLng && minLat < maxLat ? values.join(",") : "";
}

function buildMapboxQuery(event = {}, location = {}) {
  const city = normalizeCity(location.city || event.city || "");
  const parts = [event.address, event.venue, event.location, event.district || location.district, city]
    .map((value) => String(value || "").replace(/https?:\/\/\S+/gi, " ").replace(/[\r\n]+/g, " ").replace(/([，,。.!！？?、；;])\1+/g, "$1").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!parts.length) {
    const title = String(event.title || "").replace(/https?:\/\/\S+/gi, " ").replace(/[\r\n]+/g, " ");
    const fragments = title.match(/[^，。；;！!?]{0,12}(?:路|街|大道|段|巷|弄|號|區|鄉|鎮|里|橋|站|館|園|中心|學校)[^，。；;！!?]{0,18}/g);
    if (fragments?.length) parts.push(...fragments);
  }
  const tokens = parts.join(" ").replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 15);
  return tokens.join(" ").slice(0, 80).trim();
}

function getMapboxProximity(location = {}) {
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isValidTaiwanCoord(lat, lng)) return "";
  const bounds = getCityBounds(location.city);
  if (bounds && !isCoordInCity(location.city, lat, lng)) return "";
  return `${lng},${lat}`;
}

function buildExternalGeocodingResult(provider, event, location, query, rankedCandidates) {
  const best = rankedCandidates.find((candidate) => candidate.accepted);
  if (!best) return null;
  const source = `${provider}-geocoding`;
  return withLocationQuality({
    lat: best.lat,
    lng: best.lng,
    city: location.city,
    district: location.district,
    locationPrecision: best.locationPrecision,
    locationSource: source,
    locationQuery: query,
    locationConfidence: best.locationConfidence,
    locationQuality: best.locationQuality,
    locationDisplayMode: best.locationDisplayMode,
    locationEvidence: event.locationEvidence || event.locationReason || "",
    locationCandidates: rankedCandidates.slice(0, 5).map((candidate) => ({
      source: candidate.source,
      lat: candidate.lat,
      lng: candidate.lng,
      placeName: candidate.placeName || candidate.formatted || candidate.name || "",
      featureType: candidate.featureType || candidate.resultType || "",
      precision: candidate.locationPrecision,
      confidence: candidate.locationConfidence,
      accepted: Boolean(candidate.accepted),
      rejectedReason: candidate.rejectedReason || "",
      matchedTokens: candidate.matchedTokens || [],
    })),
  }, event);
}

async function readGeocodingCache(provider, event, location, query) {
  const canReadCache = provider === "geoapify" || (provider === "mapbox" && useMapboxPermanentGeocoding());
  if (!canReadCache) return null;
  const cacheKey = `${GEOCODING_CACHE_PREFIX}${provider}:${makeGeocodingCacheKey(location.city, query)}`;
  try {
    const cached = await getCachedValue(cacheKey);
    if (cached && Number.isFinite(Number(cached.lat)) && Number.isFinite(Number(cached.lng))) {
      const lat = Number(cached.lat);
      const lng = Number(cached.lng);
      if (isValidTaiwanCoord(lat, lng) && isCoordInCity(location.city, lat, lng)) {
        return withLocationQuality({
          ...cached,
          lat,
          lng,
          locationSource: cached.locationSource || `${provider}-geocoding-cache`,
          locationQuery: query,
        }, event);
      }
    }
  } catch (error) {
    console.warn("[cron] geocode cache read failed:", error.message);
  }
  return null;
}

async function writeGeocodingCache(provider, location, query, result) {
  const canWriteCache = provider === "geoapify" || (provider === "mapbox" && useMapboxPermanentGeocoding());
  if (!canWriteCache || !result) return;
  const cacheKey = `${GEOCODING_CACHE_PREFIX}${provider}:${makeGeocodingCacheKey(location.city, query)}`;
  await setCachedValue(cacheKey, result, { ex: GEOCODING_CACHE_TTL_SECONDS }).catch((error) => {
    console.warn("[cron] geocode cache write failed:", error.message);
  });
}

async function geocodeLocationWithMapbox(event, location, startedAt) {
  const token = getMapboxGeocodingToken();
  if (!token) return null;
  const query = buildMapboxQuery(event, location);
  if (!query) return null;
  const cached = await readGeocodingCache("mapbox", event, location, query);
  if (cached) return cached;

  const remaining = getRemainingTime(startedAt);
  if (remaining < 1200) return null;

  const endpoint = useMapboxPermanentGeocoding() ? "mapbox.places-permanent" : "mapbox.places";
  const url = `https://api.mapbox.com/geocoding/v5/${endpoint}/${encodeURIComponent(query)}.json`;
  const bbox = getCityBboxParam(location.city);
  const proximity = getMapboxProximity(location);
  const logFailure = (error, attempt) => console.warn("[cron] Mapbox geocoding failed", {
    httpStatus: error.httpStatus || error.response?.status || null,
    responseMessage: error.responseMessage || "",
    queryPreview: query.slice(0, 80), queryLength: query.length, queryTokenCount: query.split(/\s+/).filter(Boolean).length,
    city: location.city || "", hasBbox: Boolean(bbox), hasProximity: Boolean(proximity), attempt,
  });
  try {
    let response;
    try {
      response = await fetchResponse(url, { params: { access_token: token, country: "tw", language: "zh", limit: 5, autocomplete: false, proximity: proximity || undefined, bbox: bbox || undefined }, timeout: Math.max(800, Math.min(1800, remaining - 300)) });
    } catch (error) {
      logFailure(error, 1);
      if (Number(error.httpStatus || error.response?.status) !== 422) throw error;
      const simplifiedQuery = query.split(/\s+/).slice(0, 8).join(" ").slice(0, 50) || query;
      const removeBbox = /bbox|bounding\s*box/i.test(String(error.responseMessage || error.bodyPreview || ""));
      response = await fetchResponse(`https://api.mapbox.com/geocoding/v5/${endpoint}/${encodeURIComponent(simplifiedQuery)}.json`, {
        params: { access_token: token, country: "tw", language: "zh", limit: 5, autocomplete: false, bbox: removeBbox ? undefined : (bbox || undefined) },
        timeout: Math.max(800, Math.min(1800, remaining - 300)),
      });
    }
    const payload = await response.json();
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const candidates = features.map((feature) => {
      const center = Array.isArray(feature?.center) ? feature.center : [];
      const context = Array.isArray(feature?.context) ? feature.context.map((item) => item.text || item.short_code || "").join(" ") : "";
      return {
        source: "mapbox",
        lat: Number(center[1]),
        lng: Number(center[0]),
        placeName: feature.place_name || "",
        name: feature.text || feature.matching_text || "",
        featureType: Array.isArray(feature.place_type) ? feature.place_type[0] : "",
        relevance: Number(feature.relevance),
        context,
        query,
      };
    });
    const ranked = rankGeocodingCandidates(event, location, candidates);
    const result = buildExternalGeocodingResult("mapbox", event, location, query, ranked);
    await writeGeocodingCache("mapbox", location, query, result);
    return result;
  } catch (error) {
    logFailure(error, 2);
    return null;
  }
}

async function geocodeLocationWithGeoapify(event, location, startedAt) {
  const token = getGeoapifyGeocodingToken();
  if (!token) return null;
  const query = buildLocationQuery(event, location.city, event.title, event.content);
  const cached = await readGeocodingCache("geoapify", event, location, query);
  if (cached) return cached;

  const remaining = getRemainingTime(startedAt);
  if (remaining < 1200) return null;

  try {
    const bbox = getCityBboxParam(location.city);
    const filter = bbox ? `rect:${bbox}|countrycode:tw` : "countrycode:tw";
    const response = await fetchResponse("https://api.geoapify.com/v1/geocode/search", {
      params: {
        text: query,
        apiKey: token,
        format: "json",
        lang: "zh",
        limit: 5,
        filter,
        bias: Number.isFinite(Number(location.lng)) && Number.isFinite(Number(location.lat)) ? `proximity:${location.lng},${location.lat}` : "countrycode:tw",
      },
      timeout: Math.max(800, Math.min(1800, remaining - 300)),
    });
    const payload = await response.json();
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    const candidates = rows.map((row) => ({
      source: "geoapify",
      lat: Number(row.lat),
      lng: Number(row.lon),
      placeName: row.formatted || row.address_line1 || "",
      name: row.name || "",
      formatted: row.formatted || "",
      city: row.city || row.county || row.state || "",
      district: row.suburb || row.district || "",
      featureType: row.result_type || "",
      confidence: Number(row.rank?.confidence),
      context: [row.address_line1, row.address_line2, row.city, row.county, row.state, row.country].filter(Boolean).join(" "),
      query,
    }));
    const ranked = rankGeocodingCandidates(event, location, candidates);
    const result = buildExternalGeocodingResult("geoapify", event, location, query, ranked);
    await writeGeocodingCache("geoapify", location, query, result);
    return result;
  } catch (error) {
    console.warn("[cron] Geoapify geocoding failed:", error.message);
    return null;
  }
}

async function geocodeLocationWithProviders(event, location, startedAt) {
  const mapbox = await geocodeLocationWithMapbox(event, location, startedAt);
  if (mapbox?.locationQuality === "high") return mapbox;
  const geoapify = await geocodeLocationWithGeoapify(event, location, startedAt);
  if (!geoapify) return mapbox;
  if (!mapbox) return geoapify;
  return Number(geoapify.locationConfidence || 0) > Number(mapbox.locationConfidence || 0) ? geoapify : mapbox;
}

async function enrichEventLocations(events, startedAt, stats = {}, options = {}) {
  let geocodingAttempts = 0;
  let geocodingHits = 0;
  const enriched = [];
  for (const event of events) {
    const location = resolveLocationSync(event, { title: event.title, content: event.content });
    let nextEvent = {
      ...event,
      city: normalizeCity(location.city || event.city),
      district: location.district || event.district || "",
      lat: location.lat,
      lng: location.lng,
      locationPrecision: location.locationPrecision,
      locationSource: location.locationSource,
      locationQuery: location.locationQuery,
      locationConfidence: location.locationConfidence,
      locationQuality: location.locationQuality,
      locationDisplayMode: location.locationDisplayMode,
      locationEvidence: location.locationEvidence || event.locationEvidence || event.locationReason || "",
      locationAmbiguity: Boolean(event.locationAmbiguity),
      locationReason: event.locationReason || "",
    };

    if (!options.skipExternalGeocoding && geocodingAttempts < MAX_GEOCODING_PER_CRON && shouldTryExternalGeocoding(nextEvent, location)) {
      geocodingAttempts += 1;
      const geocoded = await geocodeLocationWithProviders(nextEvent, location, startedAt);
      if (geocoded) {
        geocodingHits += 1;
        nextEvent = {
          ...nextEvent,
          lat: geocoded.lat,
          lng: geocoded.lng,
          locationPrecision: geocoded.locationPrecision,
          locationSource: geocoded.locationSource,
          locationQuery: geocoded.locationQuery,
          locationConfidence: geocoded.locationConfidence,
          locationQuality: geocoded.locationQuality,
          locationDisplayMode: geocoded.locationDisplayMode,
          locationEvidence: geocoded.locationEvidence,
          locationCandidates: geocoded.locationCandidates,
        };
      }
    }
    enriched.push(nextEvent);
  }
  stats.geocodingAttempts = geocodingAttempts;
  stats.geocodingHits = geocodingHits;
  console.log(`[cron] location enrichment complete (${geocodingHits}/${geocodingAttempts} external geocoding hits)`);
  return enriched;
}

function isFreshEvent(event, now = Date.now()) {
  const expiresAt = parseEventTime(event.expiresAt);
  if (expiresAt) return expiresAt > now;
  return (now - (event.createdAt || 0)) < 48 * 60 * 60 * 1000;
}

function isDuplicateEvent(newEvent, existingEventsList) {
  const newTitle = (newEvent.title || "").replace(/\s+/g, "").slice(0, 15);
  const newContent = (newEvent.content || "").replace(/\s+/g, "").slice(0, 30);

  return existingEventsList.some((event) => {
    const existTitle = (event.title || "").replace(/\s+/g, "").slice(0, 15);
    const existContent = (event.content || "").replace(/\s+/g, "").slice(0, 30);

    if (newTitle === existTitle) return true;
    if (newContent === existContent && newContent.length > 10) return true;

    if (event.city === newEvent.city && event.category === newEvent.category && event.category !== "activity") {
      let sameCount = 0;
      for (const char of newTitle) {
        if (existTitle.includes(char)) sameCount++;
      }
      if (sameCount >= 5) return true;
    }
    return false;
  });
}

function findDuplicateForMerge(newEvent, existingEventsList) {
  const newTitle = (newEvent.title || "").replace(/\s+/g, "").slice(0, 15);
  return existingEventsList.find((event) =>
    (event.title || "").replace(/\s+/g, "").slice(0, 15) === newTitle
  );
}

function mergeRefreshEvents(existingEvents, newEvents, now = Date.now()) {
  const mergedEvents = [...(Array.isArray(existingEvents) ? existingEvents : [])];

  for (const newEvent of (Array.isArray(newEvents) ? newEvents : [])) {
    if (!isDuplicateEvent(newEvent, mergedEvents)) {
      mergedEvents.push(enrichCronEvent({ ...newEvent, createdAt: newEvent.createdAt || now }));
      continue;
    }

    const existing = findDuplicateForMerge(newEvent, mergedEvents);
    if (existing) {
      if ((newEvent.title || "").length > (existing.title || "").length) existing.title = newEvent.title;
      if ((newEvent.content || "").length > (existing.content || "").length) existing.content = newEvent.content;
      if (Number(newEvent.locationConfidence || 0) > Number(existing.locationConfidence || 0)) {
        Object.assign(existing, {
          lat: newEvent.lat,
          lng: newEvent.lng,
          locationPrecision: newEvent.locationPrecision,
          locationSource: newEvent.locationSource,
          locationConfidence: newEvent.locationConfidence,
          locationQuality: newEvent.locationQuality,
          locationDisplayMode: newEvent.locationDisplayMode,
          locationEvidence: newEvent.locationEvidence,
          locationReason: newEvent.locationReason,
        });
      }
    }
  }

  return mergedEvents.map(enrichCronEvent).filter((event) => isFreshEvent(event, now));
}

function emptySources() {
  return {
    rssItems: [],
    tdxEvents: [],
  constructionEvents: [],
  cultureActivityEvents: [],
  tourismEvents: [],
    kktixActivityEvents: [],
    activityEvents: [],
    aiEvents: [],
    ruleBasedEvents: [],
  };
}

function collectorResult(status, reason, startedAt, items = [], extra = {}) {
  return { status, reason: reason || null, durationMs: Math.max(0, Date.now() - startedAt), requestCount: 0, fetchedCount: items.length, parsedCount: items.length, keptCount: items.length, duplicateCount: 0, rejectedCount: 0, error: null, items, ...extra };
}
async function runCollector(name, work, options = {}) {
  const startedAt = Date.now();
  if (options.skipReason) return collectorResult("skipped", options.skipReason, startedAt, []);
  try {
    const items = await work();
    if (!Array.isArray(items)) throw new Error(`${name} returned an invalid response`);
    const detail = items.collector || {}; return collectorResult(detail.status || "success", null, startedAt, items, { requestCount: Math.max(1, Number(options.requestCount) || 1), subrequests: detail.subrequests || [], successfulSubrequestCount: detail.successfulSubrequestCount || 0, failedSubrequestCount: detail.failedSubrequestCount || 0 });
  } catch (error) {
    return collectorResult("failed", cleanRefreshLogError(error?.message) || `${name} failed`, startedAt, [], { error: cleanRefreshLogError(error?.stack || error?.message), requestCount: Math.max(1, Number(options.requestCount) || 1) });
  }
}

function normalizeSourceData(sourceData = {}) {
  const normalized = {
    ...emptySources(),
    ...Object.fromEntries(Object.entries(sourceData).filter(([key]) => key !== "__sourceFailures").map(([key, value]) => [key, Array.isArray(value) ? value : []])),
  };
  normalized.__sourceFailures = sourceData.__sourceFailures && typeof sourceData.__sourceFailures === "object" ? sourceData.__sourceFailures : {};
  normalized.__collectorResults = sourceData.__collectorResults && typeof sourceData.__collectorResults === "object" ? sourceData.__collectorResults : {};
  return normalized;
}

async function fetchDefaultSources(mode, startedAt, options = {}) {
  const includeTraffic = mode !== "news";
  const includeNews = mode !== "traffic";
  const sources = emptySources();
  sources.__sourceFailures = {};
  sources.__collectorResults = {};
  const sourceFailure = (name, error) => {
    sources.__sourceFailures[name] = cleanRefreshLogError(error?.message || error) || "來源抓取失敗";
  };

  let sharedAccessToken = await getCachedValue("tdx_access_token");
  if (includeTraffic && !sharedAccessToken && process.env.TDX_CLIENT_ID && process.env.TDX_CLIENT_SECRET) {
    try {
      sharedAccessToken = await fetchTDXAccessToken(startedAt);
      if (sharedAccessToken) {
        await setCachedValue("tdx_access_token", sharedAccessToken, { ex: 43200 });
      }
    } catch (error) {
      console.warn("[cron] Failed to get TDX token:", error.message);
    }
  }

  if (includeTraffic) {
    const missingTdx = !sharedAccessToken && (!process.env.TDX_CLIENT_ID || !process.env.TDX_CLIENT_SECRET) ? "缺少 TDX_CLIENT_ID 或 TDX_CLIENT_SECRET" : "";
    sources.__collectorResults.tdxTraffic = await runCollector("TDX 即時交通", () => fetchTDXTrafficEvents(startedAt, sharedAccessToken), { skipReason: missingTdx });
    sources.tdxEvents = sources.__collectorResults.tdxTraffic.items;
    if (sources.__collectorResults.tdxTraffic.status === "failed") sourceFailure("tdxTraffic", sources.__collectorResults.tdxTraffic.reason);
    await delay(Number(options.tdxDelayMs ?? 1000));
    sources.__collectorResults.tdxConstruction = await runCollector("TDX 施工資訊", () => fetchTDXConstructionEvents(sharedAccessToken, startedAt), { skipReason: missingTdx });
    sources.constructionEvents = sources.__collectorResults.tdxConstruction.items;
    if (sources.__collectorResults.tdxConstruction.status === "failed") sourceFailure("tdxConstruction", sources.__collectorResults.tdxConstruction.reason);
  }

  if (includeNews) {
    sources.__collectorResults.rss = await runCollector("RSS", async () => (await Promise.all(DEFAULT_RSS_SOURCES.map((url) => fetchOneRssFeed(url, startedAt)))).flat()); sources.rssItems = sources.__collectorResults.rss.items;
    sources.ruleBasedEvents = extractRuleBasedEvents(sources.rssItems);
    const azureOpenAiConfig = getAzureOpenAiConfig();
    sources.__collectorResults.ai = await runCollector("AI 提取", () => extractAiEventsWithContext(sources.rssItems, startedAt), { skipReason: options.skipAi ? "AI 提取已停用" : (!sources.rssItems.length ? "沒有可供 AI 提取的來源資料" : (azureOpenAiConfig.error || "")) }); sources.aiEvents = sources.__collectorResults.ai.items;
    if (sources.__collectorResults.ai.status === "failed") sourceFailure("ai", sources.__collectorResults.ai.reason);
    sources.__collectorResults.iculture = await runCollector("iCulture 活動", () => fetchCultureActivityEvents(startedAt));
    sources.cultureActivityEvents = sources.__collectorResults.iculture.items;
    if (sources.__collectorResults.iculture.status === "failed") sourceFailure("iculture", sources.__collectorResults.iculture.reason);
    sources.__collectorResults.tourismEvents = await runCollector("觀光署活動", () => fetchTourismEvents(startedAt));
    sources.tourismEvents = sources.__collectorResults.tourismEvents.items;
    if (sources.__collectorResults.tourismEvents.status === "failed") sourceFailure("tourismEvents", sources.__collectorResults.tourismEvents.reason);
    sources.__collectorResults.kktix = await runCollector("KKTIX 活動", () => fetchKktixActivityEvents(startedAt));
    sources.kktixActivityEvents = sources.__collectorResults.kktix.items;
    sources.activityEvents = [...sources.cultureActivityEvents, ...sources.tourismEvents, ...sources.kktixActivityEvents];
    if (sources.__collectorResults.kktix.status === "failed") sourceFailure("kktix", sources.__collectorResults.kktix.reason);
  }

  return sources;
}

async function collectRefreshSources(mode, startedAt, options = {}) {
  if (typeof options.fetchSources === "function") {
    return normalizeSourceData(await options.fetchSources({ mode, startedAt }));
  }
  if (options.sourceData) return normalizeSourceData(options.sourceData);
  return fetchDefaultSources(mode, startedAt, options);
}

function getSourceCounts(sources, finalEvents, activeEvents) {
  return {
    rssItems: sources.rssItems.length,
    tdx: sources.tdxEvents.length,
    construction: sources.constructionEvents.length,
    iCulture: sources.cultureActivityEvents.length,
    tourismEvents: sources.tourismEvents.length,
    activities: sources.activityEvents.length,
    ai: sources.aiEvents.length,
    ruleBased: sources.ruleBasedEvents.length,
    normalized: finalEvents.length,
    active: activeEvents.length,
  };
}

const REFRESH_SOURCE_FIELDS = Object.freeze([
  ["rss", "rssItems", "RSS 新聞"], ["tdxTraffic", "tdxEvents", "TDX 即時交通"],
  ["tdxConstruction", "constructionEvents", "TDX 施工資訊"], ["iculture", "cultureActivityEvents", "iCulture 活動"], ["tourismEvents", "tourismEvents", "觀光署活動"], ["kktix", "kktixActivityEvents", "KKTIX 活動"],
  ["ai", "aiEvents", "AI 提取事件"], ["ruleBased", "ruleBasedEvents", "規則式提取事件"],
]);

function refreshItemKey(item = {}) {
  return String(item.eventFingerprint || item.id || item.url || item.sourceUrl || `${item.title || ""}:${item.city || ""}`).trim().toLowerCase();
}

function toRefreshItem(item, source, finalByKey, outcome = {}) {
  const key = refreshItemKey(item);
  const final = finalByKey.get(key);
  const isRss = source === "RSS 新聞";
  const result = outcome.result || (final ? "accepted" : (isRss ? "fetched" : "filtered"));
  const reason = outcome.reason || (final ? "已進入最終地圖事件" : (isRss ? "原始新聞已抓取，等待事件提取" : "未保留於標準化或內容篩選流程"));
  return {
    title: item.title || item.name || "(無標題)", source, url: item.url || item.sourceUrl || "",
    fetchedAt: item.fetchedAt || item.publishedAt || item.createdAt || "", category: item.category || "",
    location: [item.city, item.district, item.address, item.venue].filter(Boolean).join(" "), processingResult: result,
    processingReason: reason,
    eventId: final?.id || "",
  };
}

function buildRefreshRunDetails({ runId, mode, trigger, startedAt, completedAt, status, sources, finalEvents, activeEvents, geocodingStats, cacheWritten, sourceFailures }) {
  const finalByKey = new Map(finalEvents.map((item) => [refreshItemKey(item), item]));
  const existingByKey = new Set(activeEvents.map(refreshItemKey));
  const seenCandidates = new Set();
  const sourceFailureMap = sourceFailures || {};
  const sourceDetails = Object.fromEntries(REFRESH_SOURCE_FIELDS.map(([detailKey, field, label]) => {
    const failure = cleanRefreshLogError(sourceFailureMap[detailKey]);
    const items = failure ? [] : sources[field].map((item) => {
      const key = refreshItemKey(item);
      if (detailKey !== "rss" && key && seenCandidates.has(key)) return toRefreshItem(item, label, finalByKey, { result: "duplicate", reason: "與本次抓取的事件重複" });
      if (detailKey !== "rss" && key) seenCandidates.add(key);
      if (detailKey !== "rss" && !finalByKey.has(key) && existingByKey.has(key)) return toRefreshItem(item, label, finalByKey, { result: "merged", reason: "合併至既有事件" });
      return toRefreshItem(item, label, finalByKey);
    });
    const collector = sources.__collectorResults?.[detailKey];
    const collectorStatus = collector?.status === "failed" ? "failed" : (collector?.status || (failure ? "failed" : "success"));
    return [detailKey, { ...(collector || {}), status: collectorStatus, reason: collector?.reason || failure || null, count: sources[field].length, durationMs: collector?.durationMs || 0, error: collector?.error || failure, items }];
  }));
  const candidates = [
    ...sources.tdxEvents, ...sources.constructionEvents, ...sources.activityEvents, ...sources.aiEvents, ...sources.ruleBasedEvents,
  ];
  const candidateKeys = new Set();
  let duplicateCount = 0;
  candidates.forEach((item) => { const key = refreshItemKey(item); if (key && candidateKeys.has(key)) duplicateCount += 1; else candidateKeys.add(key); });
  const rawCount = sources.rssItems.length + sources.tdxEvents.length + sources.constructionEvents.length + sources.activityEvents.length;
  sourceDetails.location = {
    status: "success", count: geocodingStats.geocodingAttempts, durationMs: 0, error: null,
    items: finalEvents.filter((item) => item.locationQuality === "low" || item.locationPrecision === "unknown").slice(0, 100).map((item) => ({
      ...toRefreshItem(item, "外部定位", finalByKey), processingResult: "location_failed", processingReason: "定位信心不足或無法確認地點",
    })),
  };
  return {
    runId, startedAt: new Date(startedAt).toISOString(), completedAt, status, mode, trigger, cacheWritten,
    sources: sourceDetails,
    pipeline: { rawCount, normalizedCount: candidates.length, filteredCount: Math.max(0, candidates.length - finalEvents.length - duplicateCount), duplicateCount, finalCount: finalEvents.length },
    finalEvents: finalEvents.map((item) => ({ ...toRefreshItem(item, item.sourceName || item.source || "最終事件", finalByKey, { result: "accepted", reason: "已寫入地圖事件快取" }), processingResult: "accepted", processingReason: "已寫入地圖事件快取", eventId: item.id || "" })),
    activeEventCount: activeEvents.length,
  };
}

async function runEventRefresh(options = {}) {
  const startedAt = Number(options.startedAt) || Date.now();
  const now = Number(options.now) || Date.now();
  const mode = ["news", "traffic", "all"].includes(options.mode) ? options.mode : "all";
  const runId = String(options.runId || `refresh-${startedAt}-${Math.random().toString(36).slice(2, 8)}`);
  const trigger = ["scheduled", "manual", "unknown"].includes(options.trigger) ? options.trigger : "unknown";

  try {
    console.log(`[event-refresh] start runId=${runId} mode=${mode}`);
    const sources = await collectRefreshSources(mode, startedAt, options);
    const geocodingStats = { geocodingAttempts: 0, geocodingHits: 0 };
    const finalEvents = await enrichEventLocations(normalizeFinalEvents([
      ...sources.tdxEvents,
      ...sources.constructionEvents,
      ...sources.activityEvents,
      ...sources.aiEvents,
      ...sources.ruleBasedEvents,
    ]), startedAt, geocodingStats, {
      skipExternalGeocoding: options.skipExternalGeocoding,
    });

    const existingEvents = Array.isArray(options.existingEvents)
      ? options.existingEvents
      : await getOfficialEvents();
    const activeEvents = mergeRefreshEvents(existingEvents, finalEvents, now);
    const cacheTtlSeconds = resolveEventCacheTtlSeconds(options.cacheTtlSeconds ?? process.env.EVENT_CACHE_TTL_SECONDS);
    const cacheOptions = { ex: cacheTtlSeconds };
    let buckets = { traffic: 0, news: 0, activities: 0 };

    if (options.write !== false) {
      await setOfficialEvents(activeEvents, cacheOptions);
      await createEventCandidates(finalEvents.map((event) => ({ source: event.sourceName || event.source || "refresh", status: "published", publishedEventId: event.id, batchId: runId, rawSourceData: event, event })), { batchId: runId });
      buckets = await writeEventBucketsToStore(activeEvents, cacheOptions);
    }

    const durationMs = Date.now() - startedAt;
    const sourceCounts = getSourceCounts(sources, finalEvents, activeEvents);
    const sourceFailures = Object.fromEntries(Object.entries({ ...(sources.__sourceFailures || {}), ...(options.sourceFailures || {}) }).map(([key, value]) => [key, cleanRefreshLogError(value)]).filter(([, value]) => value));
    const errorSourceCount = Object.keys(sourceFailures).length;
    const status = errorSourceCount ? "partial_success" : "success";
    const completedAt = new Date().toISOString();
    const details = buildRefreshRunDetails({ runId, mode, trigger, startedAt, completedAt, status, sources, finalEvents, activeEvents, geocodingStats, cacheWritten: options.write !== false, sourceFailures });
    const result = {
      success: status === "success",
      status,
      runId,
      mode,
      durationMs,
      count: activeEvents.length,
      cacheTtlSeconds,
      buckets,
      sourceCounts,
      geocodingAttempts: geocodingStats.geocodingAttempts,
      geocodingHits: geocodingStats.geocodingHits,
      rawCount: details.pipeline.rawCount,
      errorSourceCount,
      events: activeEvents,
    };

    if (options.write !== false) {
      await setRefreshStatus({
        status,
        runId,
        mode,
        count: activeEvents.length,
        cacheTtlSeconds,
        durationMs,
        sourceCounts,
        geocodingAttempts: geocodingStats.geocodingAttempts,
        geocodingHits: geocodingStats.geocodingHits,
        completedAt,
      });
      await appendRefreshLog({ ...result, trigger, status, startedAt: new Date(startedAt).toISOString(), completedAt, cacheWritten: true });
      await saveRefreshRunDetail(details);
      if (activeEvents.length === 0) await notifyRefreshAlert("zero_events", "成功抓取後事件數為 0");
      if (errorSourceCount) await notifyRefreshAlert("source_failure", `主要資料來源失敗：${Object.keys(sourceFailures).join(", ")}`);
    }

    console.log(`[event-refresh] complete runId=${runId} count=${activeEvents.length}`);
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (options.write !== false) {
      const completedAt = new Date().toISOString();
      const safeError = cleanRefreshLogError(error?.message);
      await setRefreshStatus({
        status: "error",
        runId,
        mode,
        durationMs,
        error: safeError,
        completedAt,
      });
      await appendRefreshLog({ runId, trigger, mode, status: "error", startedAt: new Date(startedAt).toISOString(), completedAt, durationMs, error: safeError });
      await saveRefreshRunDetail({ runId, trigger, mode, status: "error", startedAt: new Date(startedAt).toISOString(), completedAt, cacheWritten: false, error: safeError, sources: {}, pipeline: {}, finalEvents: [] });
      await notifyRefreshAlert("refresh_failure", `抓取執行失敗：${safeError}`);
    }
    console.error("[event-refresh] failed:", error.message);
    throw error;
  }
}

module.exports = {
  createAzureOpenAiChatCompletion,
  collectRefreshSources,
  runCollector,
  DEFAULT_EVENT_CACHE_TTL_SECONDS,
  enrichCronEvent,
  enrichEventLocations,
  fetchKktixActivityEvents,
  fetchCultureActivityEvents,
  fetchTourismEvents,
  normalizeTourismEvent,
  extractZipJson,
  fetchResponse,
  buildMapboxQuery,
  getMapboxProximity,
  getCityBboxParam,
  geocodeLocationWithMapbox,
  buildKktixResponseDiagnostic,
  fetchDefaultSources,
  isGenericCmsNotice,
  isDuplicateEvent,
  mergeRefreshEvents,
  normalizeFinalEvents,
  parseKktixMeta,
  sanitizeKktixBodyPreview,
  resolveEventCacheTtlSeconds,
  runEventRefresh,
};
