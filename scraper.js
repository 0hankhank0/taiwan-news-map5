process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // ⚠️ 破解政府網站過期的 SSL 憑證 (必須放在第一行)

const { Redis } = require("@upstash/redis");
const OpenAI = require("openai");

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// 偽裝成一般瀏覽器，避免被政府防火牆阻擋
const fetchOptions = {
  headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
};

// 獲取當前台灣時間，交給 AI 判斷是否過期
const todayStr = new Date().toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" });

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
  
  // 💡 神級 Prompt：賦予 AI 時間觀念，自動過濾歷史資料
  const prompt = `你是台灣交通事件篩選器。今天日期是【${todayStr}】。
請分析以下事件，判斷是否為「目前正在發生」且「真實影響用路人」的事件。
特別注意：如果事件提供的時間資訊(如迄日、完工日、結束日期)早於今天，代表已過期，請務必將 isReal 設為 false！

請回傳 JSON 陣列，每個物件包含：
- id: 原始 id
- isReal: boolean（是否為真實且未過期的事件）
- title: 簡短中文標題（20字內）
- category: "accident"（事故）| "construction"（施工）| "congestion"（壅塞）| "other"
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

// 💡 提取日期資訊的輔助函數
function extractDateInfo(item) {
  return Object.entries(item)
    .filter(([k]) => k.includes("日") || k.includes("時間") || k.includes("Date"))
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");
}

// ==========================================
// 🌟 地方與全國外掛 API (Adapter) 區塊
// ==========================================

async function fetchPBS() {
  console.log("⏳ [全台-警廣 API] 抓取中...");
  let results = [];
  try {
    const res = await fetch(
      "https://od.moi.gov.tw/api/v1/rest/datastore/A01010000C-001114-001?format=json&limit=1000",
      fetchOptions
    );
    const data = await res.json();
    const records = data.result?.records || [];

    records.forEach(item => {
      const lat = item.y1;
      const lng = item.x1;
      const text = item.comment || item.srcdetail || item.road;
      const id = item.UID || Math.random().toString(36).substring(7);

      if (lat && lng && text) {
        results.push({
          id: `PBS_${id}`,
          text: `【警廣路況】${text}`,
          lat: parseFloat(lat),
          lng: parseFloat(lng),
          city: "警廣通報"
        });
      }
    });
    console.log(`✅ [警廣] 成功轉換 ${results.length} 筆資料！`);
  } catch (e) { console.error("❌ 警廣 API 錯誤:", e.message); }
  return results;
}

async function fetchTaichung() {
  console.log("⏳ [台中市-地方API] 抓取中...");
  let results = [];
  try {
    const res = await fetch("https://newdatacenter.taichung.gov.tw/api/v1/no-auth/resource.download?rid=d5adb71a-00bb-4573-b67e-ffdccfc7cd27", fetchOptions);
    const records = await res.json();
    
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    records.forEach(item => {
      const lat = item.Lat || item.緯度 || item.Y;
      const lng = item.Lng || item.經度 || item.X;
      const text = item.Description || item.施工說明 || item.案件說明 || item.地點;
      const id = item.ID || item.案件編號 || item.序號 || Math.random().toString(36).substring(7);
      const dateInfo = extractDateInfo(item);

      // 嘗試找結束日期，如果已過期就跳過
      const endDateStr = item.迄日 || item.完工日 || item.結束日期 || item.EndDate;
      if (endDateStr) {
        const endDate = new Date(endDateStr).getTime();
        if (!isNaN(endDate) && endDate < Date.now()) return; // 已過期，跳過
      }

      // 嘗試找開始日期，只保留近 30 天
      const startDateStr = item.起日 || item.開工日 || item.開始日期 || item.StartDate;
      if (startDateStr) {
        const startDate = new Date(startDateStr).getTime();
        if (!isNaN(startDate) && startDate < thirtyDaysAgo) return; // 太舊，跳過
      }

      if (lat && lng && text) {
        results.push({ 
          id: `TC_${id}`, 
          text: `【台中施工】${text} (時間資訊: ${dateInfo})`, 
          lat: parseFloat(lat), 
          lng: parseFloat(lng), 
          city: "台中市" 
        });
      }
    });
    console.log(`✅ [台中] 成功轉換 ${results.length} 筆資料！`);
  } catch (e) { console.error("❌ 台中 API 錯誤:", e.message); }
  return results;
}

// ==========================================
// 🚀 主程式區塊
// ==========================================

async function main() {
  try {
    console.log("🚀 啟動全台新聞同步系統 (防禦過期資料升級版)...");
    const token = await getTDXToken();

    let rawCache = await kv.get("taiwan_traffic_cache");
    let cacheMap = new Map();
    if (rawCache) {
      const parsed = typeof rawCache === "string" ? JSON.parse(rawCache) : rawCache;
      parsed.forEach(item => { if (item.expiresAt > Date.now()) cacheMap.set(item.id, item); });
    }

    let candidatesMap = new Map();
    let cityStats = {};

    let tdxTargets = [
      { path: "Freeway", name: "國道", types: ["LiveEvent"] },
      { path: "Highway", name: "省道", types: ["LiveEvent"] },
      { path: "City/Taipei", name: "台北市", types: ["Event", "LiveEvent"] },
      { path: "City/NewTaipei", name: "新北市", types: ["Event", "LiveEvent"] },
      { path: "City/Tainan", name: "台南市", types: ["Event", "LiveEvent"] },
      { path: "City/Keelung", name: "基隆市", types: ["Event", "LiveEvent"] },
      { path: "City/YilanCounty", name: "宜蘭縣", types: ["Event", "LiveEvent"] },
    ];

    tdxTargets = tdxTargets.sort(() => Math.random() - 0.5);
    console.log(`📡 [中央 TDX] 本次抓取順序：${tdxTargets.map(t => t.name).join(" -> ")}`);

    for (const target of tdxTargets) {
      for (const evType of target.types) {
        const url = `https://tdx.transportdata.tw/api/basic/v1/Traffic/RoadEvent/${evType}/${target.path}?$format=JSON`;
        const data = await fetchTDX(url, token, `${target.name}-${evType}`);
        if (!data) continue;

        const eventsList = data.Events || data.LiveEvents || data.value || (Array.isArray(data) ? data : []);

        eventsList.forEach(event => {
          const summary = event.EventTitle || event.EventSummary || event.Description || "";
          const eventId = event.EventID || event.RoadEventID;
          let lat, lng;

          if (event.Positions?.includes("POINT")) {
            const match = event.Positions.match(/POINT\(([^ ]+) ([^)]+)\)/);
            if (match) { lng = parseFloat(match[1]); lat = parseFloat(match[2]); }
          } else {
            lat = event.PositionLat || event.EventPosition?.PositionLat;
            lng = event.PositionLon || event.EventPosition?.PositionLon;
          }

          if (eventId && summary && lat && lng) {
            if (summary.includes("宣導") || event.EventTypeName === "交通管制") return;
            candidatesMap.set(eventId, {
              id: eventId,
              text: `【${event.EventTypeName || "路況"}】${summary}`,
              lat, lng, city: target.name,
            });
            cityStats[target.name] = (cityStats[target.name] || 0) + 1;
          }
        });
      }
      console.log(`💤 ${target.name} 完畢，冷卻中...`);
      await delay(20000);
    }

    console.log("\n📡 [外掛 API] 開始抓取警廣與地方資料...");
    const localData = [
      ...(await fetchPBS()),
      ...(await fetchTaichung()),
      ...(await fetchTaoyuan()),
      ...(await fetchKaohsiung())
    ];

 const localData = await fetchTaichung();
localData.forEach(item => {
  candidatesMap.set(item.id, item);
  cityStats[item.city] = (cityStats[item.city] || 0) + 1;
});

    console.log("\n--- 📊 本次成功抓取統計 ---");
    const allCities = [...tdxTargets.map(t => t.name), "警廣通報", "台中市", "桃園市", "高雄市"];
    allCities.forEach(name => console.log(`${name}: ${cityStats[name] || 0} 筆`));
    console.log("---------------------------\n");

    const candidates = Array.from(candidatesMap.values());
    if (candidates.length === 0) return;

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
          expiresAt: Date.now() + (ai.ttl_hours || 4) * 60 * 60 * 1000,
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

    await kv.set("taiwan_traffic_cache", JSON.stringify(newCacheList));
    await kv.set("taiwan_traffic_events", JSON.stringify(finalEvents));
    console.log(`💾 全部完工！產出 ${finalEvents.length} 筆最新且未過期的全台地圖事件。`);

  } catch (error) {
    console.error("💥 錯誤:", error);
  }
}

main();
