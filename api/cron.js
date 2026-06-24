require("dotenv").config();
const { getCachedEvents, getCachedValue, setCachedEvents, setCachedValue } = require("../event-store");
const {
  DEFAULT_AI_CONTEXT_LIMIT,
  DEFAULT_ARTICLE_TIMEOUT_MS,
  ARTICLE_CONTEXT_MAX_CHARS,
  normalizeAiExtractedEvents,
  prepareNewsContexts,
} = require("../ai-news-context");
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
} = require("../location-resolver");
const { classifyEventVisibility, isLowRealtimeEvent } = require("../event-content-filter");

const Parser = require("rss-parser");
const axios = require("axios");
let OpenAI = null;
try {
  ({ OpenAI } = require("openai"));
} catch {
  OpenAI = null;
}
const os = require("os");
const fs = require("fs");
const path = require("path");

// 👉 加入延遲小工具
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const parser = new Parser();

const openaiApiKey = process.env.OPENAI_API_KEY;
const openai = openaiApiKey && OpenAI ? new OpenAI({ apiKey: openaiApiKey }) : null;

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
const EVENT_BUCKET_KEYS = {
  traffic: "events:traffic",
  news: "events:news",
  activities: "events:activities",
};
const KKTIX_ACTIVITY_FEED = "https://kktix.com/events.atom";

const TDX_CONSTRUCTION_404_SKIP = new Set(["Taoyuan", "Tainan"]);

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
  { keywords: ["台北", "臺北", "Taipei"], city: "Taipei" },
  { keywords: ["新北", "New Taipei"], city: "New Taipei" },
  { keywords: ["桃園", "Taoyuan"], city: "Taoyuan" },
  { keywords: ["台中", "臺中", "Taichung"], city: "Taichung" },
  { keywords: ["台南", "臺南", "Tainan"], city: "Tainan" },
  { keywords: ["高雄", "Kaohsiung"], city: "Kaohsiung" },
  { keywords: ["基隆", "Keelung"], city: "Keelung", lat: 25.1276, lng: 121.7392 },
  { keywords: ["新竹"], city: "Hsinchu", lat: 24.8138, lng: 120.9675 },
  { keywords: ["苗栗"], city: "Miaoli", lat: 24.5602, lng: 120.8214 },
  { keywords: ["彰化"], city: "Changhua", lat: 24.0817, lng: 120.5384 },
  { keywords: ["南投"], city: "Nantou", lat: 23.9609, lng: 120.9719 },
  { keywords: ["雲林"], city: "Yunlin", lat: 23.7092, lng: 120.4313 },
  { keywords: ["嘉義"], city: "Chiayi", lat: 23.4801, lng: 120.4491 },
  { keywords: ["屏東"], city: "Pingtung", lat: 22.5519, lng: 120.5488 },
  { keywords: ["宜蘭"], city: "Yilan", lat: 24.7021, lng: 121.7378 },
  { keywords: ["花蓮"], city: "Hualien", lat: 23.9872, lng: 121.6015 },
  { keywords: ["台東", "臺東", "Taitung"], city: "Taitung", lat: 22.7583, lng: 121.1444 },
  { keywords: ["澎湖"], city: "Penghu", lat: 23.5712, lng: 119.5793 },
  { keywords: ["金門"], city: "Kinmen", lat: 24.4321, lng: 118.3171 },
  { keywords: ["連江", "馬祖"], city: "Lienchiang", lat: 26.1602, lng: 119.9517 },
];

