process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const { Redis } = require("@upstash/redis");
const OpenAI = require("openai");

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
特別注意：如果事件提供的時間資訊(如迄日、完工日、結束日期)早於今天，代表已過期，請務必將 isReal 設為 false！

請回傳 JSON 陣列，每個物件包含：
- id: 原始 id
- isReal: boolean（是否為真實且未過期的事件）
- title: 簡短中文標題（20字內。若政府未提供摘要，請根據標題或事件類型自行生成通順的句子，例如「國道發生壅塞事件」）
- category: "traffic"（壅塞/即時路況）| "accident"（車禍/交通事故）| "construction"（施工管制）| "disaster"（災害意外）| "other"
- ttl_hours: 預計持續小時數（1-24）

只回傳 JSON，不要其他文字。
事件列表：
${JSON.stringify(items.map(i => ({ id: i.id, text: i.text })))}`;

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    });
    const text = res.choices[0].message.content.replace(/```json|```/g, "").trim();
    return JSON.parse(text);
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

不符合以上三類的新聞（如政治、國際、財經、體育）請過濾掉。

對每則符合的新聞，請回傳：
- id: 原始 id
- isRelevant: true
- title: 簡短中文標題（20字內）
- category: "accident"（車禍事故）| "disaster"（火災災害）| "activity"（活動）
- location: 最具體的地名（例如"屏東縣鹽埔鄉勝利街"、"國道3號關廟段"、"彰化大度橋"），若無則填 null
- locationFallback: 更粗略的備用地名（只到縣市或鄉鎮層級，例如"屏東縣"、"台南市關廟區"、"彰化縣"），若 location 為 null 則此項也填 null
- ttl_hours: 預計持續小時數（活動可給 24，事故給 2，火災給 4）

不符合的新聞請回傳 { id, isRelevant: false }。
只回傳 JSON 陣列，不要其他文字。

新聞列表：
${JSON.stringify(articles.map(a => ({ id: a.id, title: a.title, desc: a.description?.slice(0, 100) })))}`;

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    });
    const text = res.choices[0].message.content.replace(/```json|```/g, "").trim();
    return JSON.parse(text);
  } catch (err) {
    console.error("❌ 新聞 AI 篩選失敗:", err.message);
    return [];
  }
}

async function geocode(locationText) {
  if (!locationText) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationText + " 台灣")}&format=json&limit=1&countrycodes=tw`;
    const res = await fetch(url, {
      headers: { 
        "User-Agent": "TaiwanNewsMap/1.0 (https://github.com/0hankhank0/taiwan-news-map5)"
      }
    });
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      console.error(`❌ Nominatim 回傳非 JSON [${locationText}]: ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch (e) {
    console.error(`❌ Geocode 失敗 [${locationText}]:`, e.message);
  }
  return null;
}

async function fetchNews() {
  console.log("⏳ [新聞] 開始抓取 RSS...");
  const sources = [
    { url: "https://news.ltn.com.tw/rss/society.xml", name: "自由社會" },
    { url: "https://news.ltn.com.tw/rss/local.xml", name: "自由地方" },
  ];

  let allArticles = [];
  for (const source of sources) {
    try {
      const res = await fetch(source.url, fetchOptions);
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

  if (allArticles.length === 0) return [];

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
      source: "news",
      url: article.link,
      lat: coords.lat,
      lng: coords.lng,
      city: ai.locationFallback || ai.location,
      isReal: true,
      expiresAt: Date.now() + Math.min(ai.ttl_hours || 4, 24) * 60 * 60 * 1000,
    });

    await delay(1200);
  }

  console.log(`📍 [新聞] 成功定位 ${newsEvents.length} 則，寫入地圖`);
  return newsEvents;
}

