process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const mode = process.argv.includes("--mode=news") ? "news" : 
             process.argv.includes("--mode=traffic") ? "traffic" : "all";

const { Redis } = require("@upstash/redis");

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const AZURE_ENDPOINT = "https://timcs-me2fe94e-eastus2.cognitiveservices.azure.com";
const AZURE_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || "GPT4OMINI";
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
    max_tokens: 4000,
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

const todayStr = new Date().toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" });

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

async function aiFilterNews(articles) {
  if (articles.length === 0) return [];
  const prompt = `你是台灣新聞事件分析器。今天日期是【${todayStr}】。
以下是新聞標題與摘要列表，請判斷每則是否屬於以下三類之一：
1. 車禍／交通事故
2. 火災／災害
3. 活動／展覽／演唱會／節慶

嚴格規則：
- 只輸出「事件發生地點在台灣境內」的事件。
- 如果事件是「台灣人/官員去國外」、「台灣與外國的外交活動」、「海外台灣祭」等，地點不在台灣，一律排除，不要輸出。
- city 欄位只能填台灣的縣市名稱，例如：台北市、高雄市、台南市、花蓮縣等。
- 如果無法確定事件發生在台灣境內，寧可不輸出也不要猜。
- 不符合以上三類的新聞（如政治、國際、財經、體育）請過濾掉。

對每則符合的新聞，請回傳：
- id: 原始 id
- isRelevant: true
- title: 簡短中文標題（20字內）
- category: "accident"（車禍事故）| "disaster"（火災災害）| "activity"（活動）
- location: 最具體的地名，要能直接 geocode 的地址或地標（例如"台南市運河旁河樂廣場"、"國道3號關廟段"、"屏東縣鹽埔鄉勝利街"）。若新聞提到知名地標請使用地標全名。若無具體地點則填 null。
- locationFallback: 只到縣市層級（例如"台南市"、"屏東縣"、"新北市"），location 為 null 時也填 null
- eventFingerprint: 用來識別同一事件的指紋，格式為「縣市_類型_事件關鍵字3個字」，例如「台南市_disaster_縱火砍」、「高雄市_accident_追撞」。同一事件不同媒體報導的 fingerprint 必須完全一樣。
- ttl_hours: 預計持續小時數（活動可給 24，事故給 2，火災給 4）

不符合的新聞請回傳 { id, isRelevant: false }。
只回傳 JSON 陣列，不要其他文字。

新聞列表：
${JSON.stringify(articles.map(a => ({ id: a.id, title: sanitizeText(a.title), desc: sanitizeText(a.description?.slice(0, 150) || "") })))}`;

  try {
    const text = await callAzureAI(prompt);
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (err) {
    console.error("❌ 新聞 AI 篩選失敗:", err.message);
    return [];
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
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationText + " 台灣")}&format=json&limit=1&countrycodes=tw`;
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
      // 驗證座標在台灣範圍內，避免 Nominatim 亂猜到海外
      if (lat >= 21 && lat <= 27 && lng >= 118 && lng <= 123) {
        return { lat, lng };
      }
    }
  } catch (e) {
    console.error(`❌ Geocode 失敗 [${locationText}]:`, e.message);
  }
  geocodeFailCache.set(locationText, true);
  return null;
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
        allArticles.push({ ...item, id: `NEWS_${source.name}_${i}`, source: source.name });
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

  let relevantArticles = [];
  for (let i = 0; i < allArticles.length; i += 15) {
    const batch = allArticles.slice(i, i + 15);
    const aiResults = await aiFilterNews(batch);
    batch.forEach(article => {
      const ai = aiResults.find(r => r.id === article.id);
      if (ai && ai.isRelevant) {
        relevantArticles.push({ ...article, aiResult: ai });
      }
    });
    await delay(1000);
  }

  console.log(`🤖 [新聞] AI 篩選後剩 ${relevantArticles.length} 則相關新聞`);

  // 【修復】AI 篩選後二次去重：優先用 AI 給的 eventFingerprint，沒有則用城市+類型+標題前8字
  const seenEventKeys = new Set();
  relevantArticles = relevantArticles.filter(article => {
    const ai = article.aiResult;
    const key = ai.eventFingerprint ||
      `${ai.locationFallback || ai.location || ""}_${ai.category || ""}_${(ai.title || article.title || "").slice(0, 8)}`;
    if (seenEventKeys.has(key)) return false;
    seenEventKeys.add(key);
    return true;
  });
  console.log(`🔍 [新聞] 二次去重後剩 ${relevantArticles.length} 則`);

  let newsEvents = [];
  for (const article of relevantArticles) {
    const ai = article.aiResult;

    if (!ai.location) {
      console.log(`⚠️ 無地名跳過: ${article.title}`);
      continue;
    }

    let coords = await geocode(ai.location);
    if (!coords && ai.locationFallback) {
      console.log(`🔄 備用定位: ${ai.locationFallback}`);
      await delay(1200);
      coords = await geocode(ai.locationFallback);
    }

    if (!coords) {
      console.log(`⚠️ 無法定位跳過: ${ai.location}`);
      continue;
    }

    newsEvents.push({
      id: article.id,
      title: ai.title || article.title,
      content: article.description?.slice(0, 120) || "",
      category: ai.category || "other",
      source: article.source || "news",
      url: article.link || article.url,
      lat: coords.lat,
      lng: coords.lng,
      city: ai.locationFallback || ai.location,
      isReal: true,
      expiresAt: Date.now() + Math.min(ai.ttl_hours || 4, 24) * 60 * 60 * 1000,
    });

    await delay(1200);
  }

  // ── GDELT 地理事件 ──
  console.log("📡 [GDELT] 開始抓取地理座標事件...");
  const gdeltGeoEvents = await fetchGDELTGeo();
  gdeltGeoEvents.forEach(e => {
    newsEvents.push({
      id: e.id,
      title: e.title,
      content: `【GDELT 地理事件】${e.title}`,
      category: "news",
      source: "GDELT",
      url: e.url,
      lat: e.lat,
      lng: e.lng,
      city: e.city,
      isReal: true,
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
          title: a.title,
          description: a.title,
          url: a.url,
          link: a.url,
          source: a.domain || "GDELT",
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
      .filter(f => f.geometry?.coordinates && f.properties?.name)
      .map(f => ({
        id: `GDELTGEO_${f.properties.url ? Buffer.from(f.properties.url).toString("base64").slice(0, 20) : Math.random().toString(36).slice(2)}`,
        title: f.properties.name,
        description: f.properties.name,
        url: f.properties.url || "",
        source: "GDELT",
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
// 外掛 API：v2 Road/Traffic/Live 路段即時壅塞
// ==========================================
async function fetchPBS(token) {
  console.log("⏳ [警廣] 開始抓取警廣路況播報...");
  let results = [];

  // 警廣涵蓋範圍：全台 + 國道 + 省道
  const pbsTargets = [
    { path: "Freeway",           name: "國道警廣",  cityName: "國道"   },
    { path: "Highway",           name: "省道警廣",  cityName: "省道"   },
    { path: "City/Taipei",       name: "台北警廣",  cityName: "台北市" },
    { path: "City/NewTaipei",    name: "新北警廣",  cityName: "新北市" },
    { path: "City/Taoyuan",      name: "桃園警廣",  cityName: "桃園市" }, // ✅ 修復：移除重複的桃園
    { path: "City/Taichung",     name: "台中警廣",  cityName: "台中市" },
    { path: "City/Tainan",       name: "台南警廣",  cityName: "台南市" },
    { path: "City/Kaohsiung",    name: "高雄警廣",  cityName: "高雄市" },
    { path: "City/Keelung",      name: "基隆警廣",  cityName: "基隆市" },
    { path: "City/YilanCounty",  name: "宜蘭警廣",  cityName: "宜蘭縣" },
  ];

  for (const t of pbsTargets) {
    const url = `https://tdx.transportdata.tw/api/basic/v1/Traffic/RoadEvent/LiveEvent/${t.path}?$format=JSON`;
    const data = await fetchTDX(url, token, t.name);
    if (!data) { await delay(3000); continue; }

    const events = data.LiveEvents || data.Events || data.value || (Array.isArray(data) ? data : []);
    console.log(`📦 [${t.name}] 原始筆數: ${events.length}`);

    // debug：印出第一筆欄位
    if (events.length > 0) {
      const e0 = events[0];
      console.log(`🔍 [${t.name}] 第一筆:`, JSON.stringify({
        EventID: e0.EventID || e0.RoadEventID,
        summary: (e0.EventTitle || e0.EventSummary || e0.Description || "").slice(0, 50),
        PositionLat: e0.PositionLat,
        PositionLon: e0.PositionLon,
        EventPosition: e0.EventPosition,
        Positions: typeof e0.Positions === "string" ? e0.Positions.slice(0, 80) : e0.Positions,
      }));
    }

    // 各城市警廣筆數上限
    const PBS_CITY_LIMIT = 50;
    let added = 0;
    events.forEach(event => {
      if (added >= PBS_CITY_LIMIT) return;

      const eventId = event.EventID || event.RoadEventID;
      const summary = event.EventTitle || event.EventSummary || event.Description || "";
      if (!eventId || !summary) return;

      // 排除宣導
      if (summary.includes("宣導")) return;

      // 排除通用施工（重用既有函式）
      if (isEmptyConstructionEvent(summary, event.EventTypeName, event.Location?.Other)) return;

      // 過期過濾
      const endTime = event.EndTime || event.EventEndTime;
      if (endTime && new Date(endTime).getTime() < Date.now()) return;

      // 座標解析
      let lat, lng;
      if (typeof event.Positions === "string" && event.Positions.includes("POINT")) {
        const m = event.Positions.match(/POINT\s*\(([^\s]+)\s+([^)]+)\)/);
        if (m) { lng = parseFloat(m[1]); lat = parseFloat(m[2]); }
      } else {
        lat = event.PositionLat || event.EventPosition?.PositionLat;
        lng = event.PositionLon || event.EventPosition?.PositionLon;
      }

      if (!lat || !lng) return;

      const startTime = event.StartTime || event.EventStartTime || "";
      const timeInfo = (startTime || endTime)
        ? ` (${startTime} ~ ${endTime || "未定"})`
        : "";

      // 同座標抖動
      const jittered = jitterCoord(lat, lng, added);
      results.push({
        id: `PBS_${eventId}`,
        text: `【警廣播報】${summary}${timeInfo}`,
        lat: jittered.lat, lng: jittered.lng,
        city: t.cityName, // ✅ 修復：使用正確的完整縣市名，避免 geocode 定位到市政府
      });
      added++;
    });

    console.log(`✅ [${t.name}] 有效筆數: ${added}`);
    await delay(5000);
  }

  console.log(`✅ [警廣] 共整理 ${results.length} 筆！`);
  return results;
}


