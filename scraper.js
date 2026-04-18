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
  if (!data.access_token) {
    throw new Error("取得 Token 失敗！請檢查 TDX_CLIENT_ID 與 TDX_CLIENT_SECRET。");
  }
  return data.access_token;
}

// 加入 Retry 機制的 fetch
async function fetchTDX(url, token, desc, retries = 1) {
  console.log(`⏳ [${desc}] 抓取中...`);
  await delay(3000); // 延長至 3 秒，避免被 TDX 鎖 IP
  
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  
  // 遇到 429 頻率限制，等 5 秒後重試
  if (res.status === 429 && retries > 0) {
    console.log(`⚠️ [${desc}] 抓取太快觸發 429 限制，等待 5 秒後重試...`);
    await delay(5000);
    return fetchTDX(url, token, desc, retries - 1);
  }

  if (!res.ok) {
    console.error(`❌ [${desc}] 請求失敗 (狀態碼: ${res.status})`);
    return null;
  }
  return res.json();
}

async function aiFilterEvents(rawEvents) {
  if (rawEvents.length === 0) return [];
  console.log(`🤖 正在讓 GPT-4o mini 分析 ${rawEvents.length} 筆突發事件...`);
  
  const prompt = `
你是一位台灣突發新聞編輯。請分析以下「路況事件」文字，判斷其新聞價值。
任務：
1. 判斷是否為具有「地圖新聞價值」的事件 (isReal: true/false)。
   - ✅ 保留 (true)：嚴重車禍、火警、倒塌、淹水、土石流、大型抗爭、化學品洩漏、全線封閉。
   - ❌ 拒絕 (false)：單純施工公告、例行性交管、沒內容的測試、宣導標語、過期訊息。
2. 重新潤飾標題 (title)：將簡碼轉成易讀的新聞標題 (如 "國1南向10K車禍" 改為 "國道1號南向10K處車禍")。
3. 精準分類 (category)：accident / disaster / construction / activity
4. 預估存活時間 (ttl_hours)：事故/災情 4，施工/活動 168，無效事件 720。

請回傳 JSON 格式：
{"events": [{"id": "原始ID", "title": "潤飾標題", "category": "分類", "isReal": true/false, "ttl_hours": 數字}]}

待處理資料：
${JSON.stringify(rawEvents.map(e => ({ id: e.id, text: e.text })))}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: "你只會回傳 JSON" }, { role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });
    return JSON.parse(response.choices[0].message.content).events || [];
  } catch (err) {
    console.error("❌ AI 錯誤:", err);
    return [];
  }
}

async function main() {
  try {
    console.log("🚀 啟動全台新聞事件同步 (破解 POINT 座標 + 防 429 版)...");
    const token = await getTDXToken();
    
    let rawCache = await kv.get("taiwan_traffic_cache");
    let cacheMap = new Map();
    const now = Date.now();
    if (rawCache) {
      const parsedCache = typeof rawCache === "string" ? JSON.parse(rawCache) : rawCache;
      parsedCache.forEach(item => { if (item.expiresAt > now) cacheMap.set(item.id, item); });
    }
    console.log(`🗃️ 載入有效快取：${cacheMap.size} 筆`);

    let candidatesMap = new Map(); 
    
    // 只保留 TDX 官方有支援的 9 大縣市 + 國道 + 省道
    const targets = [
      { path: "City/Keelung", name: "基隆市" }, { path: "City/Taipei", name: "台北市" },
      { path: "City/NewTaipei", name: "新北市" }, { path: "City/Taoyuan", name: "桃園市" },
      { path: "City/Taichung", name: "台中市" }, { path: "City/Tainan", name: "台南市" },
      { path: "City/Kaohsiung", name: "高雄市" }, { path: "City/YilanCounty", name: "宜蘭縣" },
      { path: "City/KinmenCounty", name: "金門縣" }, { path: "Highway", name: "省道" }, 
      { path: "Freeway", name: "國道" }
    ];

    for (const target of targets) {
      const eventTypes = ["Event", "LiveEvent"];
      
      for (const evType of eventTypes) {
        const url = `https://tdx.transportdata.tw/api/basic/v1/Traffic/RoadEvent/${evType}/${target.path}?$format=JSON`;
        const data = await fetchTDX(url, token, `${target.name}-${evType}`);
        
        if (!data) continue;

        const eventsList = data.Events || data.LiveEvents || data.value || (Array.isArray(data) ? data : []);

        for (const event of eventsList) {
          const summary = event.EventTitle || event.EventSummary || event.Description || "";
          const eventId = event.EventID || event.RoadEventID;
          
          let lat = null;
          let lng = null;

          // 💡 破解 TDX 的 POINT 座標格式！
          if (event.Positions && event.Positions.includes("POINT")) {
            const match = event.Positions.match(/POINT\(([^ ]+) ([^)]+)\)/);
            if (match) {
              lng = parseFloat(match[1]); // 第一個數字是經度
              lat = parseFloat(match[2]); // 第二個數字是緯度
            }
          } else {
            // 備用方案
            lat = event.PositionLat || event.EventPosition?.PositionLat;
            lng = event.PositionLon || event.EventPosition?.PositionLon;
          }
          
          if (!eventId || !summary || !lat || !lng) continue;
          
          // 初步排除明顯垃圾資訊
          if (summary.includes("宣導") || event.EventTypeName === "交通障礙" || event.EventTypeName === "交通管制") {
              continue; 
          }

          candidatesMap.set(eventId, {
            id: eventId,
            text: `【${event.EventTypeName || '事件'}】${summary}`,
            lat: lat,
            lng: lng,
            city: target.name
          });
        }
      }
    }

    const candidates = Array.from(candidatesMap.values());
    console.log(`\n✅ 欄位與座標過濾後，共抓到 ${candidates.length} 筆潛在事件。`);
    
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

    console.log(`🛡️ Diffing 完成！沿用快取 ${candidates.length - itemsForAI.length} 筆，AI 將處理 ${itemsForAI.length} 筆新資料。`);

    // 分批交給 AI 處理
    for (let i = 0; i < itemsForAI.length; i += 20) {
      const batch = itemsForAI.slice(i, i + 20);
      const aiResults = await aiFilterEvents(batch);
      
      batch.forEach(item => {
        const aiDecision = aiResults.find(r => r.id === item.id);
        if (aiDecision) {
          const ttlMs = (aiDecision.ttl_hours || 4) * 60 * 60 * 1000;
          const processedItem = {
            id: item.id,
            text: item.text,          
            title: aiDecision.title || item.text, 
            content: item.text,
            category: aiDecision.category || "accident",
            isReal: aiDecision.isReal,
            source: "TDX RoadEvent",
            lat: item.lat,
            lng: item.lng,
            city: item.city,
            expiresAt: now + ttlMs    
          };

          newCacheList.push(processedItem);
          if (aiDecision.isReal) finalEvents.push(processedItem); 
        }
      });
    }

    cacheMap.forEach(cached => {
      if (!newCacheList.find(n => n.id === cached.id)) {
        newCacheList.push(cached);
        if (cached.isReal) finalEvents.push(cached);
      }
    });

    await kv.set("taiwan_traffic_cache", JSON.stringify(newCacheList));
    await kv.set("taiwan_traffic_events", JSON.stringify(finalEvents));
    
    console.log(`💾 完工！共 ${newCacheList.length} 筆寫入快取，最終產生 ${finalEvents.length} 筆地圖新聞事件。`);

  } catch (error) {
    console.error("💥 執行發生錯誤:", error);
  }
}

main();