const CATEGORY_KEYWORDS = [
  { category: "traffic", keywords: ["車禍", "撞", "塞車", "封路", "改道", "交通", "道路", "路段", "國道", "省道"] },
  { category: "disaster", keywords: ["地震", "颱風", "豪雨", "淹水", "坍方", "土石流", "災情", "停電"] },
  { category: "fire", keywords: ["火警", "火災", "燃燒", "爆炸"] },
  { category: "police", keywords: ["警方", "警察", "嫌犯", "逮捕", "詐騙", "槍擊"] },
  { category: "construction", keywords: ["施工", "工程", "開工", "封閉施工", "捷運"] },
  { category: "activity", keywords: ["活動", "演唱會", "展覽", "賽事", "燈會", "遊行", "集會"] },
  { category: "politics", keywords: ["市府", "縣府", "立院", "議會", "總統", "行政院"] },
  { category: "finance", keywords: ["台積電", "投資", "股市", "漲價", "財報"] },
  { category: "social", keywords: ["命案", "受傷", "死亡", "失蹤", "糾紛"] },
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
  const titleBase = roadName || location || `${source.city} 施工`;

  if (!description && !location) return null;

  return {
    title: `${titleBase} - 施工`.slice(0, 120),
    content: (description || location).slice(0, 220),
    category: "construction",
    lat,
    lng,
    city: source.city,
    source: "TDX CMS",
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

// 👉 改用 for...of 的靜態資料抓取
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
    await delay(500); // 煞車 0.5 秒
  }

  if (sawRateLimit) setBackoffUntil("staticCms", now + TDX_BACKOFF_MS);

  tdxStaticCmsCache = { bySource, expiresAt: now + TDX_STATIC_CACHE_MS };
  await setCachedValue(TDX_STATIC_CACHE_KEY, mapStaticCacheToRows(bySource), { ex: Math.floor(TDX_STATIC_CACHE_MS / 1000) });
  return bySource;
}

// 👉 改用 for...of 的動態路況抓取
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
      await delay(500); // 煞車 0.5 秒
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

// 👉 改用 for...of 的施工抓取
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
      await delay(500); // 煞車 0.5 秒
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
  const source = cleanNewsText(text).replace(/臺/g, "台");
  const matches = [...source.matchAll(/([\u4e00-\u9fff]{1,4}(?:區|鄉|鎮|市))/g)].map((match) => match[1]);
  return matches.find((name) => /(?:區|鄉|鎮)$/.test(name))
    || matches.find((name) => /市$/.test(name) && !["台北市", "新北市", "桃園市", "台中市", "台南市", "高雄市", "基隆市", "新竹市", "嘉義市"].includes(name))
    || "";
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
  if (category === "activity") return "活動期間周邊可能有人潮與交通變化。";
  if (category === "traffic" || category === "construction") return "周邊道路可能壅塞或受管制影響。";
  if (category === "accident") return "現場周邊通行與安全可能受影響。";
  if (category === "disaster" || /火災|淹水|坍方|地震|停電|停水/.test(text)) return "周邊民生、交通或安全可能受影響。";
  if (category === "police" || category === "criminal") return "周邊公共安全需留意。";
  return "此事件可能影響周邊活動與通行。";
}

function inferAdvice(event) {
  const category = event.category || "";
  const text = `${event.title || ""} ${event.content || ""} ${event.text || ""}`;
  if (category === "activity") return "前往前請確認活動頁公告、交通方式與入場時間。";
  if (category === "traffic" || category === "construction" || /封閉|管制|壅塞|塞車/.test(text)) return "行經附近請放慢車速，必要時提前改道。";
  if (category === "accident") return "避開事故現場，依警方或現場人員指揮通行。";
  if (category === "disaster" || /火災|淹水|坍方|土石流|地震/.test(text)) return "避免靠近危險區域，留意官方最新公告。";
  if (category === "police" || category === "criminal") return "避免靠近現場，留意警方與地方政府公告。";
  return "前往附近前先確認最新資訊。";
}