// ==========================================
// 外掛 API：台中市（已停用，改走 TDX）
// ==========================================
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

function shouldPost(event) {
  const title = (event.title || event.text || "").toLowerCase();
  const cat   = event.category || "";

  // 重大事故：死亡、多人傷亡
  if (cat === "accident" && /死亡|死[0-9]|[0-9]死|多人傷|重傷|[3-9]人傷|[1-9][0-9]人/.test(title)) return true;
  // 火災災害
  if (cat === "disaster") return true;
  // 大型活動（ttl >= 12 小時）
  if (cat === "activity" && (event.ttl_hours || 0) >= 12) return true;

  return false;
}

const SITE_URL = "https://taiwan-news-map.vercel.app/";

function buildPostText(event) {
  const cat = event.category || "";
  const emoji = cat === "accident" ? "🚨" : cat === "disaster" ? "🔥" : "📣";
  const label = cat === "accident" ? "即時事故" : cat === "disaster" ? "即時災情" : "活動資訊";
  const title = event.title || event.text || "";
  const city  = event.city || "";
  const now   = new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Taipei" });

  let text = `${emoji} 【${label}】${title}\n\n`;
  if (city) text += `📍 ${city}\n`;
  text += `🕐 ${now}\n\n`;
  text += `🗺️ 查看地圖：${SITE_URL}\n`;
  text += `#台灣即時 #${city.replace(/[市縣]/g, "")} #台灣新聞事件地圖`;
  return text;
}

