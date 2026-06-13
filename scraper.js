process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
require("dotenv").config();

const mode = process.argv.includes("--mode=news") ? "news" : 
             process.argv.includes("--mode=traffic") ? "traffic" : "all";

const { Redis } = require("@upstash/redis");

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// 新增清除指令
if (process.argv.includes('--clear-cache')) {
  (async () => {
    await kv.del('taiwan_news_cache');
    await kv.del('taiwan_traffic_cache');
    await kv.del('taiwan_traffic_events');
    await kv.del('events:news');
    await kv.del('events:traffic');
    console.log('✅ KV 快取已清除 (包含新聞、交通及合併事件)');
    process.exit(0);
  })();
}

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;

const AZURE_ENDPOINT = "https://timcs-me2fe94e-eastus2.cognitiveservices.azure.com";
const AZURE_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5.4-mini";
const AZURE_API_VERSION = "2025-01-01-preview";

async function callAzureAI(prompt) {
  // 清理所有非 ASCII + 非中文字元，避免 ByteString 錯誤
  const cleanPrompt = prompt
    .replace(/[\u2010-\u2015\u2212\u2011]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2000-\u200F\u2028\u2029\uFEFF]/g, " ")
    .replace(/[^\x00-\x7F\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/g, " ");

  const body = JSON.stringify({
    messages: [{ role: "user", content: cleanPrompt }],
    max_completion_tokens: 8000,
    temperature: 0,
  });

  // 用 Node.js https module 取代 fetch，完全繞過 ByteString header 問題
  return new Promise((resolve, reject) => {
    const https = require("https");
    const apiKey = (process.env.AZURE_OPENAI_API_KEY || "").replace(/[^\x20-\x7E]/g, "");
    const path = `/openai/deployments/${AZURE_DEPLOYMENT}/chat/completions?api-version=${AZURE_API_VERSION}`;
    
    const options = {
      hostname: "timcs-me2fe94e-eastus2.cognitiveservices.azure.com",
      path,
      method: "POST",
      rejectUnauthorized: false,
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`${res.statusCode} ${data}`));
            return;
          }
          const json = JSON.parse(data);
          resolve(json.choices?.[0]?.message?.content || "");
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

const fetchOptions = {
  headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
};

const todayStr = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });

function parseTWDate(str) {
  if (!str || str.length < 7) return null;
  const year = parseInt(str.substring(0, 3)) + 1911;
  const month = parseInt(str.substring(3, 5)) - 1;
  const day = parseInt(str.substring(5, 7));
  const ts = new Date(year, month, day).getTime();
  return isNaN(ts) ? null : ts;
}

function sanitizeText(str) {
  if (!str) return "";
  return str
    // 替換特殊連字符為普通連字符
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    // 替換特殊引號為普通引號
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // 替換全形空格
    .replace(/\u3000/g, " ")
    // 移除其他非 ASCII 可列印字元以外的特殊符號（保留中文）
    .replace(/[\u0080-\u00FF\u2000-\u206F]/g, "")
    .trim();
}

function cleanRSSContent(text) {
  if (!text) return "";
  return text
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

async function getTDXToken() {
  const res = await fetch("https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.TDX_CLIENT_ID,
      client_secret: process.env.TDX_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`TDX Token 失敗: ${res.status}`);
  const data = await res.json();
  console.log("✅ TDX Token 取得成功");
  return data.access_token;
}

async function fetchTDX(url, token, label, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) {
      const wait = (i + 1) * 30000;
      console.log(`⏳ ${label} 429，等待 ${wait / 1000} 秒後重試...`);
      await delay(wait);
      continue;
    }
    if (!res.ok) {
      console.log(`❌ ${label} 失敗: ${res.status}`);
      return null;
    }
    return await res.json();
  }
  return null;
}

const PBS_REQUEST_TIMEOUT_MS = 15000;
const TDX_REQUEST_TIMEOUT_MS = 5000;
const TDX_PUBLIC_SOURCE_LIMIT = 2;
const TDX_CMS_SOURCES = [
  { type: "Freeway", path: "Freeway", city: "Freeway", lat: 23.8, lng: 120.9 },
  { type: "Highway", path: "Highway", city: "Highway", lat: 23.8, lng: 120.9 },
  { type: "City", path: "Taipei", city: "Taipei", lat: 25.033, lng: 121.5654 },
  { type: "City", path: "NewTaipei", city: "New Taipei", lat: 25.0169, lng: 121.4628 },
  { type: "City", path: "Taoyuan", city: "Taoyuan", lat: 24.9937, lng: 121.3009 },
  { type: "City", path: "Taichung", city: "Taichung", lat: 24.1477, lng: 120.6736 },
  { type: "City", path: "Tainan", city: "Tainan", lat: 22.9997, lng: 120.227 },
  { type: "City", path: "Kaohsiung", city: "Kaohsiung", lat: 22.6273, lng: 120.3014 },
];
const TDX_PRIORITY_SOURCE_KEYS = new Set([
  "Freeway:Freeway",
  "Highway:Highway",
  "City:Taipei",
  "City:NewTaipei",
  "City:Taichung",
  "City:Kaohsiung",
]);

function createTrafficSourceSummary() {
  return {
    status: "not_run",
    liveSource: null,
    liveCount: 0,
    cacheCount: 0,
    usedCache: false,
    pbs: {
      attempted: false,
      success: false,
      count: 0,
      failures: [],
    },
    tdx: {
      attempted: false,
      success: false,
      count: 0,
      failures: [],
      usedCredentials: Boolean(process.env.TDX_CLIENT_ID && process.env.TDX_CLIENT_SECRET),
    },
  };
}

function classifyFetchError(error) {
  const message = String(error?.message || error || "");
  if (error?.name === "AbortError" || message.includes("aborted")) return "timeout";
  if (message.startsWith("HTTP ")) return "http";
  if (message.includes("fetch failed") || message.includes("ECONN") || message.includes("ENOTFOUND")) return "connect";
  return "unknown";
}

function formatFetchError(error) {
  const kind = classifyFetchError(error);
  const message = String(error?.message || error || "unknown error");
  return { kind, message };
}

async function fetchJsonWithRetry(url, options, label, retries = 2, waitMs = 1200) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      lastError = error;
      const { kind, message } = formatFetchError(error);
      console.warn(`⚠️ [${label}] 第 ${attempt}/${retries} 次失敗 (${kind}): ${message}`);
      if (attempt < retries) await delay(waitMs);
    }
  }
  throw lastError;
}