function inferSeverity(event) {
  if (Number.isFinite(Number(event.severity))) return Number(event.severity);
  const text = `${event.title || ""} ${event.content || ""} ${event.text || ""}`;
  if (/死亡|身亡|罹難|重傷|氣爆|爆炸|大火|土石流|封閉|停班|停課/.test(text)) return 4;
  if (/車禍|事故|淹水|坍方|火災|槍擊|命案|管制|壅塞/.test(text)) return 3;
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

function parseKktixMeta(item) {
  const text = cleanMultilineText(`${item.content || ""}\n${item.contentSnippet || ""}`);
  const timeLine = text.match(/時間[:：]\s*([^\n]+)/)?.[1]?.trim() || "";
  const locationLine = text.match(/地點[:：]\s*([^\n]+)/)?.[1]?.trim() || "";
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
  try {
    if (getRemainingTime(startedAt) < 1200) return [];
    const response = await fetch(KKTIX_ACTIVITY_FEED, {
      signal: AbortSignal.timeout(Math.max(800, Math.min(RSS_TIMEOUT_MS, getRemainingTime(startedAt) - 200))),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
        meta.timeLine ? `時間：${meta.timeLine}` : "",
        meta.location ? `地點：${meta.location}` : "",
        item.creator ? `主辦：${item.creator}` : "",
      ].filter(Boolean).join("｜");

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

    return events.slice(0, 30);
  } catch (error) {
    console.warn("[cron] KKTIX activity fetch failed:", error.message);
    return [];
  }
}

async function extractAiEvents(newsItems) {
  if (!openai || !newsItems.length) return [];

  const simplifiedNews = newsItems.slice(0, MAX_NEWS_FOR_AI).map((item) => ({
    title: item.title || "",
    content: cleanNewsText(item.contentSnippet || item.content || ""),
    link: item.link || "",
  }));

  const systemPrompt = [
    "Extract only real-world Taiwan events from the provided news.",
    "你是台灣新聞地點解析專家，從內文中擷取精確地點。優先抽取：路名、地標、建築物、公園名稱；次要：區名；最後：縣市名。格式：縣市+區+詳細地點。",
    "Return strict JSON with an events array.",
    "Keep only items with a physical place in Taiwan.",
    "Use one category from the allowed enum.",
    "Deduplication Rule (CRITICAL): If multiple news items describe the same real-world event (even from different perspectives or follow-ups like 'suspect arrested'), output only ONE entry with the most complete title.",
    "Same event criteria: Same location + Same time + Same nature.",
    "Generate a unique 'eventFingerprint' (format: city_type_keyword) for each event; multiple reports of the same event must have the SAME fingerprint.",
    "Use the provided city fallback coordinates when exact coordinates are unknown.",
    "If no Taiwan location is found, return null for that event or omit it.",
    'Set source to "news".',
  ].join(" ");

  try {
    const completion = await openai.chat.completions.create({
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
    });

    const parsed = completion.choices?.[0]?.message?.parsed || JSON.parse(completion.choices?.[0]?.message?.content || "{}");
    return Array.isArray(parsed?.events) ? parsed.events : [];
  } catch (error) {
    console.error("[cron] AI extraction failed:", error.message);
    return [];
  }
}

async function extractAiEventsWithContext(newsItems, startedAt = Date.now()) {
  if (!openai || !newsItems.length) return [];

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
    "Deduplicate reports of the same real-world event into one event.",
    "Same event criteria: Same location + Same time + Same nature.",
    "Generate a unique eventFingerprint in format city_type_keyword.",
    "Use the provided city fallback coordinates when exact coordinates are unknown.",
    "If no Taiwan location is found, omit the event.",
    'Set source to "news".',
  ].join(" ");

  try {
    const completion = await openai.chat.completions.create({
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
    });

    const parsed = completion.choices?.[0]?.message?.parsed || JSON.parse(completion.choices?.[0]?.message?.content || "{}");
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
  if (/^(台灣|國道|省道|Taiwan)$/i.test(query)) return false;
  return /區|鄉|鎮|路|街|巷|館|園|場|廟|部落|市場|濕地|古道|大學|百貨|中心|車站|港|橋/.test(query);
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

async function enrichEventLocations(events, startedAt) {
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

    if (geocodingAttempts < MAX_GEOCODING_PER_CRON && shouldTryExternalGeocoding(nextEvent, location)) {
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
  console.log(`[cron] location enrichment complete (${geocodingHits}/${geocodingAttempts} external geocoding hits)`);
  return enriched;
}

function isFreshEvent(event, now = Date.now()) {
  const expiresAt = parseEventTime(event.expiresAt);
  if (expiresAt) return expiresAt > now;
  return (now - (event.createdAt || 0)) < 48 * 60 * 60 * 1000;
}

async function writeEventBuckets(events) {
  const trafficEvents = events.filter((event) => ["traffic", "construction", "accident"].includes(event.category));
  const activityEvents = events.filter((event) => event.category === "activity");
  const newsEvents = events.filter((event) => !trafficEvents.includes(event) && event.category !== "activity");

  await Promise.all([
    setCachedValue(EVENT_BUCKET_KEYS.traffic, trafficEvents, { ex: 600 }),
    setCachedValue(EVENT_BUCKET_KEYS.news, newsEvents, { ex: 600 }),
    setCachedValue(EVENT_BUCKET_KEYS.activities, activityEvents, { ex: 600 }),
  ]);
}

// ---------- 這裡是 Cron 排程的主進入點 ----------
module.exports = async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn("[cron] 未授權的觸發嘗試");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const startedAt = Date.now();
    console.log("[cron] 開始執行背景資料抓取...");

    let sharedAccessToken = await getCachedValue("tdx_access_token");
    if (!sharedAccessToken && process.env.TDX_CLIENT_ID && process.env.TDX_CLIENT_SECRET) {
      try {
        sharedAccessToken = await fetchTDXAccessToken(startedAt);
        if (sharedAccessToken) {
          await setCachedValue("tdx_access_token", sharedAccessToken, { ex: 43200 }); 
        }
      } catch (error) {
        console.warn("[cron] Failed to get TDX token:", error.message);
      }
    }

    // 👉 拆解大任務，避免瞬間塞爆
    const rssResults = await Promise.all(DEFAULT_RSS_SOURCES.map((url) => fetchOneRssFeed(url, startedAt)));
    
    // 依序執行 TDX 抓取
    const tdxEvents = await fetchTDXTrafficEvents(startedAt, sharedAccessToken);
    await delay(1000); // 抓完路況，休息 1 秒
    const constructionEvents = await fetchTDXConstructionEvents(sharedAccessToken, startedAt);
    const activityEvents = await fetchKktixActivityEvents(startedAt);
    
    const rssItems = rssResults.flat();
    const ruleBasedEvents = extractRuleBasedEvents(rssItems);
    const aiEvents = await extractAiEventsWithContext(rssItems, startedAt);
    
    const finalEvents = await enrichEventLocations(normalizeFinalEvents(
      [...tdxEvents, ...constructionEvents, ...activityEvents, ...aiEvents, ...ruleBasedEvents]
    ), startedAt);

    // --- 內部寫入 KV 前加強去重 (同一事件只保留一筆) ---
    // 獲取現有資料進行比對
    const existingEvents = await getCachedEvents();

    function isDuplicateEvent(newEvent, existingEventsList) {
        const newTitle = (newEvent.title || "").replace(/\s+/g, "").slice(0, 15);
        const newContent = (newEvent.content || "").replace(/\s+/g, "").slice(0, 30);
        
        return existingEventsList.some(ev => {
            const existTitle = (ev.title || "").replace(/\s+/g, "").slice(0, 15);
            const existContent = (ev.content || "").replace(/\s+/g, "").slice(0, 30);
            
            // 標題前15字相同
            if (newTitle === existTitle) return true;
            
            // 內容前30字相同
            if (newContent === existContent && newContent.length > 10) return true;
            
            // 同城市 + 同類別 + 標題有5個以上相同字
            if (ev.city === newEvent.city && ev.category === newEvent.category && ev.category !== "activity") {
                let sameCount = 0;
                for (const char of newTitle) {
                    if (existTitle.includes(char)) sameCount++;
                }
                if (sameCount >= 5) return true;
            }
            return false;
        });
    }

    const mergedEvents = [...existingEvents];
    finalEvents.forEach(newEv => {
        if (!isDuplicateEvent(newEv, mergedEvents)) {
            mergedEvents.push(enrichCronEvent({ ...newEv, createdAt: newEv.createdAt || Date.now() }));
        } else {
            // 如果是重複的，嘗試更新現有事件的內容或標題
            const existing = mergedEvents.find(m => 
                (m.title || "").replace(/\s+/g, "").slice(0, 15) === (newEv.title || "").replace(/\s+/g, "").slice(0, 15)
            );
            if (existing) {
                if ((newEv.title || "").length > (existing.title || "").length) existing.title = newEv.title;
                if ((newEv.content || "").length > (existing.content || "").length) existing.content = newEv.content;
            }
        }
    });

    // 過濾掉過期事件 (例如 48 小時前)
    const now = Date.now();
    const activeEvents = mergedEvents.map(enrichCronEvent).filter(ev => isFreshEvent(ev, now));

    await setCachedEvents(activeEvents, { ex: 600 });
    await writeEventBuckets(activeEvents);

    return res.status(200).json({
      success: true,
      count: activeEvents.length,
      buckets: {
        traffic: activeEvents.filter((event) => ["traffic", "construction", "accident"].includes(event.category)).length,
        news: activeEvents.filter((event) => !["traffic", "construction", "accident", "activity"].includes(event.category)).length,
        activities: activeEvents.filter((event) => event.category === "activity").length,
      },
    });
  } catch (error) {
    console.error("[cron] Handler failed:", error.message);
    return res.status(500).json({ error: "Cron execution failed" });
  }
};