// ==========================================
// 外掛 API：警廣
// ==========================================
// 修復：PBS API 已從 v1 升版到 v2，且路徑結構調整
async function fetchPBS(token) {
  console.log("⏳ [全台防線-警廣] 開始抓取警廣即時路況...");
  let results = [];

  // 📌 修復：PBS 已全面 404 被 TDX 下架。改用 v2/Road/Traffic 新架構的全台事故資料補強
  // 這些端點涵蓋全台各道路等級的即時路況事件，效果等同舊版警廣
  const candidateUrls = [
    "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Incident?$format=JSON",
    "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Event?$format=JSON",
    "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/LiveTraffic?$format=JSON",
  ];

  let data = null;
  for (const url of candidateUrls) {
    console.log(`🔍 [警廣] 嘗試端點: ${url}`);
    data = await fetchTDX(url, token, "警廣");
    if (data) {
      console.log(`✅ [警廣] 端點有效: ${url}`);
      break;
    }
    await delay(2000);
  }

  if (!data) {
    console.log("❌ [警廣] 所有端點均失敗，跳過警廣資料");
    return [];
  }

  try {
    const records = Array.isArray(data) ? data : (data?.Incidents || data?.Events || data?.LiveTraffics || data?.PBSRecords || []);
    console.log(`📦 [全台路況] 原始資料筆數: ${records.length}`);

    records.forEach(item => {
      // 新版 API 座標可能在 Positions (WKT) 或 PositionLat/Lon
      let lat = item.PositionLat || item.EventPosition?.PositionLat;
      let lng = item.PositionLon || item.EventPosition?.PositionLon;

      if (!lat && item.Positions?.includes("POINT")) {
        const match = item.Positions.match(/POINT\s*\(([^\s]+)\s+([^)]+)\)/);
        if (match) { lng = parseFloat(match[1]); lat = parseFloat(match[2]); }
      }

      const text = item.EventTitle || item.EventSummary || item.Description || item.RoadName || "";
      const city = item.CityName || item.City || "全台路況";
      const id = item.IncidentID || item.EventID || item.RoadEventID || item.UID || Math.random().toString(36).substring(7);

      if (lat && lng && text) {
        if (text.includes("宣導") || text.includes("交通安全")) return;
        results.push({
          id: `PBS_${id}`,
          text: `【全台路況】${text}`,
          lat,
          lng,
          city,
        });
      }
    });
    console.log(`✅ [警廣] 成功整理 ${results.length} 筆全台路況！`);
  } catch (e) {
    console.error("❌ 警廣資料解析錯誤:", e.message);
  }

  return results;
}

// ==========================================
// 外掛 API：台中市（改走 TDX，廢棄舊地方 API）
// ==========================================
// 修復：台中地方 API 資料已全數過期，改走 TDX City/Taichung
// 保留舊函式但不再主動呼叫，改由 tdxTargets 統一處理
async function fetchTaichung() {
  console.log("⏳ [台中市-地方API] 抓取中... (已停用，改走 TDX)");
  console.log("ℹ️  台中市改由 TDX City/Taichung 統一抓取，此函式已退役");
  return [];
}

// ==========================================
// 主程式
// ==========================================