function getTdxHeaders(token = "") {
  const headers = {
    "User-Agent": "TaiwanNewsMap/1.0",
    "Accept": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function buildTdxCmsUrl(source, isLive = false) {
  const basePath = isLive
    ? ["api", "basic", "v2", "Road", "Traffic", "Live", "CMS"]
    : ["api", "basic", "v2", "Road", "Traffic", "CMS"];
  if (source.type === "City") basePath.push("City", encodeURIComponent(source.path));
  else if (source.type === "Highway" || source.type === "Freeway") basePath.push(source.type);
  else throw new Error(`Unsupported TDX source: ${source.type}`);
  return `https://tdx.transportdata.tw/${basePath.join("/")}?$format=JSON`;
}

function getSelectedTdxSources(hasCredentials) {
  const selected = TDX_CMS_SOURCES.filter((source) =>
    TDX_PRIORITY_SOURCE_KEYS.has(`${source.type}:${source.path}`)
  );
  return hasCredentials ? selected : selected.slice(0, TDX_PUBLIC_SOURCE_LIMIT);
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
  const messages = Array.isArray(item.Messages) ? item.Messages : Array.isArray(item.messages) ? item.messages : [];
  const joinedMessage = messages
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (!entry || typeof entry !== "object") return "";
      return String(entry.Text || entry.text || entry.Message || entry.message || entry.DisplayMessage || entry.displayMessage || entry.Msg || "").trim();
    })
    .filter(Boolean)
    .join(" / ");
  const message = String(joinedMessage || item.Text || item.text || item.Message || item.message || item.DisplayMessage || item.displayMessage || item.Msg || "")
    .replace(/\s+/g, " ")
    .trim();

  if (messageStatus === 0 || !message || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const roadName = staticInfo?.roadName || String(item.RoadName || item.roadName || item.LinkName || "").trim();
  const location = staticInfo?.location || String(item.LocationDescription || item.locationDescription || "").trim();
  const titleBase = roadName || location || `${source.city} CMS`;
  const text = `${titleBase} ${message}`.trim();

  return {
    id: `TDX_${source.type}_${source.path}_${cmsId || Math.random().toString(36).slice(2)}`,
    text: text.slice(0, 220),
    title: `${titleBase} - CMS`.slice(0, 120),
    content: message.slice(0, 220),
    category: "traffic",
    lat,
    lng,
    city: staticInfo?.city || source.city,
    source: "TDX CMS",
    isReal: true,
  };
}

async function loadTdxStaticCmsLookup(token, summary) {
  const bySource = new Map();
  const headers = getTdxHeaders(token);
  const sources = getSelectedTdxSources(Boolean(token));

  for (const source of sources) {
    const sourceKey = `${source.type}:${source.path}`;
    try {
      const data = await fetchJsonWithRetry(
        buildTdxCmsUrl(source, false),
        { headers, signal: AbortSignal.timeout(TDX_REQUEST_TIMEOUT_MS) },
        `TDX-static-${source.path}`
      );
      const rawRecords = extractArrayFromTdxPayload(data);
      const lookup = new Map(
        rawRecords
          .map((item) => normalizeCmsStaticRecord(item, source))
          .filter(Boolean)
          .map((item) => [item.cmsId, item])
      );
      bySource.set(sourceKey, lookup);
    } catch (error) {
      const detail = { source: sourceKey, ...formatFetchError(error) };
      summary.tdx.failures.push(detail);
      console.warn(`⚠️ [TDX-static-${source.path}] 失敗 (${detail.kind}): ${detail.message}`);
      bySource.set(sourceKey, new Map());
    }
    await delay(400);
  }

  return bySource;
}

async function fetchTDXTrafficFallback(summary) {
  console.log("⏳ [TDX 備援] 開始抓取 CMS 路況...");
  summary.tdx.attempted = true;

  let token = "";
  if (summary.tdx.usedCredentials) {
    try {
      token = await getTDXToken();
    } catch (error) {
      const detail = { source: "token", ...formatFetchError(error) };
      summary.tdx.failures.push(detail);
      console.warn(`⚠️ [TDX 備援] Token 取得失敗 (${detail.kind}): ${detail.message}`);
    }
  }

  const headers = getTdxHeaders(token);
  const sources = getSelectedTdxSources(Boolean(token));
  const staticLookup = await loadTdxStaticCmsLookup(token, summary);
  const events = [];

  for (const source of sources) {
    const sourceKey = `${source.type}:${source.path}`;
    try {
      const data = await fetchJsonWithRetry(
        buildTdxCmsUrl(source, true),
        { headers, signal: AbortSignal.timeout(TDX_REQUEST_TIMEOUT_MS) },
        `TDX-live-${source.path}`
      );
      const rawRecords = extractArrayFromTdxPayload(data);
      const lookup = staticLookup.get(sourceKey) || new Map();
      const normalized = rawRecords
        .map((item) => normalizeCmsLiveRecord(item, source, lookup))
        .filter(Boolean);
      events.push(...normalized);
      console.log(`✅ [TDX-${source.path}] ${normalized.length} 筆`);
    } catch (error) {
      const detail = { source: sourceKey, ...formatFetchError(error) };
      summary.tdx.failures.push(detail);
      console.warn(`⚠️ [TDX-${source.path}] 失敗 (${detail.kind}): ${detail.message}`);
    }
    await delay(400);
  }

  summary.tdx.count = events.length;
  summary.tdx.success = events.length > 0;
  if (summary.tdx.success) {
    summary.liveSource = "tdx";
    summary.liveCount = events.length;
  }
  return events;
}

async function aiFilterEvents(items) {
  if (items.length === 0) return [];
  const prompt = `你是台灣交通事件篩選器。今天日期是【${todayStr}】。
請分析以下事件，判斷是否為「目前正在發生」且「真實影響用路人」的事件。
特別注意：
1. 如果事件提供的時間資訊(如迄日、完工日、結束日期)早於今天，代表已過期，請務必將 isReal 設為 false！
2. 如果事件描述為「道路施工(一般案件)」且沒有具體的地點街道或施工說明，請將 isReal 設為 false！
3. 施工案件若無法從描述中判斷是否正在進行中，請保守地設為 false。
4. 標題僅含「道路施工」、「一般案件」等通用字眼而無任何具體資訊的，isReal 設為 false。

請回傳 JSON 陣列，每個物件包含：
- id: 原始 id
- isReal: boolean（是否為真實且未過期的事件）
- title: 簡短中文標題（20字內。若政府未提供摘要，請根據標題或事件類型自行生成通順的句子，例如「國道發生壅塞事件」）
- category: "traffic"（壅塞/即時路況）| "accident"（車禍/交通事故）| "construction"（施工管制）| "disaster"（災害意外）| "other"
- ttl_hours: 預計持續小時數（1-24）

只回傳 JSON，不要其他文字。
事件列表：
${JSON.stringify(items.map(i => ({ id: i.id, text: sanitizeText(i.text) })))}`;

  try {
    const text = await callAzureAI(prompt);
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (err) {
    console.error("❌ AI 篩選失敗:", err.message);
    return [];
  }
}

// ==========================================
// 新聞抓取與處理
// ==========================================

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? (m[1] || m[2] || "").trim() : "";
    };
    const title = get("title");
    const link = get("link");
    const description = get("description").replace(/<[^>]+>/g, "").trim();
    const pubDate = get("pubDate");
    if (title && link) {
      items.push({ title, link, description, pubDate });
    }
  }
  return items;
}

async function aiAnalyzeSingleNews(article) {
  const prompt = `你是台灣新聞事件分析器。今天日期是【${todayStr}】。
請分析以下這則單筆新聞，判斷是否符合「嚴格發文審核標準」。

新聞內容：
標題：${sanitizeText(article.title)}
摘要：${sanitizeText(article.description?.slice(0, 200) || "")}

【審核標準】（以下全部符合才發文，只要有任何一點不符合，importance 務必設為 0）：
1. 【嚴重性】必須是以下其中之一：
   - 火災／爆炸／氣爆（有傷亡或重大財損）
   - 交通重大事故（死亡、多人受傷、道路封閉）
   - 天災（地震有感、土石流、淹水影響居民）
   - 刑事重大案件（殺人、搶劫、綁架、重傷）
   - 公共安全威脅（毒化災、工安、停電大規模）
2. 【排除清單】以下一律不發：
   - 輕微違規、開罰、稽查、動物事件、政治、財經、選舉、社會議題、無明確地點的新聞。
3. 【時效性】5小時前以上的舊新聞不發。

【地點解析規則】（非常重要）：
請從這則新聞的標題 and 內容中，找出事件發生的精確地點：
- 優先從「標題」抓取地點，標題有地點就以標題為主。
- 標題沒有地點時，才從內容（摘要）中抓取。
- 只抓取事件的「發生地點」，絕對不是人物的來源地、目的地、戶籍地或就醫地點。
- 地點必須精確到街道或地標，禁止只填縣市名。
- 格式：縣市 + 區 + 詳細地點（例如：台北市松山區台鐵松山火車站）。
- 如果標題與內容完全找不到台灣具體地點，或只能確定到縣市，location 請填 null，不要亂猜，importance 務必設為 0。
- 絕對不要猜測或捏造地點。

【回傳格式】：
請回傳 JSON 物件：
{
  "title": "主標題（20字內）",
  "content": "事件簡短摘要（30-50字）",
  "category": "criminal" | "traffic" | "disaster" | "activity",
  "location": "精確地點（縣市+區+詳細地點）",
  "importance": 0-10,
  "eventFingerprint": "縣市_類型_關鍵字",
  "ttl_hours": 預計持續小時數
}

只回傳 JSON，不要其他文字。`;

  try {
    const text = await callAzureAI(prompt);
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (err) {
    console.error(`❌ 新聞 AI 分析失敗 [${article.title.slice(0, 10)}]:`, err.message);
    return null;
  }
}

// 台灣縣市中心座標對照表（Nominatim 429 時的 fallback）
const TAIWAN_CITY_COORDS = {
  "台北市": { lat: 25.0330, lng: 121.5654 },  // 台北市中心（忠孝東路）
  "新北市": { lat: 25.0120, lng: 121.4628 },  // 板橋市中心
  "桃園市": { lat: 24.9936, lng: 121.3010 },  // 桃園市中心
  "台中市": { lat: 24.1477, lng: 120.6736 },  // 台中市中心
  "台南市": { lat: 23.1728, lng: 120.2793 },  // 台南市中心（來源：月沙生活通）
  "高雄市": { lat: 22.6273, lng: 120.3014 },  // 高雄市中心
  "基隆市": { lat: 25.1276, lng: 121.7392 },  // 基隆市中心
  "新竹市": { lat: 24.8138, lng: 120.9675 },  // 新竹市中心
  "新竹縣": { lat: 24.8387, lng: 121.0177 },  // 新竹縣中心
  "苗栗縣": { lat: 24.5602, lng: 120.8214 },  // 苗栗縣中心
  "彰化縣": { lat: 24.0518, lng: 120.5161 },  // 彰化縣中心
  "南投縣": { lat: 23.9609, lng: 120.9718 },  // 南投縣中心
  "雲林縣": { lat: 23.7092, lng: 120.4313 },  // 雲林縣中心
  "嘉義市": { lat: 23.4800, lng: 120.4491 },  // 嘉義市中心
  "嘉義縣": { lat: 23.4518, lng: 120.2554 },  // 嘉義縣中心
  "屏東縣": { lat: 22.5519, lng: 120.5487 },  // 屏東縣中心
  "宜蘭縣": { lat: 24.7021, lng: 121.7377 },  // 宜蘭縣中心
  "花蓮縣": { lat: 23.9871, lng: 121.6015 },  // 花蓮縣中心
  "台東縣": { lat: 22.7583, lng: 121.1444 },  // 台東縣中心
  "澎湖縣": { lat: 23.5711, lng: 119.5793 },  // 澎湖縣中心
  "金門縣": { lat: 24.4493, lng: 118.3765 },  // 金門縣中心
  "連江縣": { lat: 26.1505, lng: 119.9289 },  // 連江縣中心
  "國道":   { lat: 24.0, lng: 121.0 },
  "省道":   { lat: 24.0, lng: 121.0 },
};

// geocode 失敗計數（同一地名連續失敗就跳過）
const geocodeFailCache = new Map();

function cleanLocationText(location) {
  if (!location) return "";
  return location
    .replace(/（[^）]*）|\([^)]*\)/g, "") // 去掉括號說明文字
    .split(/[，,]/)[0] // 遇到逗號只取第一段
    .replace(/附近|一帶|週邊|路口/g, "") // 去掉模糊詞
    .trim();
}

