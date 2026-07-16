require("dotenv").config();
const {
  getCachedEvents,
  getCachedValue,
  setCachedEvents,
  setCachedValue,
  setRefreshStatus,
  appendRefreshLog,
  cleanRefreshLogError,
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
  isCoordInCity,
  isValidTaiwanCoord,
  makeGeocodingCacheKey,
  normalizeCity,
  rankGeocodingCandidates,
  resolveLocationSync,
  withLocationQuality,
} = require("./location-resolver");
const { classifyEventVisibility, isLowRealtimeEvent } = require("./event-content-filter");

const Parser = require("rss-parser");
const axios = require("axios");
const os = require("os");
const fs = require("fs");
const path = require("path");

// ?? ??????????????????????
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const parser = new Parser();

const openaiApiKey = process.env.OPENAI_API_KEY;
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

const DEFAULT_RSS_SOURCES = [
  "https://news.ltn.com.tw/rss/all.xml",
  "https://udn.com/rssfeed/news/2/6638?ch=news",
  "https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
];

const RSS_TIMEOUT_MS = 2200;
const TDX_TIMEOUT_MS = 1800;
const OPENAI_TIMEOUT_MS = 5000;
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
    const xmlResponse = await axios.get(rssUrl, {
      timeout: Math.max(800, Math.min(RSS_TIMEOUT_MS, getRemainingTime(startedAt) - 200)),
      responseType: "text",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });
    const feed = await parser.parseString(String(xmlResponse.data || ""));
    return feed.items || [];
  } catch (error) {
    console.warn(`[cron] RSS fetch failed for ${rssUrl}:`, error.message);
    return [];
  }
}

async function fetchTDXAccessToken(startedAt) {
  const response = await axios.post(
    "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token",
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.TDX_CLIENT_ID,
      client_secret: process.env.TDX_CLIENT_SECRET,
    }),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: Math.max(800, Math.min(TDX_TIMEOUT_MS, getRemainingTime(startedAt) - 200)),
    }
  );
  return response.data?.access_token || "";
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
  const response = await axios.get(url, {
    headers,
    timeout: Math.max(800, Math.min(TDX_TIMEOUT_MS, getRemainingTime(startedAt) - 150)),
  });
  return response.data;
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
    const trafficEvents = [];

    for (const source of sourcesToFetch) {
      if (getRemainingTime(startedAt) < 500) break;
      try {
        const url = buildTdxCmsUrl(source, true);
        const data = await fetchTdxJson(url, headers, startedAt);
        const rawRecords = extractArrayFromTdxPayload(data);
        const staticLookup = staticCache.get(`${source.type}:${source.path}`) || new Map();
        const records = rawRecords.map((item) => normalizeCmsLiveRecord(item, source, staticLookup)).filter(Boolean);
        trafficEvents.push(...records);
      } catch (error) {
        const status = error.response?.status;
        if (status === 429) sawRateLimit = true;
        console.warn(`[cron] TDX live CMS failed for ${source.type}/${source.path}:`, status ? `HTTP ${status}` : error.message);
      }
      await delay(500); // ??? 0.5 ??
    }

    const filteredEvents = trafficEvents.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
    if (sawRateLimit) setBackoffUntil("liveCms", now + TDX_BACKOFF_MS);

    tdxLiveCmsCache = { events: filteredEvents, expiresAt: now + TDX_LIVE_CACHE_MS };
    await setCachedValue(TDX_LIVE_CACHE_KEY, { events: filteredEvents, fetchedAt: now }, { ex: Math.floor(TDX_LIVE_CACHE_MS / 1000) });
    return filteredEvents;
  } catch (error) {
    console.error("[cron] TDX fetch failed:", error.message);
    return [];
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
    const constructionEvents = [];

    for (const source of sourcesToFetch) {
      if (getRemainingTime(startedAt) < 500) break;
      try {
        const url = buildTdxConstructionUrl(source);
        const data = await fetchTdxJson(url, headers, startedAt);
        const rawRecords = extractArrayFromTdxPayload(data);
        const records = rawRecords.map((item) => normalizeCmsConstructionRecord(item, source)).filter(Boolean);
        constructionEvents.push(...records);
      } catch (error) {
        const status = error.response?.status;
        if (status === 429) sawRateLimit = true;
        console.warn(`[cron] TDX construction failed for ${source.type}/${source.path}:`, status ? `HTTP ${status}` : error.message);
      }
      await delay(500); // ??? 0.5 ??
    }

    if (sawRateLimit) setBackoffUntil("construction", now + TDX_BACKOFF_MS);

    tdxConstructionCache = { events: constructionEvents, expiresAt: now + TDX_CONSTRUCTION_CACHE_MS };
    await setCachedValue(TDX_CONSTRUCTION_CACHE_KEY, { events: constructionEvents, fetchedAt: now }, { ex: Math.floor(TDX_CONSTRUCTION_CACHE_MS / 1000) });
    return constructionEvents;
  } catch (error) {
    console.error("[cron] TDX construction fetch failed:", error.message);
    return [];
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
        if (response.status < 500 && response.status !== 429) throw new Error(`HTTP ${response.status}`);
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) { lastError = error; }
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
    await recordEventIntegrationStatus("kktix", { status: "success", lastAttemptAt: attemptedAt, fetchedCount: (feed.items || []).length, insertedCount: result.length, duplicateCount: Math.max(0, (feed.items || []).length - result.length), failedCount: 0, lastErrorType: null });
    return result;
  } catch (error) {
    console.warn("[cron] KKTIX activity fetch failed:", error.message);
    await recordEventIntegrationStatus("kktix", { status: "error", lastAttemptAt: attemptedAt, lastErrorType: error.name === "TimeoutError" ? "timeout" : "request_error", failedCount: 1 });
    return [];
  }
}