async function postToThreads(event) {
  if (!THREADS_USER_ID || !THREADS_TOKEN) {
    console.log("⚠️ [Threads] 未設定 THREADS_USER_ID 或 THREADS_ACCESS_TOKEN，跳過發文");
    return;
  }
  try {
    const text = buildPostText(event);

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
      console.log(`✅ [Threads] 發文成功：${event.title || event.text}`);
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

  const toPost = newEvents.filter(e => shouldPost(e) && !postedIds.includes(e.id));

  for (const event of toPost) {
    await postToThreads(event);
    postedIds.push(event.id);
    await delay(3000); // 避免 API 限速
  }

  // 只保留最近 500 筆已發 id
  await kv.set("threads_posted_ids", JSON.stringify(postedIds.slice(-500)));
  if (toPost.length > 0) console.log(`📣 [Threads] 本次發文 ${toPost.length} 則`);
}

async function main() {
  try {
    console.log(`🚀 啟動全台新聞同步系統 (模式: ${mode})...`);
    
    // 只有 traffic 或 all mode 才需要 TDX token
    let token = null;
    if (mode === "traffic" || mode === "all") {
      token = await getTDXToken();
    }

    let finalEvents = [];
    let trafficCacheList = [];
    let newsCacheList = [];
    let candidatesMap = new Map();
    let pbsCount = 0;

    // --- 交通資料抓取 (僅保留警廣 PBS) ---
    if (mode === "traffic" || mode === "all") {
      let rawCache = await kv.get("taiwan_traffic_cache");
      let cacheMap = new Map();
      if (rawCache) {
        const parsed = typeof rawCache === "string" ? JSON.parse(rawCache) : rawCache;
        parsed.forEach(item => { if (item.expiresAt > Date.now()) cacheMap.set(item.id, item); });
      }

      console.log("\n⏳ 準備啟動警廣抓取...");
      const pbsData = await fetchPBS(token);
      pbsData.forEach(item => {
        candidatesMap.set(item.id, item);
        pbsCount++;
      });

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
            isReal: ai.isReal, expiresAt: Date.now() + Math.min(ai.ttl_hours || 4, 8) * 60 * 60 * 1000,
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
      await kv.set("taiwan_traffic_cache", JSON.stringify(trafficCacheList));
      console.log(`✅ 交通處理完成，共 ${finalEvents.length} 筆 (警廣: ${pbsCount} 筆)`);
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
    const allFinalEvents = [...finalEvents, ...newsCacheList];
    await kv.set("taiwan_traffic_events", JSON.stringify(allFinalEvents));
    console.log(`💾 全部完工！最終合計: ${allFinalEvents.length} 筆`);

  } catch (error) {
    console.error("💥 錯誤:", error);
  }
}

main();