async function geocode(locationText) {
  if (!locationText) return null;

  // 1. 先查縣市對照表（含部分比對），避免打 Nominatim
  for (const [city, coords] of Object.entries(TAIWAN_CITY_COORDS)) {
    if (locationText.startsWith(city) || locationText === city) {
      // 加小幅隨機 jitter 避免全堆同一點
      const jitter = () => (Math.random() - 0.5) * 0.04;
      return { lat: coords.lat + jitter(), lng: coords.lng + jitter() };
    }
  }

  // 2. 已知失敗的地名直接跳過
  if (geocodeFailCache.get(locationText)) return null;

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationText)}&format=json&limit=1&countrycodes=tw`;
    const res = await fetch(url, {
      headers: { "User-Agent": "TaiwanNewsMap/1.0 (https://github.com/0hankhank0/taiwan-news-map5)" }
    });
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      if (res.status === 429) {
        geocodeFailCache.set(locationText, true); // 限速，記住不要再試
      }
      return null;
    }
    const data = await res.json();
    if (data && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      // 驗證座標在台灣陸地上
      if (isOnTaiwanLand(lat, lng)) {
        return { lat, lng };
      }
    }
  } catch (e) {
    console.error(`❌ Geocode 失敗 [${locationText}]:`, e.message);
  }
  geocodeFailCache.set(locationText, true);
  return null;
}

function isValidTaiwanCoord(lat, lng) {
  return lat >= 21 && lat <= 27 && lng >= 118 && lng <= 123;
}

function isOnTaiwanLand(lat, lng) {
  // 基本台灣陸地範圍（排除大部分海域）
  const TAIWAN_BOUNDS = [
    { minLat: 21.9, maxLat: 25.3, minLng: 120.0, maxLng: 122.0 }, // 本島
    { minLat: 23.3, maxLat: 23.8, minLng: 119.3, maxLng: 119.8 }, // 澎湖
    { minLat: 24.3, maxLat: 24.6, minLng: 118.2, maxLng: 118.5 }, // 金門
    { minLat: 26.1, maxLat: 26.2, minLng: 119.9, maxLng: 120.0 }, // 馬祖
  ];

  return TAIWAN_BOUNDS.some(b =>
    lat >= b.minLat && lat <= b.maxLat &&
    lng >= b.minLng && lng <= b.maxLng
  );
}

async function geocodeWithCity(address, city) {
  if (!address) return null;
  
  const cleanedAddress = cleanLocationText(address);
  const jitter = () => (Math.random() - 0.5) * 0.006; // 約 300 公尺偏移

  // 如果清理後只剩縣市名，直接回傳城市中心點
  if (TAIWAN_CITY_COORDS[cleanedAddress]) {
    const coords = TAIWAN_CITY_COORDS[cleanedAddress];
    return { lat: coords.lat + jitter(), lng: coords.lng + jitter() };
  }

  const fullAddress = cleanedAddress.includes(city) ? cleanedAddress : `${city}${cleanedAddress}`;
  const query = `${fullAddress} 台灣`;
  const coords = await geocode(query);
  
  // 如果座標在陸地上，直接回傳
  if (coords && isOnTaiwanLand(coords.lat, coords.lng)) {
    return coords;
  }
  
  // 失敗就用城市中心點
  const cityCenter = TAIWAN_CITY_COORDS[city];
  if (!cityCenter) {
    console.log(`⚠️ [Geocode] ${city} 無中心座標且地址解析失敗，跳過該事件`);
    return null;
  }

  return { lat: cityCenter.lat + jitter(), lng: cityCenter.lng + jitter() };
}

async function fetchNews() {
  console.log("⏳ [新聞] 開始抓取 RSS...");
  const sources = [
    // ── 自由時報（✅ 穩定可用）──
    { url: "https://news.ltn.com.tw/rss/society.xml",              name: "自由社會" },
    { url: "https://news.ltn.com.tw/rss/local.xml",                name: "自由地方" },

    // ── 中央社 feedburner（✅ 官方 RSS）──
    { url: "https://feeds.feedburner.com/rsscna/social",            name: "中央社社會" },
    { url: "https://feeds.feedburner.com/rsscna/local",             name: "中央社地方" },

    // ── ETtoday feedburner（✅ 即時總覽）──
    { url: "https://feeds.feedburner.com/ettoday/realtime",         name: "ETtoday即時" },

    // ── 公視新聞（✅ 官方 RSS）──
    { url: "https://about.pts.org.tw/rss/XML/newsfeed.xml",         name: "公視新聞" },

    // ── TVBS 社會（需確認）──
    { url: "https://news.tvbs.com.tw/rss/local.xml",                name: "TVBS社會" },

    // ── NOWnews（需確認）──
    { url: "https://www.nownews.com/feed/cat/7",                    name: "NOWnews社會" },

    // ── 聯合報社會（需確認）──
    { url: "https://udn.com/rssfeed/news/2/6638?crsdomain=udn.com", name: "聯合社會" },
  ];

  let allArticles = [];
  for (const source of sources) {
    try {
      const res = await fetch(source.url, fetchOptions);
      if (!res.ok) {
        console.log(`⚠️ [${source.name}] HTTP ${res.status}，跳過`);
        await delay(1000);
        continue;
      }
      const xml = await res.text();
      const items = parseRSS(xml);
      items.forEach((item, i) => {
        allArticles.push({ ...item, id: `NEWS_${source.name}_${i}`, source: "RSS" });
      });
      console.log(`✅ [${source.name}] 抓到 ${items.length} 則`);
    } catch (e) {
      console.error(`❌ [${source.name}] RSS 失敗:`, e.message);
    }
    await delay(1000);
  }

  // ── GDELT 補充新聞 ──
  console.log("📡 [GDELT] 開始抓取補充新聞...");
  const gdeltArticles = await fetchGDELT();
  allArticles.push(...gdeltArticles);
  console.log(`✅ [GDELT] 補充 ${gdeltArticles.length} 筆文字新聞進 AI 篩選`);

  if (allArticles.length === 0) return [];

  // 標題去重：相同標題只保留第一筆
  const seenTitles = new Set();
  allArticles = allArticles.filter(a => {
    const key = a.title.trim();
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });
  console.log(`🗂️ [新聞] 去重後剩 ${allArticles.length} 則`);

  let newsEvents = [];
  for (let i = 0; i < allArticles.length; i++) {
    const article = allArticles[i];
    const ai = await aiAnalyzeSingleNews(article);
    
    if (ai && ai.importance > 0) {
      let coords = null;
      if (ai.lat && ai.lng && isOnTaiwanLand(ai.lat, ai.lng)) {
        coords = { lat: ai.lat, lng: ai.lng };
      } else if (ai.location) {
        // 嘗試解析縣市名
        const cityName = ai.location.slice(0, 3);
        coords = await geocodeWithCity(ai.location, cityName);
      }

      if (coords) {
        newsEvents.push({
          id: article.id || `NEWS_${Math.random().toString(36).slice(2)}`,
          title: cleanRSSContent(ai.title),
          content: cleanRSSContent(ai.content || article.title || ""),
          category: ai.category || "other",
          source: "news",
          url: article.link || article.url || "",
          lat: coords.lat,
          lng: coords.lng,
          city: ai.location,
          isReal: true,
          pubDate: article.pubDate || new Date().toISOString(),
          sources: [{ outlet: article.source || "未知", title: article.title, url: article.link || article.url, id: article.id }],
          createdAt: Date.now(),
          expiresAt: Date.now() + Math.min(ai.ttl_hours || 4, 24) * 60 * 60 * 1000,
        });
      }
    }
    await delay(500); // 逐筆處理間隔，避免 rate limit 並提升準確度
  }

  console.log(`🤖 [新聞] AI 篩選與聚合後剩 ${newsEvents.length} 則相關新聞`);

  // 二次去重邏輯已由 AI 聚合部分取代，但為了保險起見仍可保留或調整
  const seenEventKeys = new Set();
  newsEvents = newsEvents.filter(event => {
    const key = event.eventFingerprint || `${event.city}_${event.category}_${event.title.slice(0, 8)}`;
    if (seenEventKeys.has(key)) return false;
    seenEventKeys.add(key);
    return true;
  });
  console.log(`🔍 [新聞] 最終去重後剩 ${newsEvents.length} 則`);

  // ── GDELT 地理事件 ──
  console.log("📡 [GDELT] 開始抓取地理座標事件...");
  const gdeltGeoEvents = await fetchGDELTGeo();
  gdeltGeoEvents.forEach(e => {
    newsEvents.push({
      id: e.id,
      title: cleanRSSContent(e.title),
      content: `【GDELT 地理事件】${cleanRSSContent(e.title)}`,
      category: "news",
      source: "news",
      url: e.url,
      lat: e.lat,
      lng: e.lng,
      city: e.city,
      isReal: true,
      createdAt: Date.now(),
      expiresAt: Date.now() + 2 * 60 * 60 * 1000, // 2小時 TTL
    });
  });
  console.log(`✅ [GDELT] 新增 ${gdeltGeoEvents.length} 筆地理事件`);

  console.log(`📍 [新聞] 成功定位 ${newsEvents.length} 則，寫入地圖`);
  return newsEvents;
}

async function fetchGDELT() {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=Taiwan%20(sourcecountry:TW%20OR%20sourcelang:zho)&mode=artlist&maxrecords=75&format=json&timespan=15min`;
  
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, fetchOptions);
      if (res.status === 429) {
        const wait = 5000 * (i + 1);
        console.log(`⏳ [GDELT] 429，等待 ${wait / 1000} 秒後重試...`);
        await delay(wait);
        continue;
      }
      if (!res.ok) {
        console.error(`❌ [GDELT] 抓取失敗: ${res.status}`);
        return [];
      }
      
      const data = await res.json();
      const articles = data.articles || [];
      console.log(`📦 [GDELT] 原始筆數: ${articles.length}`);
      
      return articles
        .filter(a => a.title && a.url)
        .map(a => ({
          id: `GDELT_${Buffer.from(a.url).toString("base64").slice(0, 20)}`,
          title: cleanRSSContent(a.title),
          description: cleanRSSContent(a.title),
          url: a.url,
          link: a.url,
          source: "news",
          lat: null,
          lng: null,
          publishedAt: a.seendate,
        }));
    } catch (e) {
      console.error("❌ [GDELT] 錯誤:", e.message);
      if (i < 2) {
        await delay(2000);
        continue;
      }
    }
  }
  return [];
}

