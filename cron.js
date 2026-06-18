require("dotenv").config();
const { getCachedEvents, getCachedValue, setCachedEvents, setCachedValue } = require("./event-store");

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
const { normalizeEventsForFrontend } = require("./event-normalizer");

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
const MAX_NEWS_FOR_AI = 8;
const SOFT_DEADLINE_MS = 7000;
const TDX_PUBLIC_SOURCE_LIMIT = 2;
const TDX_STATIC_CACHE_MS = 1000 * 60 * Number(process.env.TDX_STATIC_CACHE_MINUTES || 360);
const TDX_LIVE_CACHE_MS = 1000 * 60 * Number(process.env.TDX_LIVE_CACHE_MINUTES || 30);
const TDX_CONSTRUCTION_CACHE_MS = 1000 * 60 * Number(process.env.TDX_CONSTRUCTION_CACHE_MINUTES || 360);
const TDX_BACKOFF_MS = 1000 * 60 * Number(process.env.TDX_BACKOFF_MINUTES || 60);
const TDX_STATIC_CACHE_KEY = "tdx:static_cms";
const TDX_LIVE_CACHE_KEY = "tdx:live_cms_events";
const TDX_CONSTRUCTION_CACHE_KEY = "tdx:construction_events";

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

function extractRuleBasedEvents(newsItems) {
  const seen = new Set();
  return newsItems
    .map((item) => {
      const title = String(item.title || "").trim();
      const content = cleanNewsText(item.contentSnippet || item.content || "");
      const combinedText = `${title} ${content}`;
      const cityInfo = inferCityFromText(combinedText);

      if (!cityInfo || !title) return null;

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

function normalizeFinalEvents(events) {
  const dedupe = new Set();
  return events
    .filter((item) => {
      const lat = Number(item.lat);
      const lng = Number(item.lng);
      return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 21 && lat <= 26.5 && lng >= 118 && lng <= 123;
    })
    .map((item) => ({
      ...item,
      title: String(item.title || "").trim(),
      content: String(item.content || "").trim(),
      city: String(item.city || "Taiwan").trim(),
      source: String(item.source || "news").trim(),
      url: String(item.url || "").trim(),
      lat: Number(item.lat),
      lng: Number(item.lng),
    }))
    .filter((item) => {
      const key = item.eventFingerprint || `${item.city}:${item.title.slice(0, 50)}:${item.category}`.toLowerCase();
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      return true;
    });
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
    
    const rssItems = rssResults.flat();
    const ruleBasedEvents = extractRuleBasedEvents(rssItems);
    const aiEvents = await extractAiEvents(rssItems);
    
    const finalEvents = normalizeFinalEvents(
      [...tdxEvents, ...constructionEvents, ...aiEvents, ...ruleBasedEvents]
    );

    // --- 內部寫入 KV 前加強去重 (同一事件只保留一筆) ---
    // 獲取現有資料進行比對
    const existingEvents = normalizeEventsForFrontend(await getCachedEvents());

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
            if (ev.city === newEvent.city && ev.category === newEvent.category) {
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
            mergedEvents.push({ ...newEv, createdAt: Date.now() });
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
    const activeEvents = normalizeEventsForFrontend(mergedEvents).filter(ev => (now - (ev.createdAt || 0)) < 48 * 60 * 60 * 1000);

    await setCachedEvents(activeEvents, { ex: 600 });

    return res.status(200).json({ success: true, count: activeEvents.length });
  } catch (error) {
    console.error("[cron] Handler failed:", error.message);
    return res.status(500).json({ error: "Cron execution failed" });
  }
};