async function createOpenAiChatCompletion(body, timeoutMs = OPENAI_TIMEOUT_MS) {
  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(800, timeoutMs)),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const errorBody = await response.json();
      detail = errorBody?.error?.message || errorBody?.error?.code || "";
    } catch {}
    throw new Error(`OpenAI ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  return response.json();
}

function parseOpenAiJsonCompletion(completion) {
  const content = completion?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(content);
}

async function extractAiEvents(newsItems) {
  if (!openaiApiKey || !newsItems.length) return [];

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
    const completion = await createOpenAiChatCompletion({
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
    }, OPENAI_TIMEOUT_MS);

    const parsed = parseOpenAiJsonCompletion(completion);
    return Array.isArray(parsed?.events) ? parsed.events : [];
  } catch (error) {
    console.error("[cron] AI extraction failed:", error.message);
    return [];
  }
}

async function extractAiEventsWithContext(newsItems, startedAt = Date.now()) {
  if (!openaiApiKey || !newsItems.length) return [];

  const simplifiedNews = await prepareNewsContexts(newsItems, {
    axios,
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
    const completion = await createOpenAiChatCompletion({
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
    }, Math.max(800, Math.min(OPENAI_TIMEOUT_MS, getRemainingTime(startedAt) - 300)));

    const parsed = parseOpenAiJsonCompletion(completion);
    return normalizeAiExtractedEvents(parsed?.events);
  } catch (error) {
    console.error("[cron] AI context extraction failed:", error.message);
    return [];
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
  return bounds ? `${bounds.minLng},${bounds.minLat},${bounds.maxLng},${bounds.maxLat}` : "";
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
  const query = buildLocationQuery(event, location.city, event.title, event.content);
  const cached = await readGeocodingCache("mapbox", event, location, query);
  if (cached) return cached;

  const remaining = getRemainingTime(startedAt);
  if (remaining < 1200) return null;

  try {
    const endpoint = useMapboxPermanentGeocoding() ? "mapbox.places-permanent" : "mapbox.places";
    const url = `https://api.mapbox.com/geocoding/v5/${endpoint}/${encodeURIComponent(query)}.json`;
    const bbox = getCityBboxParam(location.city);
    const response = await axios.get(url, {
      params: {
        access_token: token,
        country: "tw",
        language: "zh-Hant",
        limit: 5,
        autocomplete: false,
        proximity: Number.isFinite(Number(location.lng)) && Number.isFinite(Number(location.lat)) ? `${location.lng},${location.lat}` : undefined,
        bbox: bbox || undefined,
      },
      timeout: Math.max(800, Math.min(1800, remaining - 300)),
    });
    const features = Array.isArray(response.data?.features) ? response.data.features : [];
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
    console.warn("[cron] Mapbox geocoding failed:", error.message);
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
    const response = await axios.get("https://api.geoapify.com/v1/geocode/search", {
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
    const rows = Array.isArray(response.data?.results) ? response.data.results : [];
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
    activityEvents: [],
    aiEvents: [],
    ruleBasedEvents: [],
  };
}

function normalizeSourceData(sourceData = {}) {
  return {
    ...emptySources(),
    ...Object.fromEntries(Object.entries(sourceData).map(([key, value]) => [key, Array.isArray(value) ? value : []])),
  };
}

async function fetchDefaultSources(mode, startedAt, options = {}) {
  const includeTraffic = mode !== "news";
  const includeNews = mode !== "traffic";
  const sources = emptySources();

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
    sources.tdxEvents = await fetchTDXTrafficEvents(startedAt, sharedAccessToken);
    await delay(Number(options.tdxDelayMs ?? 1000));
    sources.constructionEvents = await fetchTDXConstructionEvents(sharedAccessToken, startedAt);
  }

  if (includeNews) {
    const rssResults = await Promise.all(DEFAULT_RSS_SOURCES.map((url) => fetchOneRssFeed(url, startedAt)));
    sources.rssItems = rssResults.flat();
    sources.ruleBasedEvents = extractRuleBasedEvents(sources.rssItems);
    sources.aiEvents = options.skipAi ? [] : await extractAiEventsWithContext(sources.rssItems, startedAt);
    sources.activityEvents = await fetchKktixActivityEvents(startedAt);
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
    activities: sources.activityEvents.length,
    ai: sources.aiEvents.length,
    ruleBased: sources.ruleBasedEvents.length,
    normalized: finalEvents.length,
    active: activeEvents.length,
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
      : await getCachedEvents();
    const activeEvents = mergeRefreshEvents(existingEvents, finalEvents, now);
    const cacheTtlSeconds = resolveEventCacheTtlSeconds(options.cacheTtlSeconds ?? process.env.EVENT_CACHE_TTL_SECONDS);
    const cacheOptions = { ex: cacheTtlSeconds };
    let buckets = { traffic: 0, news: 0, activities: 0 };

    if (options.write !== false) {
      await setCachedEvents(activeEvents, cacheOptions);
      buckets = await writeEventBucketsToStore(activeEvents, cacheOptions);
    }

    const durationMs = Date.now() - startedAt;
    const sourceCounts = getSourceCounts(sources, finalEvents, activeEvents);
    const result = {
      success: true,
      runId,
      mode,
      durationMs,
      count: activeEvents.length,
      cacheTtlSeconds,
      buckets,
      sourceCounts,
      geocodingAttempts: geocodingStats.geocodingAttempts,
      geocodingHits: geocodingStats.geocodingHits,
      events: activeEvents,
    };

    if (options.write !== false) {
      const completedAt = new Date().toISOString();
      await setRefreshStatus({
        status: "success",
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
      await appendRefreshLog({ ...result, trigger, status: "success", startedAt: new Date(startedAt).toISOString(), completedAt });
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
    }
    console.error("[event-refresh] failed:", error.message);
    throw error;
  }
}

module.exports = {
  collectRefreshSources,
  DEFAULT_EVENT_CACHE_TTL_SECONDS,
  enrichCronEvent,
  enrichEventLocations,
  fetchKktixActivityEvents,
  fetchDefaultSources,
  isGenericCmsNotice,
  isDuplicateEvent,
  mergeRefreshEvents,
  normalizeFinalEvents,
  parseKktixMeta,
  resolveEventCacheTtlSeconds,
  runEventRefresh,
};
