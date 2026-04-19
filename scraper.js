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
    // ── 原有來源 ──
    { url: "https://news.ltn.com.tw/rss/society.xml",   name: "自由社會" },
    { url: "https://news.ltn.com.tw/rss/local.xml",     name: "自由地方" },

    // ── 新增：TVBS 社會 ──
    { url: "https://news.tvbs.com.tw/rss/news/society",  name: "TVBS社會" },

    // ── 新增：ETtoday 社會、地方 ──
    { url: "https://feeds.feedburner.com/ettoday/ETtodaySociety", name: "ETtoday社會" },
    { url: "https://feeds.feedburner.com/ettoday/ETtodayRegional", name: "ETtoday地方" },

    // ── 新增：三立新聞 社會 ──
    { url: "https://www.setn.com/rss.aspx?tid=12",       name: "三立社會" },

    // ── 新增：中時社會 ──
    { url: "https://www.chinatimes.com/rss/society.xml", name: "中時社會" },

    // ── 新增：聯合新聞網 社會 ──
    { url: "https://udn.com/rssfeed/news/2/0?crsdomain=udn.com", name: "聯合社會" },

    // ── 新增：NOWnews 社會 ──
    { url: "https://www.nownews.com/cat/7/feed",          name: "NOWnews社會" },
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
// 外掛 API：v2 Road/Traffic/Live 路段即時壅塞
// ==========================================
async function fetchPBS(token) {
  console.log("⏳ [Live路況] 開始抓取各縣市路段即時壅塞...");
  let results = [];

  const liveTargets = [
    { city: "Taoyuan",        name: "桃園市" },
    { city: "ChanghuaCounty", name: "彰化縣" },
    { city: "Hsinchu",        name: "新竹市" },
    { city: "YunlinCounty",   name: "雲林縣" },
  ];

  for (const t of liveTargets) {
    const url = `https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/City/${t.city}?$format=JSON`;
    const data = await fetchTDX(url, token, `Live-${t.name}`);
    if (!data) { await delay(3000); continue; }

    const sections = Array.isArray(data) ? data :
      (data?.LiveTrafficData || data?.RoadSections || data?.Sections ||
       data?.LiveTraffics || data?.value || []);

    console.log(`📦 [Live-${t.name}] 原始路段數: ${sections.length}`);

    if (sections.length > 0) {
      const s0 = sections[0];
      console.log(`🔍 [Live-${t.name}] 第一筆欄位:`, JSON.stringify({
        SectionID: s0.SectionID || s0.RoadID,
        LiveLevel: s0.LiveLevel,
        CongestionLevel: s0.CongestionLevel,
        TrafficLevel: s0.TrafficLevel,
        Level: s0.Level,
        Status: s0.Status,
        LiveSpeed: s0.LiveSpeed || s0.Speed,
        keys: Object.keys(s0).slice(0, 12),
      }));
    }

    let added = 0;
    sections.forEach(sec => {
      const level = sec.LiveLevel ?? sec.CongestionLevel ?? sec.TrafficLevel ?? sec.Level ?? -1;
      if (level < 2 || level > 3) return;

      let lat = sec.StartLat || sec.PositionLat || sec.Lat ||
                sec.StartPosition?.PositionLat || sec.GeometryCenter?.PositionLat;
      let lng = sec.StartLon || sec.PositionLon || sec.Lon ||
                sec.StartPosition?.PositionLon || sec.GeometryCenter?.PositionLon;

      const wkt = sec.Geometry || sec.RoadGeometry || "";
      if (!lat && wkt.includes("LINESTRING")) {
        const m = wkt.match(/LINESTRING[^(]*\(([^,]+)/);
        if (m) {
          const parts = m[1].trim().split(/\s+/);
          if (parts.length >= 2) { lng = parseFloat(parts[0]); lat = parseFloat(parts[1]); }
        }
      }

      if (!lat || !lng) return;

      const roadName = sec.RoadName || sec.SectionName || sec.RoadID || "路段";
      const levelText = level === 2 ? "壅塞" : "嚴重壅塞";
      const speed = sec.LiveSpeed ?? sec.Speed ?? "";
      const speedText = speed !== "" ? `(${speed}km/h)` : "";
      const id = sec.SectionID || sec.RoadID || sec.ID || Math.random().toString(36).substring(7);

      results.push({
        id: `LIVE_${t.city}_${id}`,
        text: `【${t.name}路況】${roadName} ${levelText}${speedText}`,
        lat, lng, city: t.name,
      });
      added++;
    });

    console.log(`✅ [Live-${t.name}] 壅塞路段: ${added} 筆`);
    await delay(5000);
  }

  console.log(`✅ [Live路況+事故] 成功整理 ${results.length} 筆！`);
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

// 【修復】判斷是否為無意義的施工通用案件
function isEmptyConstructionEvent(summary, eventTypeName) {
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
  ];
  if (genericPatterns.some(p => p.test(summary.trim()))) return true;
  return false;
}

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

    // 各城市寫入上限（避免單一城市塞爆）
    const CITY_LIMIT = 50;

    let tdxTargets = [
      { path: "Freeway",           name: "國道",   types: ["LiveEvent"] },
      { path: "Highway",           name: "省道",   types: ["LiveEvent"] },
      { path: "City/Taipei",       name: "台北市", types: ["Event", "LiveEvent"] },
      { path: "City/NewTaipei",    name: "新北市", types: ["Event", "LiveEvent"] },
      { path: "City/Taichung",     name: "台中市", types: ["Event", "LiveEvent"] },
      { path: "City/Tainan",       name: "台南市", types: ["Event", "LiveEvent"] },
      { path: "City/Keelung",      name: "基隆市", types: ["Event", "LiveEvent"] },
      { path: "City/YilanCounty",  name: "宜蘭縣", types: ["Event", "LiveEvent"] },
      { path: "City/Kaohsiung",    name: "高雄市", types: ["Event", "LiveEvent"] },
      { path: "City/KinmenCounty", name: "金門縣", types: ["Event", "LiveEvent"] },
      { path: "City/Taoyuan",      name: "桃園市", types: ["Event", "LiveEvent"] },
    ];

    tdxTargets = tdxTargets.sort(() => Math.random() - 0.5);
    console.log(`📡 [中央 TDX] 本次抓取順序：${tdxTargets.map(t => t.name).join(" -> ")}`);

    for (const target of tdxTargets) {
      for (const evType of target.types) {
        const url = `https://tdx.transportdata.tw/api/basic/v1/Traffic/RoadEvent/${evType}/${target.path}?$format=JSON`;
        const data = await fetchTDX(url, token, `${target.name}-${evType}`);
        if (!data) continue;

        const eventsList = data.Events || data.LiveEvents || data.value || (Array.isArray(data) ? data : []);

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

          // 【修復】過濾無摘要的通用施工案件
          if (isEmptyConstructionEvent(summary, event.EventTypeName)) return;

          // 過濾宣導、交通管制
          if (summary.includes("宣導") || event.EventTypeName === "交通管制") return;

          // 【修復】城市筆數上限
          if ((cityStats[target.name] || 0) >= CITY_LIMIT) return;

          const endTime = event.EndTime || event.EventEndTime;
          if (endTime) {
            const endTs = new Date(endTime).getTime();
            if (endTs && endTs < Date.now()) return;
          }

          let lat, lng;

          if (event.Positions?.includes("POINT")) {
            const match = event.Positions.match(/POINT\s*\(([^\s]+)\s+([^)]+)\)/);
            if (match) { lng = parseFloat(match[1]); lat = parseFloat(match[2]); }
          } else {
            lat = event.PositionLat || event.EventPosition?.PositionLat;
            lng = event.PositionLon || event.EventPosition?.PositionLon;
          }

          if (eventId && summary && lat && lng) {
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

    console.log("\n⏳ 準備啟動警廣抓取...");
    const pbsData = await fetchPBS(token);
    pbsData.forEach(item => {
      candidatesMap.set(item.id, item);
      cityStats["警廣"] = (cityStats["警廣"] || 0) + 1;
    });

    console.log("\n--- 📊 本次成功抓取統計 ---");
    const allCities = [...tdxTargets.map(t => t.name), "彰化縣", "新竹市", "雲林縣"];
    allCities.forEach(name => { if (cityStats[name]) console.log(`${name}: ${cityStats[name]} 筆`); });
    console.log(`合計: ${Array.from(candidatesMap.values()).length} 筆候選`);
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