async function fetchGDELTGeo() {
  try {
    // GDELT GKG API - 取得有地理座標的台灣事件
    const url = `https://api.gdeltproject.org/api/v2/geo/geo?query=Taiwan&mode=pointdata&format=json&timespan=60min`;
    
    const res = await fetch(url, fetchOptions);
    if (!res.ok) return [];
    
    const data = await res.json();
    const features = data.features || [];
    console.log(`📦 [GDELT GKG] 地理事件筆數: ${features.length}`);
    
    return features
      .filter(f => f.geometry?.coordinates && f.properties?.name && isOnTaiwanLand(f.geometry.coordinates[1], f.geometry.coordinates[0]))
      .map(f => ({
        id: `GDELTGEO_${f.properties.url ? Buffer.from(f.properties.url).toString("base64").slice(0, 20) : Math.random().toString(36).slice(2)}`,
        title: f.properties.name,
        description: f.properties.name,
        url: f.properties.url || "",
        source: "news",
        lat: f.geometry.coordinates[1],  // GeoJSON 是 [lng, lat]
        lng: f.geometry.coordinates[0],
        city: f.properties.countryname || "台灣",
        publishedAt: f.properties.dateadded,
      }));
  } catch (e) {
    console.error("❌ [GDELT GEO] 錯誤:", e.message);
    return [];
  }
}

// ==========================================
// 警廣路況 — 內政部警政署開放資料 API（免費、無需 Token）
// https://data.gov.tw/dataset/15221
// ==========================================

const PBS_CATEGORY_MAP = {
  "車禍": "accident",
  "事故": "accident",
  "撞": "accident",
  "翻車": "accident",
  "追撞": "accident",
  "拋錨": "traffic",
  "拋錨停": "traffic",
  "故障": "traffic",
  "壅塞": "traffic",
  "塞車": "traffic",
  "施工": "construction",
  "工程": "construction",
  "封閉": "construction",
  "管制": "construction",
  "落石": "disaster",
  "坍方": "disaster",
  "淹水": "disaster",
  "土石流": "disaster",
};

function pbsGuessCategory(summary) {
  for (const [keyword, cat] of Object.entries(PBS_CATEGORY_MAP)) {
    if (summary.includes(keyword)) return cat;
  }
  return "traffic";
}

function pbsGuessCity(summary) {
  for (const [city] of Object.entries(TAIWAN_CITY_COORDS)) {
    const alt = city.replace("台", "臺");
    if (summary.includes(city) || summary.includes(alt)) return city;
  }
  if (/國道|高速公路|中山高|北二高/.test(summary)) return "國道";
  if (/省道|台\d+線|縣道/.test(summary)) return "省道";
  return null;
}