async function main() {
  try {
    console.log("🚀 啟動全台新聞同步系統 (新聞整合版)...");
    const token = await getTDXToken();

    let rawCache = await kv.get("taiwan_traffic_cache");
    let cacheMap = new Map();
    if (rawCache) {
      const parsed = typeof rawCache === "string" ? JSON.parse(rawCache) : rawCache;
      parsed.forEach(item => { if (item.expiresAt > Date.now()) cacheMap.set(item.id, item); });
    }

    let candidatesMap = new Map();
    let cityStats = {};

    // 📌 修復 1：加入 City/Taichung（取代舊地方 API）
    // 📌 修復 2：台南加入 debug log（確認資料是否真的為空）
    let tdxTargets = [
      { path: "Freeway", name: "國道", types: ["LiveEvent"] },
      { path: "Highway", name: "省道", types: ["LiveEvent"] },
      { path: "City/Taipei", name: "台北市", types: ["Event", "LiveEvent"] },
      { path: "City/NewTaipei", name: "新北市", types: ["Event", "LiveEvent"] },
      { path: "City/Tainan", name: "台南市", types: ["Event", "LiveEvent"] },
      { path: "City/Keelung", name: "基隆市", types: ["Event", "LiveEvent"] },
      { path: "City/YilanCounty", name: "宜蘭縣", types: ["Event", "LiveEvent"] },
      // ✅ 新增：台中改走 TDX
      { path: "City/Taichung", name: "台中市", types: ["Event", "LiveEvent"] },
    ];

    tdxTargets = tdxTargets.sort(() => Math.random() - 0.5);
    console.log(`📡 [中央 TDX] 本次抓取順序：${tdxTargets.map(t => t.name).join(" -> ")}`);

    for (const target of tdxTargets) {
      for (const evType of target.types) {
        const url = `https://tdx.transportdata.tw/api/basic/v1/Traffic/RoadEvent/${evType}/${target.path}?$format=JSON`;
        const data = await fetchTDX(url, token, `${target.name}-${evType}`);
        if (!data) continue;

        const eventsList = data.Events || data.LiveEvents || data.value || (Array.isArray(data) ? data : []);

        // 📌 修復 2：台南 debug - 印出原始筆數 + 座標欄位結構
        if (target.name === "台南市") {
          console.log(`🔍 [台南 debug] ${evType} 原始資料筆數: ${eventsList.length}`);
          if (eventsList.length > 0) {
            const s = eventsList[0];
            console.log(`🔍 [台南 debug] 第一筆欄位:`, JSON.stringify({
              EventID: s.EventID || s.RoadEventID,
              summary: (s.EventTitle || s.EventSummary || s.Description || "").slice(0, 40),
              PositionLat: s.PositionLat,
              PositionLon: s.PositionLon,
              EventPosition: s.EventPosition,
              Positions: typeof s.Positions === "string" ? s.Positions.slice(0, 80) : s.Positions,
              EndTime: s.EndTime || s.EventEndTime,
            }));
          }
        }

        eventsList.forEach(event => {
          const summary = event.EventTitle || event.EventSummary || event.Description || "";
          const eventId = event.EventID || event.RoadEventID;

          const endTime = event.EndTime || event.EventEndTime;
          if (endTime) {
            const endTs = new Date(endTime).getTime();
            if (endTs && endTs < Date.now()) return;
          }

          let lat, lng;

          if (event.Positions?.includes("POINT")) {
            // 📌 修復：POINT 後面可能有空格，例如 "POINT (x y)" 或 "POINT(x y)"
            const match = event.Positions.match(/POINT\s*\(([^\s]+)\s+([^)]+)\)/);
            if (match) { lng = parseFloat(match[1]); lat = parseFloat(match[2]); }
          } else {
            lat = event.PositionLat || event.EventPosition?.PositionLat;
            lng = event.PositionLon || event.EventPosition?.PositionLon;
          }

          if (eventId && summary && lat && lng) {
            if (summary.includes("宣導") || event.EventTypeName === "交通管制") return;

            const startTime = event.StartTime || event.EventStartTime || "";
            const timeInfo = (startTime || endTime) ? ` (預計期間: ${startTime} ~ ${endTime || '未定'})` : "";

            candidatesMap.set(eventId, {
              id: eventId,
              text: `【${event.EventTypeName || "路況"}】${summary}${timeInfo}`,
              lat, lng, city: target.name,
            });
            cityStats[target.name] = (cityStats[target.name] || 0) + 1;
          }
        });
      }
      console.log(`💤 ${target.name} 完畢，冷卻中...`);
      await delay(20000);
    }

    // ✅ 警廣：使用修復後的多端點嘗試邏輯
    console.log("\n⏳ 準備啟動警廣抓取...");
    const pbsData = await fetchPBS(token);
    pbsData.forEach(item => {
      candidatesMap.set(item.id, item);
      cityStats["警廣"] = (cityStats["警廣"] || 0) + 1;
    });

    console.log("\n--- 📊 本次成功抓取統計 ---");
    const allCities = [...tdxTargets.map(t => t.name), "警廣"];
    allCities.forEach(name => console.log(`${name}: ${cityStats[name] || 0} 筆`));
    console.log("---------------------------\n");

    const candidates = Array.from(candidatesMap.values());

    let itemsForAI = [];
    let newCacheList = [];
    let finalEvents = [];

    for (const item of candidates) {
      const cached = cacheMap.get(item.id);
      if (cached && cached.text === item.text) {
        newCacheList.push(cached);
        if (cached.isReal) finalEvents.push(cached);
      } else {
        itemsForAI.push(item);
      }
    }

    console.log(`🛡️ 篩選完成：沿用 ${candidates.length - itemsForAI.length} 筆，AI 審核 ${itemsForAI.length} 筆。`);

    for (let i = 0; i < itemsForAI.length; i += 20) {
      const batch = itemsForAI.slice(i, i + 20);
      const aiResults = await aiFilterEvents(batch);
      batch.forEach(item => {
        const ai = aiResults.find(r => r.id === item.id);
        if (!ai) return;
        const processedItem = {
          ...item,
          title: ai.title || item.text,
          category: ai.category || "accident",
          isReal: ai.isReal,
          expiresAt: Date.now() + Math.min(ai.ttl_hours || 4, 8) * 60 * 60 * 1000,
        };
        newCacheList.push(processedItem);
        if (ai.isReal) finalEvents.push(processedItem);
      });
    }

    cacheMap.forEach(cached => {
      if (!newCacheList.find(n => n.id === cached.id)) {
        if (cached.expiresAt > Date.now()) {
          newCacheList.push(cached);
          if (cached.isReal) finalEvents.push(cached);
        }
      }
    });

    console.log("\n📰 [新聞] 開始處理新聞來源...");
    const newsEvents = await fetchNews();

    let rawNewsCache = await kv.get("taiwan_news_cache");
    let newsCacheMap = new Map();
    if (rawNewsCache) {
      const parsed = typeof rawNewsCache === "string" ? JSON.parse(rawNewsCache) : rawNewsCache;
      parsed.forEach(item => { if (item.expiresAt > Date.now()) newsCacheMap.set(item.id, item); });
    }

    newsEvents.forEach(item => newsCacheMap.set(item.id, item));
    const validNewsEvents = Array.from(newsCacheMap.values()).filter(n => n.expiresAt > Date.now());

    await kv.set("taiwan_news_cache", JSON.stringify(validNewsEvents));

    const allFinalEvents = [...finalEvents, ...validNewsEvents];

    await kv.set("taiwan_traffic_cache", JSON.stringify(newCacheList));
    await kv.set("taiwan_traffic_events", JSON.stringify(allFinalEvents));
    console.log(`💾 全部完工！交通 ${finalEvents.length} 筆 + 新聞 ${validNewsEvents.length} 筆 = 共 ${allFinalEvents.length} 筆`);

  } catch (error) {
    console.error("💥 錯誤:", error);
  }
}

main();
