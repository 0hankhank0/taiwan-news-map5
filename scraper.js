const { Redis } = require("@upstash/redis");
const OpenAI = require("openai");

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getTDXToken() {
  console.log("🔑 正在向 TDX 申請 Token...");
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", process.env.TDX_CLIENT_ID);
  params.append("client_secret", process.env.TDX_CLIENT_SECRET);
  const res = await fetch("https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = await res.json();
  return data.access_token;
}

async function fetchTDX(url, token, desc, retries = 2) {
  console.log(`⏳ [${desc}] 抓取中...`);
  await delay(4000); // 基礎等待提高到 4 秒，安全第一
  
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  
  if (res.status === 429 && retries > 0) {
    console.log(`⚠️ [${desc}] 觸發頻率限制，深呼吸 8 秒後重試...`);
    await delay(8000);
    return fetchTDX(url, token, desc, retries - 1);
  }

  if (!res.ok) {
    console.error(`❌ [${desc}] 失敗 (狀態碼: ${res.status})`);
    return null;
  }
  return res.json();
}

async function aiFilterEvents(rawEvents) {
  if (rawEvents.length === 0) return [];
  console.log(`🤖 AI 正在審核 ${rawEvents.length} 筆潛在新聞...`);
  
  const prompt = `
你是一位台灣突發新聞編輯。請分析路況文字，判斷地圖新聞價值。
1. isReal (true): 嚴重車禍、火警、倒塌、淹水、土石流、大型抗爭、化學品、全線封閉、影響超過2線道之事故。
2. isReal (false): 單純施工、例行交管、宣導標語、過期訊息。
3. title: 潤飾標題(如: "國1南向10K車禍")。
4. category: accident / disaster / construction / activity
請回傳 JSON: {"events": [{"id": "ID", "title": "標題", "category": "分類", "isReal": true/false, "ttl_hours": 4}]}
資料：${JSON.stringify(rawEvents.map(e => ({ id: e.id, text: e.text })))}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: "你只回傳 JSON" }, { role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });
    return JSON.parse(response.choices[0].message.content).events || [];
  } catch (err) { return []; }
}

async function main() {
  try {
    console.log("🚀 啟動全台新聞同步系統 (優先權重優化版)...");
    const token = await getTDXToken();
    
    let rawCache = await kv.get("taiwan_traffic_cache");
    let cacheMap = new Map();
    if (rawCache) {
      const parsed = typeof rawCache === "string" ? JSON.parse(rawCache) : rawCache;
      parsed.forEach(item => { if (item.expiresAt > Date.now()) cacheMap.set(item.id, item); });
    }

    let candidatesMap = new Map(); 
    let cityStats = {}; // 統計用

    // 🏆 調整排序：國道與省道放在最前面，確保不會被 429 擋掉
    const targets = [
      { path: "Freeway", name: "國道" },
      { path: "Highway", name: "省道" },
      { path: "City/Taipei", name: "台北市" },
      { path: "City/NewTaipei", name: "新北市" },
      { path: "City/Taichung", name: "台中市" },
      { path: "City/Kaohsiung", name: "高雄市" },
      { path: "City/Tainan", name: "台南市" },
      { path: "City/Taoyuan", name: "桃園市" },
      { path: "City/Keelung", name: "基隆市" },
      { path: "City/YilanCounty", name: "宜蘭縣" },
      { path: "City/KinmenCounty", name: "金門縣" }
    ];

    for (const target of targets) {
      for (const evType of ["Event", "LiveEvent"]) {
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
              text: `【${event.EventTypeName || '路況'}】${summary}`,
              lat, lng, city: target.name
            });
            // 累加統計
            cityStats[target.name] = (cityStats[target.name] || 0) + 1;
          }
        });
      }
      await delay(2000); // 每個縣市跑完多休息 2 秒，避免被封鎖
    }

    console.log("\n--- 📊 抓取成果統計表 ---");
    Object.entries(cityStats).forEach(([name, count]) => console.log(`${name}: ${count} 筆`));
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

    console.log(`🛡️ Diffing: 沿用 ${candidates.length - itemsForAI.length} 筆，AI 處理 ${itemsForAI.length} 筆。`);

    for (let i = 0; i < itemsForAI.length; i += 20) {
      const batch = itemsForAI.slice(i, i + 20);
      const aiResults = await aiFilterEvents(batch);
      
      batch.forEach(item => {
        const ai = aiResults.find(r => r.id === item.id);
        if (ai) {
          const processedItem = {
            ...item,
            title: ai.title || item.text, 
            category: ai.category || "accident",
            isReal: ai.isReal,
            expiresAt: Date.now() + (ai.ttl_hours || 4) * 60 * 60 * 1000
          };
          newCacheList.push(processedItem);
          if (ai.isReal) finalEvents.push(processedItem); 
        }
      });
    }

    // 補回沒在本次名單但在快取中未過期的資料
    cacheMap.forEach(cached => {
      if (!newCacheList.find(n => n.id === cached.id)) {
        newCacheList.push(cached);
        if (cached.isReal) finalEvents.push(cached);
      }
    });

    await kv.set("taiwan_traffic_cache", JSON.stringify(newCacheList));
    await kv.set("taiwan_traffic_events", JSON.stringify(finalEvents));
    console.log(`💾 完工！產出 ${finalEvents.length} 筆全台事件。`);

  } catch (error) { console.error("💥 錯誤:", error); }
}

main();