async function fetchPBS(summary = createTrafficSourceSummary()) {
  console.log("⏳ [警廣] 開始抓取內政部開放資料 API...");

  const BASE_URL = "https://od.moi.gov.tw/API/pbs/query/roadData";
  const regions = ["N", "M", "S", "E"];

  const allItems = [];
  const seenIds = new Set();

  for (const region of regions) {
    try {
      const url = `${BASE_URL}?region=${region}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "TaiwanNewsMap/1.0",
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        console.warn(`⚠️ [警廣-${region}] HTTP ${res.status}`);
        await delay(2000);
        continue;
      }

      const data = await res.json();
      const records = data?.result?.records || data?.records || (Array.isArray(data) ? data : []);

      let added = 0;
      for (const rec of records) {
        const id = rec.srcId || rec.id || rec.SrcId;
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);

        const summary = sanitizeText(
          rec.roadsection || rec.roadSection || rec.RoadSection ||
          rec.summary || rec.Summary || rec.content || ""
        );
        if (!summary || summary.includes("宣導")) continue;

        allItems.push({ id: `PBS_${id}`, summary, region, raw: rec });
        added++;
      }
      console.log(`✅ [警廣-${region}] ${added} 筆`);
    } catch (e) {
      console.error(`❌ [警廣-${region}] 失敗:`, e.message);
    }
    await delay(1500);
  }

  if (allItems.length === 0) {
    console.warn("⚠️ [警廣] 所有區域均無資料，嘗試備用 URL...");
    return fetchPBSFallback();
  }

  console.log(`🤖 [警廣] 共 ${allItems.length} 筆，送 AI 篩選...`);
  const results = [];

  for (let i = 0; i < allItems.length; i += 20) {
    const batch = allItems.slice(i, i + 20);
    const aiInput = batch.map(item => ({ id: item.id, text: item.summary }));
    const aiResults = await aiFilterEvents(aiInput);

    for (const item of batch) {
      const ai = aiResults.find(r => r.id === item.id);
      if (!ai?.isReal) continue;

      const city = pbsGuessCity(item.summary);
      if (!city) continue;

      const coords = TAIWAN_CITY_COORDS[city];
      if (!coords) continue;

      let lat = coords.lat + (Math.random() - 0.5) * 0.04;
      let lng = coords.lng + (Math.random() - 0.5) * 0.04;

      const rawLat = parseFloat(item.raw?.px || item.raw?.lat || item.raw?.PositionLat || "");
      const rawLng = parseFloat(item.raw?.py || item.raw?.lng || item.raw?.PositionLon || "");
      if (Number.isFinite(rawLat) && Number.isFinite(rawLng) && isOnTaiwanLand(rawLat, rawLng)) {
        lat = rawLat;
        lng = rawLng;
      }

      results.push({
        id: item.id,
        text: item.summary,
        title: ai.title || item.summary.slice(0, 30),
        category: ai.category || pbsGuessCategory(item.summary),
        lat,
        lng,
        city,
        source: "TDX CMS",
        isReal: true,
        createdAt: Date.now(),
        expiresAt: Date.now() + Math.min(ai.ttl_hours || 3, 8) * 60 * 60 * 1000,
      });
    }
    await delay(500);
  }

  console.log(`✅ [警廣] AI 篩選後 ${results.length} 筆有效路況`);
  return results;
}

async function fetchPBSFallback() {
  console.log("⏳ [警廣備用] 嘗試舊版 API...");
  try {
    const url = "https://od.moi.gov.tw/api/v1/rest/datastore/A01010000C-000013-015";
    const res = await fetch(url, {
      headers: { "User-Agent": "TaiwanNewsMap/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const records = data?.result?.records || [];
    console.log(`📦 [警廣備用] 取得 ${records.length} 筆`);

    const results = [];
    for (const rec of records.slice(0, 200)) {
      const summary = sanitizeText(rec.roadsection || rec.summary || "");
      if (!summary || summary.includes("宣導")) continue;

      const city = pbsGuessCity(summary);
      if (!city) continue;
      const coords = TAIWAN_CITY_COORDS[city];
      if (!coords) continue;

      const jitter = () => (Math.random() - 0.5) * 0.04;
      results.push({
        id: `PBSFB_${rec.srcId || Math.random().toString(36).slice(2)}`,
        text: summary,
        title: summary.slice(0, 30),
        category: pbsGuessCategory(summary),
        lat: coords.lat + jitter(),
        lng: coords.lng + jitter(),
        city,
        source: "TDX CMS",
        isReal: true,
        createdAt: Date.now(),
        expiresAt: Date.now() + 3 * 60 * 60 * 1000,
      });
    }

    console.log(`✅ [警廣備用] ${results.length} 筆`);
    return results;
  } catch (e) {
    console.error("❌ [警廣備用] 失敗:", e.message);
    return [];
  }
}


// ==========================================
// 外掛 API：台中市（已停用，改走 TDX）
// ==========================================
async function fetchPBSLegacyFallbackWithSummary(summary) {
  console.log("⏳ [警廣備用] 嘗試舊版 API...");
  try {
    const url = "https://od.moi.gov.tw/api/v1/rest/datastore/A01010000C-000013-015";
    const data = await fetchJsonWithRetry(
      url,
      {
        headers: { "User-Agent": "TaiwanNewsMap/1.0" },
        signal: AbortSignal.timeout(PBS_REQUEST_TIMEOUT_MS),
      },
      "警廣備用"
    );
    const records = data?.result?.records || [];
    console.log(`📦 [警廣備用] 取得 ${records.length} 筆`);

    const results = [];
    for (const rec of records.slice(0, 200)) {
      const summaryText = sanitizeText(rec.roadsection || rec.summary || "");
      if (!summaryText || summaryText.includes("摰??")) continue;

      const city = pbsGuessCity(summaryText);
      if (!city) continue;
      const coords = TAIWAN_CITY_COORDS[city];
      if (!coords) continue;

      const jitter = () => (Math.random() - 0.5) * 0.04;
      results.push({
        id: `PBSFB_${rec.srcId || Math.random().toString(36).slice(2)}`,
        text: summaryText,
        title: summaryText.slice(0, 30),
        category: pbsGuessCategory(summaryText),
        lat: coords.lat + jitter(),
        lng: coords.lng + jitter(),
        city,
        source: "PBS",
        isReal: true,
        createdAt: Date.now(),
        expiresAt: Date.now() + 3 * 60 * 60 * 1000,
      });
    }

    console.log(`✅ [警廣備用] ${results.length} 筆`);
    return results;
  } catch (error) {
    const detail = { source: "A01010000C-000013-015", ...formatFetchError(error) };
    summary.pbs.failures.push(detail);
    console.error(`❌ [警廣備用] 失敗 (${detail.kind}): ${detail.message}`);
    return [];
  }
}

async function fetchPBSWithSummary(summary) {
  console.log("⏳ [警廣] 開始抓取內政部即時路況 API...");
  summary.pbs.attempted = true;

  const BASE_URL = "https://od.moi.gov.tw/API/pbs/query/roadData";
  const regions = ["N", "M", "S", "E"];
  const allItems = [];
  const seenIds = new Set();

  for (const region of regions) {
    const label = `警廣-${region}`;
    try {
      const url = `${BASE_URL}?region=${region}`;
      const data = await fetchJsonWithRetry(
        url,
        {
          headers: {
            "User-Agent": "TaiwanNewsMap/1.0",
            "Accept": "application/json",
          },
          signal: AbortSignal.timeout(PBS_REQUEST_TIMEOUT_MS),
        },
        label
      );
      const records = data?.result?.records || data?.records || (Array.isArray(data) ? data : []);

      let added = 0;
      for (const rec of records) {
        const id = rec.srcId || rec.id || rec.SrcId;
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);

        const summaryText = sanitizeText(
          rec.roadsection || rec.roadSection || rec.RoadSection ||
          rec.summary || rec.Summary || rec.content || ""
        );
        if (!summaryText || summaryText.includes("摰??")) continue;

        allItems.push({ id: `PBS_${id}`, summary: summaryText, region, raw: rec });
        added++;
      }
      console.log(`✅ [${label}] ${added} 筆`);
    } catch (error) {
      const detail = { source: `${BASE_URL}?region=${region}`, ...formatFetchError(error) };
      summary.pbs.failures.push(detail);
      console.error(`❌ [${label}] 失敗 (${detail.kind}): ${detail.message}`);
    }
    await delay(800);
  }

  if (allItems.length === 0) {
    console.warn("⚠️ [警廣] 主要區域端點都沒有拿到資料，改試舊版資料集...");
    const fallbackItems = await fetchPBSLegacyFallbackWithSummary(summary);
    summary.pbs.count = fallbackItems.length;
    summary.pbs.success = fallbackItems.length > 0;
    if (summary.pbs.success) {
      summary.liveSource = "pbs";
      summary.liveCount = fallbackItems.length;
    }
    return fallbackItems;
  }

  console.log(`🤖 [警廣] 共 ${allItems.length} 筆，送 AI 篩選...`);
  const results = [];

  for (let i = 0; i < allItems.length; i += 20) {
    const batch = allItems.slice(i, i + 20);
    const aiInput = batch.map((item) => ({ id: item.id, text: item.summary }));
    const aiResults = await aiFilterEvents(aiInput);

    for (const item of batch) {
      const ai = aiResults.find((entry) => entry.id === item.id);
      if (!ai?.isReal) continue;

      const city = pbsGuessCity(item.summary);
      if (!city) continue;

      const coords = TAIWAN_CITY_COORDS[city];
      if (!coords) continue;

      let lat = coords.lat + (Math.random() - 0.5) * 0.04;
      let lng = coords.lng + (Math.random() - 0.5) * 0.04;

      const rawLat = parseFloat(item.raw?.px || item.raw?.lat || item.raw?.PositionLat || "");
      const rawLng = parseFloat(item.raw?.py || item.raw?.lng || item.raw?.PositionLon || "");
      if (Number.isFinite(rawLat) && Number.isFinite(rawLng) && isOnTaiwanLand(rawLat, rawLng)) {
        lat = rawLat;
        lng = rawLng;
      }

      results.push({
        id: item.id,
        text: item.summary,
        title: ai.title || item.summary.slice(0, 30),
        category: ai.category || pbsGuessCategory(item.summary),
        lat,
        lng,
        city,
        source: "PBS",
        isReal: true,
        createdAt: Date.now(),
        expiresAt: Date.now() + Math.min(ai.ttl_hours || 3, 8) * 60 * 60 * 1000,
      });
    }
    await delay(500);
  }

  summary.pbs.count = results.length;
  summary.pbs.success = results.length > 0;
  if (summary.pbs.success) {
    summary.liveSource = "pbs";
    summary.liveCount = results.length;
  }
  console.log(`✅ [警廣] AI 篩選後 ${results.length} 筆有效路況`);
  return results;
}

async function fetchTaichung() {
  console.log("ℹ️  台中市改由 TDX City/Taichung 統一抓取，此函式已退役");
  return [];
}

// ==========================================
// 主程式
// ==========================================

// 【修復】同座標事件抖動，避免地圖堆疊成一圈
function jitterCoord(lat, lng, index) {
  if (index === 0) return { lat, lng };
  // 每筆偏移約 50~150 公尺，依 index 螺旋分散
  const angle = (index * 137.5) * (Math.PI / 180); // 黃金角分散
  const radius = 0.0005 + index * 0.0002;
  return {
    lat: lat + radius * Math.sin(angle),
    lng: lng + radius * Math.cos(angle),
  };
}

// 【修復】判斷是否為無意義的施工通用案件
function isEmptyConstructionEvent(summary, eventTypeName, locationOther = "") {
  if (!summary) {
    // 沒有摘要且類型包含施工/一般案件 → 過濾
    if (
      eventTypeName?.includes("施工") ||
      eventTypeName?.includes("一般案件") ||
      eventTypeName?.includes("道路")
    ) return true;
  }
  // 摘要只有通用字眼，無具體資訊
  const genericPatterns = [
    /^道路施工[（(]?一般案件[）)]?$/,
    /^一般案件$/,
    /^道路施工$/,
    /^施工管制$/,
    /^道路維護$/,
  ];
  if (genericPatterns.some(p => p.test(summary?.trim()))) {
    // ✅ 修復：Location.Other 有具體地址則保留，不過濾
    if (locationOther && locationOther.trim().length > 5) return false;
    return true;
  }
  return false;
}


// ===== Threads 自動發文 =====
const THREADS_USER_ID = process.env.THREADS_USER_ID;
const THREADS_TOKEN   = process.env.THREADS_ACCESS_TOKEN;

const THREADS_POST_PROMPT = `
你是台灣高中生，正在經營即時事件地圖 @nowmap_tw。

根據以下事件發一則 Threads 貼文。

嚴格規定：
- 全文不超過 30 字（不含網址）
- 只講一件事，不要同時提多個事件
- 不要有標題、不要條列、不要說「更新」
- 直接講重點，像朋友傳訊息的感覺
- 結尾一個 emoji 就好

好的範例：
「高雄左營剛發生車禍，現場還在處理 🚨
taiwan-news-map.vercel.app」

「彰化兒童公園半夜失火，縱火犯被抓了 🔥
taiwan-news-map.vercel.app」

不好的範例：
「🗺️ 地圖更新！今日發生以下事件：1. xxx 2. yyy」

事件資料：
{events}
`;

function shouldPost(event) {
  const title = (event.title || event.text || "").toLowerCase();
  const cat   = event.category || "";

  // 重大事故：死亡、多人傷亡
  if (cat === "accident" && /死亡|死[0-9]|[0-9]死|多人傷|重傷|[3-9]人傷|[1-9][0-9]人/.test(title)) return true;
  // 火災災害 (加嚴篩選：火災、爆炸、氣爆、工安、毒化、化學)
  if (cat === "disaster" && /火災|火警|爆炸|氣爆|工安|毒化|化學/.test(title)) return true;
  // 大型活動（ttl >= 12 小時）
  if (cat === "activity" && (event.ttl_hours || 0) >= 12) return true;

  return false;
}

const SITE_URL = "https://taiwan-news-map.vercel.app/";

function buildPostText(event) {
  const cat = event.category || "";
  const emoji = cat === "accident" ? "🚨" : cat === "disaster" ? "🔥" : "📣";
  const label = cat === "accident" ? "即時事故" : cat === "disaster" ? "即時災情" : "活動資訊";
  const title = cleanRSSContent(event.title || event.text || "");
  const city  = event.city || "";
  const eventTime = event.pubDate 
    ? new Date(event.pubDate).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Taipei" }) 
    : new Date(event.createdAt || Date.now()).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Taipei" });

  let text = `${emoji} 【${label}】${title}\n\n`;
  if (city) text += `📍 ${city}\n`;
  text += `🕐 ${eventTime}\n\n`;
  text += `🗺️ 查看地圖：${SITE_URL}\n`;
  text += `💡 小建議：點右上角選單，以外部瀏覽器開啟效果更佳！\n\n`;
  text += `#台灣即時 #${city.replace(/[市縣]/g, "")} #台灣新聞事件地圖`;
  return text;
}

async function postToThreads(event) {
  if (!THREADS_USER_ID || !THREADS_TOKEN) {
    console.log("⚠️ [Threads] 未設定 THREADS_USER_ID 或 THREADS_ACCESS_TOKEN，跳過發文");
    return;
  }
  try {
    let text = "";
    try {
      // 優先使用 AI 生成貼文內容
      const aiPrompt = THREADS_POST_PROMPT.replace("{events}", JSON.stringify({
        title: cleanRSSContent(event.title),
        city: event.city,
        category: event.category,
        content: cleanRSSContent(event.content)
      }));
      const aiResponse = await callAzureAI(aiPrompt);
      text = aiResponse.trim();
      
      // 確保包含網址與小建議
      if (text) {
        if (!text.includes("taiwan-news-map")) {
          text += `\n${SITE_URL}`;
        }
        text += `\n\n💡 小建議：點右上角選單，以外部瀏覽器開啟效果更佳！`;
      }
    } catch (e) {
      console.error("⚠️ [Threads] AI 生成貼文失敗，使用備用格式:", e.message);
      text = buildPostText(event);
    }

    if (!text) return;

    // Step 1: 建立媒體容器
    const createRes = await fetch(
      `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: "TEXT",
          text,
          access_token: THREADS_TOKEN,
        }),
      }
    );
    const createData = await createRes.json();
    if (!createData.id) {
      console.error("❌ [Threads] 建立容器失敗:", JSON.stringify(createData));
      return;
    }

    // Step 2: 發布
    const publishRes = await fetch(
      `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: createData.id,
          access_token: THREADS_TOKEN,
        }),
      }
    );
    const publishData = await publishRes.json();
    if (publishData.id) {
      const postId = publishData.id;
      console.log(`✅ [Threads] 發文成功，發文 ID：${postId}`);

      // Step 3: 建立留言內容（相關報導連結）
      const replyText = event.sources?.length 
        ? `📰 相關報導：\n` + event.sources.slice(0, 3).map((s, i) => `${i + 1}. ${s.outlet}：${cleanRSSContent(s.title)}\n${s.url}`).join("\n\n") 
        : null;

      if (replyText) {
        console.log(`💬 [Threads] 準備發留言...`);
        const replyContainerRes = await fetch(
          `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              media_type: "TEXT",
              text: replyText,
              reply_to_id: postId,
              access_token: THREADS_TOKEN,
            }),
          }
        );
        const replyContainerData = await replyContainerRes.json();
        
        if (replyContainerData.id) {
          await delay(500); // 縮短延遲以增加發文速度
          await fetch(
            `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads_publish`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                creation_id: replyContainerData.id,
                access_token: THREADS_TOKEN,
              }),
            }
          );
          console.log(`✅ [Threads] 相關報導留言發布成功`);
        }
      }
    } else {
      console.error("❌ [Threads] 發文失敗:", JSON.stringify(publishData));
    }
  } catch (e) {
    console.error("❌ [Threads] 發文錯誤:", e.message);
  }
}

async function runThreadsAutoPost(newEvents) {
  // 只對「這次新抓到」的事件發文，避免每次重跑都重發
  let postedIds = [];
  try {
    const raw = await kv.get("threads_posted_ids");
    postedIds = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
  } catch {}

  const toPost = newEvents.filter(e => {
    const eventTime = new Date(e.pubDate || e.createdAt).getTime();
    const ageHours = (Date.now() - eventTime) / (1000 * 60 * 60);
    if (ageHours > 2) {
      console.log(`⏭️ 跳過舊新聞（${ageHours.toFixed(1)}小時前）：${e.title}`);
      return false;
    }
    return shouldPost(e) && !postedIds.includes(e.id);
  });

  if (toPost.length > 0) {
    // 依重要度排序（如有 importance），只發最重要的一筆，避免洗版
    const sorted = toPost.sort((a, b) => (b.importance || 0) - (a.importance || 0));
    const topEvent = sorted[0];
    
    console.log(`📣 [Threads] 準備發布最重要事件：${topEvent.title}`);
    await postToThreads(topEvent);
    postedIds.push(topEvent.id);
    
    // 其他標記為已發布，但不發文，避免下次重複偵測
    toPost.slice(1).forEach(e => postedIds.push(e.id));
    
    console.log(`📣 [Threads] 本次發文 1 則，標記 ${toPost.length} 則為已處理`);
  }

  // 只保留最近 500 筆已發 id
  await kv.set("threads_posted_ids", JSON.stringify(postedIds.slice(-500)));
}

// ===== 事件一致性驗證 =====
async function validateEventConsistency(event) {
  const prompt = `
以下是一筆新聞事件的標題和內容，請判斷兩者是否描述同一件事。

標題：${event.title || event.text}
內容：${event.content || event.text}

只回傳 JSON：
{ "isConsistent": true 或 false }
`;
  try {
    const result = await callAzureAI(prompt);
    const parsed = JSON.parse(result.replace(/```json|```/g, "").trim());
    return parsed.isConsistent;
  } catch (e) {
    console.error("❌ 一致性驗證失敗，預設通過:", e.message);
    return true; // 驗證失敗就預設通過
  }
}

// ===== TW Online 文案改寫 =====
async function rewriteToTWOnline(event) {
  const eventText = (event.title || "") + (event.content || "") + (event.text || "");
  
  // 死亡事件判定
  const SUICIDE_KEYWORDS = ["輕生", "自殺", "跳軌", "跳橋", "燒炭", "自盡", "尋短"]; 
  const CASUALTY_KEYWORDS = ["死亡", "罹難", "身亡", "喪生", "不治", "往生", "遇難"]; 
  
  const isSuicide = SUICIDE_KEYWORDS.some(k => eventText.includes(k)); 
  const isCasualty = CASUALTY_KEYWORDS.some(k => eventText.includes(k)); 
  const hasCasualty = isSuicide || isCasualty || /重傷/.test(eventText);

  // 死亡事件模板
  const suicideTemplate = `🕯️ 系統公告｜[地點]有玩家選擇永久離線，願其安息`; 
  const casualtyTemplates = [ 
      `🕯️ 系統公告｜[地點]有玩家意外永久離線，願其安息`, 
      `🕯️ 重大警報｜[地點]玩家生命值歸零，GM 正在處理現場`, 
  ]; 

  const templates = { 
      traffic: hasCasualty ? [ 
          `⚠️ 系統警告｜[地點]發生致命事故，該玩家已永久離線，GM 正在調查`, 
          `🚨 緊急公告｜[地點]偵測到玩家生命值歸零，請周邊玩家迴備`, 
      ] : [ 
          `🚦 區域壅塞｜[地點]玩家密度爆表，伺服器延遲中，建議換路`, 
          `⚡ 交通異常｜[地點]有大量玩家卡在同一格，正在重新分配`, 
          `🗺️ 路線警告｜[地點]前方有狀況，NPC 正在清場中`, 
          `😩 塞車警報｜[地點]玩家全都卡住了，建議開地圖找替代路線`, 
          `🐢 移動速度 -90%｜[地點]嚴重塞車，徒步可能比較快`, 
          `📡 系統偵測｜[地點]移動型玩家大量聚集，預計清場時間未知`, 
      ], 
      accident: hasCasualty ? [ 
          `⚠️ 嚴重警報｜[地點]發生重大 PK，已有玩家永久離線，GM 介入中`, 
          `🚨 緊急通報｜[地點]玩家生命值歸零，請保持距離等待 GM 處理`, 
      ] : [ 
          `⚔️ PK 事件｜[地點]偵測到玩家互毆，警察 NPC 已出動`, 
          `💥 碰撞警報｜[地點]兩名玩家發生物理碰撞，裝備可能受損`, 
          `🔴 戰鬥回報｜[地點]有玩家忘記這不是 PVP 區`, 
          `😬 意外事件｜[地點]玩家操作失誤，GM 正在評估損害`, 
          `🚑 急救任務觸發｜[地點]有玩家血量過低，醫療 NPC 趕赴現場`, 
          `⚠️ 注意｜[地點]玩家車輛發生非預期碰撞，道路暫時封鎖`, 
      ], 
      construction: [ 
          `🔧 伺服器維護中｜[地點]道路優化作業進行中，繞道通行`, 
          `🏗️ 地圖更新中｜[地點]開發商正在施工，完成後將解鎖新區域`, 
          `⛏️ 系統升級｜[地點]NPC 工程師正在修復地形 bug`, 
          `🚧 區域封鎖｜[地點]該路段進行版本更新，暫時無法通行`, 
          `📋 維護公告｜[地點]道路 DLC 安裝中，請耐心等候`, 
          `😤 又在施工｜[地點]開發商再度對道路進行「優化」，繞行吧`, 
      ], 
      disaster: hasCasualty ? [ 
          `🚨 重大災難｜[地點]發生高傷害範圍事件，已有玩家永久離線`, 
          `☠️ 危險區域｜[地點]偵測到致命異常，請所有玩家立即撤離`, 
      ] : [ 
          `🌋 自然事件觸發｜[地點]發生大規模災害，GM 正在評估損失`, 
          `⚠️ 危險區域警示｜[地點]環境異常，建議玩家暫時撤離`, 
          `🆘 緊急任務啟動｜[地點]發生突發事件，救援 NPC 已出動`, 
          `😱 伺服器異常｜[地點]偵測到不明事件，等待 GM 確認中`, 
          `🔥 高危警報｜[地點]區域即將進入危險狀態，請玩家保持距離`, 
          `📻 GM 廣播｜[地點]發生異常事件，請玩家配合疏散`, 
      ], 
      activity: [ 
          `📋 限時任務開放｜[地點]新任務已上線，完成可獲得獎勵`, 
          `🎉 活動觸發｜[地點]限時事件開始，趕快去參加`, 
          `⏰ 任務倒數中｜[地點]活動即將截止，手腳要快`, 
          `🗺️ 新地點解鎖｜[地點]特殊活動區域開放，限時進入`, 
          `🏆 成就任務｜[地點]完成指定行動即可解鎖特殊稱號`, 
          `🎊 伺服器慶典｜[地點]全服活動開跑，所有玩家歡迎參加`, 
      ], 
      other: [ 
          `📢 系統公告｜[地點]有新消息，請玩家注意`, 
          `📡 GM 廣播｜[地點]發生不明事件，持續監控中`, 
          `🔔 伺服器通知｜[地點]偵測到異常活動，詳情調查中`, 
          `📰 情報更新｜[地點]有新情報，建議玩家前往確認`, 
          `🤔 奇怪的事｜[地點]發生了一些事，GM 也在查`, 
          `💬 玩家回報｜[地點]收到玩家通報，NPC 正在處理`, 
      ], 
   }; 
 
   // 隨機選一個 
   const pool = templates[event.category] || templates.other; 
   const template = isSuicide 
     ? suicideTemplate 
     : isCasualty 
     ? casualtyTemplates[Math.floor(Math.random() * casualtyTemplates.length)] 
     : pool[Math.floor(Math.random() * pool.length)];

   const prompt = `
你是「TW Online」遊戲的 GM 公告撰寫員。
把以下新聞事件改寫成遊戲風格的公告文字。

模板：${template}
事件標題：${event.title || event.text}
事件內容：${event.content || event.text}
發生地點：${event.city}

規則：
- 把地點填入模板的[地點]
- 語氣像遊戲系統公告，簡短有力
- 字數不超過 50 字
- ${isSuicide ? "語氣必須沉重嚴肅，不可有任何輕浮或幽默成分，用「選擇永久離線」代替輕生相關字眼，絕對不可以用 PK、衝突、碰撞等字眼。" : (hasCasualty ? "語氣嚴肅，不可輕浮，用「永久離線」代替死亡" : "可以輕鬆一點但不誇張")}
- 摘要改寫規則：
  * 人/民眾/路人/騎士/駕駛 → 玩家
  * 年齡（XX歲）→ LV.XX
  * 警察/員警 → 執法 Mod
  * 消防員 → 救援 NPC
  * 政府/機關 → 官方 Mod 團隊
  * 死亡/身亡/罹難 → 永久離線
  * 受傷/受創 → 生命值下降
  * 車輛/汽車/機車 → 載具
  * 錢/費用 → 遊戲幣
  * 醫院 → 復活點
  * 公司/機構 → 公會
- 只回傳改寫後的文字，不要其他說明

回傳格式：
{
  "twOnlineTitle": "改寫後的標題",
  "twOnlineContent": "改寫後的內容"
}
`;

  try {
    const response = await callAzureAI(prompt);
    // 清掉可能的 markdown 格式
    const clean = response.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);

    return {
      ...event,
      twOnlineTitle: result.twOnlineTitle || event.title || event.text,
      twOnlineContent: result.twOnlineContent || event.content || event.text,
      hasCasualty: hasCasualty
    };
  } catch (e) {
    console.warn("❌ [TW Online] 改寫失敗，使用原始文案", e.message);
    // 失敗就用原始文案，不影響主流程
    return {
      ...event,
      twOnlineTitle: event.title || event.text,
      twOnlineContent: event.content || event.text,
      hasCasualty: hasCasualty
    };
  }
}

function extractRoadName(location) {
    const match = (location || "").match(/([^\d\s]+路|[^\d\s]+街|[^\d\s]+大道)/);
    return match ? match[0] : null;
}

async function main() {
  try {
    console.log(`🚀 啟動全台新聞同步系統 (模式: ${mode})...`);
    
    let finalEvents = [];
    let trafficCacheList = [];
    let newsCacheList = [];
    let candidatesMap = new Map();
    let pbsCount = 0;
    let tdxCount = 0;
    let trafficSummary = createTrafficSourceSummary();
    let trafficRefreshHealthy = true;

    // --- 交通資料抓取 (僅保留警廣 PBS) ---
    if (mode === "traffic" || mode === "all") {
      let rawCache = await kv.get("taiwan_traffic_cache");
      let cacheMap = new Map();
      if (rawCache) {
        const parsed = typeof rawCache === "string" ? JSON.parse(rawCache) : rawCache;
        parsed.forEach(item => { if (item.expiresAt > Date.now()) cacheMap.set(item.id, item); });
      }

      console.log("\n⏳ 準備啟動警廣抓取...");
      console.log("\n⏳ 準備啟動交通抓取...");
      const pbsData = await fetchPBSWithSummary(trafficSummary);
      pbsData.forEach(item => {
        candidatesMap.set(item.id, item);
        pbsCount++;
      });

      if (pbsData.length === 0) {
        const tdxData = await fetchTDXTrafficFallback(trafficSummary);
        tdxData.forEach(item => {
          candidatesMap.set(item.id, item);
          tdxCount++;
        });
      }

      const candidates = Array.from(candidatesMap.values());
      let itemsForAI = [];
      for (const item of candidates) {
        const cached = cacheMap.get(item.id);
        if (cached && cached.text === item.text) {
          trafficCacheList.push(cached);
          if (cached.isReal) finalEvents.push(cached);
        } else {
          itemsForAI.push(item);
        }
      }

      for (let i = 0; i < itemsForAI.length; i += 20) {
        const batch = itemsForAI.slice(i, i + 20);
        const aiResults = await aiFilterEvents(batch);
        batch.forEach(item => {
          const ai = aiResults.find(r => r.id === item.id);
          if (!ai) return;
          const processedItem = {
          ...item, title: ai.title || item.text, category: ai.category || "accident",
          isReal: ai.isReal, 
          createdAt: Date.now(),
          expiresAt: Date.now() + Math.min(ai.ttl_hours || 4, 8) * 60 * 60 * 1000,
        };
          trafficCacheList.push(processedItem);
          if (ai.isReal) finalEvents.push(processedItem);
        });
      }

      cacheMap.forEach(cached => {
        if (!trafficCacheList.find(n => n.id === cached.id)) {
          if (cached.expiresAt > Date.now()) {
            trafficCacheList.push(cached);
            if (cached.isReal) finalEvents.push(cached);
          }
        }
      });

      trafficSummary.cacheCount = trafficCacheList.filter(item => item?.expiresAt > Date.now()).length;
      trafficSummary.usedCache = trafficSummary.cacheCount > 0;
      if (trafficSummary.liveSource === "pbs" && trafficSummary.pbs.success) {
        trafficSummary.status = "pbs_ok";
      } else if (trafficSummary.liveSource === "tdx" && trafficSummary.tdx.success) {
        trafficSummary.status = "tdx_fallback_ok";
      } else if (trafficSummary.usedCache) {
        trafficSummary.status = "cache_only";
        trafficRefreshHealthy = false;
      } else {
        trafficSummary.status = "traffic_failed";
        trafficRefreshHealthy = false;
      }

      await kv.set("taiwan_traffic_cache", JSON.stringify(trafficCacheList));
      console.log(
        `✅ 交通處理完成，共 ${finalEvents.length} 筆 (警廣: ${pbsCount} 筆, TDX: ${tdxCount} 筆, cache: ${trafficSummary.cacheCount} 筆, status: ${trafficSummary.status})`
      );
    } else {
      // 非交通模式，載入現有交通快取以便合併
      const rawCache = await kv.get("taiwan_traffic_cache");
      if (rawCache) {
        const parsed = typeof rawCache === "string" ? JSON.parse(rawCache) : rawCache;
        parsed.forEach(item => { if (item.expiresAt > Date.now() && item.isReal) finalEvents.push(item); });
      }
    }

    // --- 新聞資料抓取 ---
    let newsEvents = [];
    if (mode === "news" || mode === "all") {
      console.log("\n📰 [新聞] 開始處理新聞來源...");
      newsEvents = await fetchNews();

      let rawNewsCache = await kv.get("taiwan_news_cache");
      let newsCacheMap = new Map();
      if (rawNewsCache) {
        const parsed = typeof rawNewsCache === "string" ? JSON.parse(rawNewsCache) : rawNewsCache;
        parsed.forEach(item => { if (item.expiresAt > Date.now()) newsCacheMap.set(item.id, item); });
      }

      newsEvents.forEach(item => newsCacheMap.set(item.id, item));
      const seenNewsTitles = new Map();
      Array.from(newsCacheMap.values())
        .sort((a, b) => (b.expiresAt || 0) - (a.expiresAt || 0))
        .forEach(item => {
          const titleKey = (item.title || "").slice(0, 12);
          if (!seenNewsTitles.has(titleKey)) seenNewsTitles.set(titleKey, item);
        });
      
      newsCacheList = Array.from(seenNewsTitles.values()).filter(n =>
        n.expiresAt > Date.now() && n.lat >= 21 && n.lat <= 27 && n.lng >= 118 && n.lng <= 123
      );
      await kv.set("taiwan_news_cache", JSON.stringify(newsCacheList));
      console.log(`✅ 新聞處理完成，共 ${newsCacheList.length} 筆`);

      // 只有新聞模式或全跑模式才執行 Threads 發文
      await runThreadsAutoPost(newsEvents);
    } else {
      // 非新聞模式，載入現有新聞快取以便合併
      const rawNewsCache = await kv.get("taiwan_news_cache");
      if (rawNewsCache) {
        const parsed = typeof rawNewsCache === "string" ? JSON.parse(rawNewsCache) : rawNewsCache;
        newsCacheList = parsed.filter(n => n.expiresAt > Date.now());
      }
    }

    // --- 合併與存檔 ---
    let allFinalEvents = [...finalEvents, ...newsCacheList];

    // --- 內部寫入 KV 前加強去重 (同一事件只保留一筆) ---
    console.log("🔍 開始進行內部去重檢查...");
    
    async function deduplicateWithAI(newEvents, existingEvents) {
        if (newEvents.length === 0) return [];
        // 限制現有事件數量，只取最近 30 筆進行比對，避免 prompt 過長
        const compareBase = existingEvents.slice(0, 30);
        
        const prompt = `
你是新聞去重專家。以下是「現有事件」和「新抓到的事件」。

現有事件：
${JSON.stringify(compareBase.map(e => ({ id: e.id, title: e.title, city: e.city, category: e.category })), null, 2)}

新事件：
${JSON.stringify(newEvents.map(e => ({ title: e.title, city: e.city, category: e.category, content: e.content })), null, 2)}

任務：判斷每一筆新事件是否與現有事件描述同一件事。
判斷標準：同一起事件 = 相同的人/地點/行為，不管標題怎麼寫。

回傳 JSON 格式（只回傳 JSON，不要其他文字）：
{
  "unique": [新事件的 title 陣列，只包含不重複的]
}
`;

        try {
            const response = await callAzureAI(prompt);
            const result = JSON.parse(response.replace(/```json|```/g, "").trim());
            return newEvents.filter(ev => (result.unique || []).includes(ev.title));
        } catch (e) {
            console.error("❌ AI 去重失敗，退回到基本比對:", e.message);
            // 失敗時回傳原陣列，由後續的 isDuplicateEvent 做基本過濾
            return newEvents;
        }
    }

    function isDuplicateEvent(newEvent, existingEvents) {
        const newTitle = (newEvent.title || "").replace(/\s+/g, "").slice(0, 15);
        const newContent = (newEvent.content || "").replace(/\s+/g, "").slice(0, 30);
        const newRoad = extractRoadName(newEvent.location || newEvent.city);
        
        return existingEvents.find(ev => {
            const existTitle = (ev.title || "").replace(/\s+/g, "").slice(0, 15);
            const existContent = (ev.content || "").replace(/\s+/g, "").slice(0, 30);
            const existRoad = extractRoadName(ev.location || ev.city);
            
            // 1. 標題前15字相同
            if (newTitle === existTitle) return true;
            
            // 2. 內容前30字相同
            if (newContent === existContent && newContent.length > 10) return true;
            
            // 3. 同一條路 + 同類別 + 同縣市 = 合併 (加強去重)
            if (ev.category === newEvent.category && ev.city && newEvent.city) {
                // 檢查縣市是否相同（取前三字比對，如 "彰化市" vs "彰化縣"）
                const city1 = ev.city.slice(0, 3);
                const city2 = newEvent.city.slice(0, 3);
                
                if (city1 === city2 && newRoad && existRoad && newRoad === existRoad) {
                    console.log(`📎 [去重] 偵測到同路段事件合併: ${newRoad} (${newTitle})`);
                    return true;
                }
            }

            // 4. 同城市 + 同類別 + 標題有5個以上相同字
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

    const initialEvents = [...finalEvents, ...newsCacheList];
    const sortedEvents = initialEvents.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    
    // 先用 AI 進行大範圍去重
    const aiFiltered = await deduplicateWithAI(sortedEvents, []); // 這裡可以傳入已存在 KV 的資料，但為了效能先處理當前批次
    
    const finalMerged = [];
    aiFiltered.forEach(ev => {
        const dupe = isDuplicateEvent(ev, finalMerged);
        if (!dupe) {
            finalMerged.push(ev);
        } else {
            // 同一事件座標一旦寫入就鎖定
            if (dupe.lat && dupe.lng) {
                ev.lat = dupe.lat;
                ev.lng = dupe.lng;
            }

            // 如果是重複的，嘗試將來源合併到已存在的事件中
            if (ev.sources) {
                dupe.sources = dupe.sources || [];
                ev.sources.forEach(s => {
                    if (!dupe.sources.find(ds => ds.url === s.url)) dupe.sources.push(s);
                });
            }
        }
    });

    // --- TW Online 文案改寫 (針對新事件或尚未改寫的事件) ---
    console.log("📝 開始進行事件驗證與 TW Online 文案改寫...");
    const oldEventsRaw = await kv.get("taiwan_traffic_events");
    const oldEvents = oldEventsRaw ? (typeof oldEventsRaw === "string" ? JSON.parse(oldEventsRaw) : oldEventsRaw) : [];
    
    const validatedMerged = [];
    for (let i = 0; i < finalMerged.length; i++) {
        const ev = finalMerged[i];
        
        // 1. 一致性驗證 (僅對新事件)
        const isExisting = oldEvents.some(o => o.id === ev.id || (o.title === ev.title && o.city === ev.city));
        if (!isExisting) {
            const isConsistent = await validateEventConsistency(ev);
            if (!isConsistent) {
                console.warn("⚠️ 標題與內容不一致，跳過此事件:", ev.title || ev.text);
                continue;
            }
        }

        // 2. 尋找舊資料中是否已有改寫過的或座標
        const oldEv = oldEvents.find(o => o.id === ev.id || (o.title === ev.title && o.city === ev.city));
        
        let enriched = ev;
        if (oldEv) {
          // 同一事件座標一旦寫入就鎖定
          if (oldEv.lat && oldEv.lng) {
            enriched.lat = oldEv.lat;
            enriched.lng = oldEv.lng;
          }

          if (oldEv.twOnlineTitle) {
            enriched.twOnlineTitle = oldEv.twOnlineTitle;
            enriched.twOnlineContent = oldEv.twOnlineContent;
            enriched.hasCasualty = oldEv.hasCasualty;
          } else {
            console.log(`🤖 正在改寫: ${ev.title || ev.text}`);
            enriched = await rewriteToTWOnline(ev);
            await delay(500); 
          }
        } else {
          console.log(`🤖 正在改寫: ${ev.title || ev.text}`);
          enriched = await rewriteToTWOnline(ev);
          await delay(500); 
        }
        validatedMerged.push(enriched);
      }
  
      await kv.set("taiwan_traffic_events", JSON.stringify(validatedMerged));
      if ((mode === "traffic" || mode === "all") && !trafficRefreshHealthy) {
        console.error(
          `TRAFFIC_REFRESH_FAILED status=${trafficSummary.status} liveSource=${trafficSummary.liveSource || "none"} pbs=${trafficSummary.pbs.count} tdx=${trafficSummary.tdx.count} cache=${trafficSummary.cacheCount}`
        );
        process.exitCode = 1;
      }
      console.log(`💾 全部完工！最終合計: ${validatedMerged.length} 筆 (原始: ${initialEvents.length} 筆)`);

  } catch (error) {
    console.error("💥 錯誤:", error);
    process.exitCode = 1;
  }
}

main();
