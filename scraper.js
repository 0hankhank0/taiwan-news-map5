process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // 忽略政府網站過期的 SSL 憑證
const { Redis } = require("@upstash/redis");
const OpenAI = require("openai");

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

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
  console.log(`❌ ${label} 重試 ${retries} 次後放棄`);
  return null;
}

async function aiFilterEvents(items) {
  if (items.length === 0) return [];
  const prompt = `你是台灣交通事件篩選器。以下是交通事件列表，請判斷每筆是否為真實影響用路人的事件。
請回傳 JSON 陣列，每個物件包含：
- id: 原始 id
- isReal: boolean（是否為真實影響交通的事件）
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

// ==========================================
// 🌟 地方與全國外掛 API (Adapter) 區塊
// ==========================================

// ==========================================
// 🌟 地方與全國外掛 API (Adapter) 區塊 (防阻擋升級版)
// ==========================================

// 偽裝成一般瀏覽器，避免被政府防火牆阻擋
const fetchOptions = {
  headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
};

// 1. 警廣 (全台即時路況)
async function fetchPBS() {
  console.log("⏳ [全台-警廣 API] 抓取中...");
  let results = [];
  try {
    const res = await fetch("https://rtr.pbs.gov.tw/NMP103_PbsWS/resources/roadData/opendata", fetchOptions);
    const rawData = await res.json();
    const records = Array.isArray(rawData) ? rawData : (rawData.result || rawData.data || []);

    records.forEach(item => {
      const lat = item.y1 || item.lat || item.緯度;
      const lng = item.x1 || item.lng || item.經度;
      const text = item.srcdetail || item.comment || item.說明 || item.RoadName;
      const id = item.UID || item.id || item.發布編號 || Math.random().toString(36).substring(7);
      
      if (lat && lng && text) {
        results.push({ id: `PBS_${id}`, text: `【警廣路況】${text}`, lat: parseFloat(lat), lng: parseFloat(lng), city: "警廣通報" });
      }
    });
    console.log(`✅ [警廣] 成功轉換 ${results.length} 筆資料！`);
  } catch (e) { console.error("❌ 警廣 API 錯誤:", e.message); }
  return results;
}

// 2. 台中市 (道路施工)
async function fetchTaichung() {
  console.log("⏳ [台中市-地方API] 抓取中...");
  let results = [];
  try {
    const res = await fetch("https://newdatacenter.taichung.gov.tw/api/v1/no-auth/resource.download?rid=d5adb71a-00bb-4573-b67e-ffdccfc7cd27", fetchOptions);
    const records = await res.json();
    
    records.forEach(item => {
      const lat = item.Lat || item.緯度 || item.Y;
      const lng = item.Lng || item.經度 || item.X;
      const text = item.Description || item.施工說明 || item.案件說明 || item.地點;
      const id = item.ID || item.案件編號 || item.序號 || Math.random().toString(36).substring(7);

      if (lat && lng && text) {
        results.push({ id: `TC_${id}`, text: `【台中施工】${text}`, lat: parseFloat(lat), lng: parseFloat(lng), city: "台中市" });
      }
    });
    console.log(`✅ [台中] 成功轉換 ${results.length} 筆資料！`);
  } catch (e) { console.error("❌ 台中 API 錯誤:", e.message); }
  return results;
}

// 3. 桃園市 (替換為正確的 CKAN JSON API 網址)
async function fetchTaoyuan() {
  console.log("⏳ [桃園市-地方API] 抓取中...");
  let results = [];
  try {
    // 改用桃園開放資料庫的 JSON API 節點，不再下載 CSV
    const res = await fetch("https://opendata.tycg.gov.tw/api/3/action/datastore_search?resource_id=56aba135-d55a-4d87-b35b-048e477abb17&limit=1000", fetchOptions);
    const data = await res.json();
    const records = data.result?.records || [];
    
    records.forEach(item => {
      const lat = item.WGS84_Y || item.Lat || item.緯度;
      const lng = item.WGS84_X || item.Lng || item.經度;
      const text = item.工程名稱 || item.施工內容 || item.宣導內容 || item.地點;
      const id = item.案件編號 || item._id || Math.random().toString(36).substring(7);

      if (lat && lng && text) {
        results.push({ id: `TY_${id}`, text: `【桃園施工】${text}`, lat: parseFloat(lat), lng: parseFloat(lng), city: "桃園市" });
      }
    });
    console.log(`✅ [桃園] 成功轉換 ${results.length} 筆資料！`);
  } catch (e) { console.error("❌ 桃園 API 錯誤:", e.message); }
  return results;
}

// 4. 高雄市 (管線挖掘)
async function fetchKaohsiung() {
  console.log("⏳ [高雄市-地方API] 抓取中...");
  let results = [];
  try {
    const res = await fetch("https://pipegis.kcg.gov.tw/openDataService.aspx", fetchOptions);
    const records = await res.json();
    
    records.forEach(item => {
      const lat = item.Y || item.緯度 || item.wgs84_y;
      const lng = item.X || item.經度 || item.wgs84_x;
      const text = item.工程名稱 || item.施工內容 || item.案件說明;
      const id = item.案件編號 || item.pii_id || Math.random().toString(36).substring(7);

      if (lat && lng && text) {
        results.push({ id: `KH_${id}`, text: `【高雄施工】${text}`, lat: parseFloat(lat), lng: parseFloat(lng), city: "高雄市" });
      }
    });
    console.log(`✅ [高雄] 成功轉換 ${results.length} 筆資料！`);
  } catch (e) { console.error("❌ 高雄 API 錯誤:", e.message); }
  return results;
}

// ==========================================
// 🚀 主程式區塊
// ==========================================

async function main() {
  try {
    console.log("🚀 啟動全台新聞同步系統 (終極雙軌外掛版)...");
    const token = await getTDXToken();

    let rawCache = await kv.get("taiwan_traffic_cache");
    let cacheMap = new Map();
    if (rawCache) {
      const parsed = typeof rawCache === "string" ? JSON.parse(rawCache) : rawCache;
      parsed.forEach(item => { if (item.expiresAt > Date.now()) cacheMap.set(item.id, item); });
    }

    let candidatesMap = new Map();
    let cityStats = {};

    // 🏆 1. 執行 TDX 陣營 (移除中南三都，專心抓雙北/台南/國省道)
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

    // 🏆 2. 執行獨立 API 陣營 (警廣 + 地方政府)
    console.log("\n📡 [外掛 API] 開始抓取警廣與地方資料...");
    const localData = [
      ...(await fetchPBS()),
      ...(await fetchTaichung()),
      ...(await fetchTaoyuan()),
      ...(await fetchKaohsiung())
    ];

    localData.forEach(item => {
      candidatesMap.set(item.id, item);
      cityStats[item.city] = (cityStats[item.city] || 0) + 1;
    });

    console.log("\n--- 📊 本次成功抓取統計 ---");
    const allCities = [...tdxTargets.map(t => t.name), "警廣通報", "台中市", "桃園市", "高雄市"];
    allCities.forEach(name => console.log(`${name}: ${cityStats[name] || 0} 筆`));
    console.log("---------------------------\n");

    const candidates = Array.from(candidatesMap.values());
    if (candidates.length === 0) {
      console.log("⚠️ 沒抓到任何新資料，可能是全部被 429 了。");
      return;
    }

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
        if (!ai) {
          console.log(`⚠️ AI 沒有回傳 ${item.id} 的結果，跳過`);
          return;
        }
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
    console.log(`💾 全部完工！產出 ${finalEvents.length} 筆全台地圖事件。`);

  } catch (error) {
    console.error("💥 錯誤:", error);
  }
}

main();
