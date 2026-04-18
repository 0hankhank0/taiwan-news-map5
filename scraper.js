\const { Redis } = require("@upstash/redis");
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

async function fetchTDX(url, token, desc) {
  console.log(`⏳ [${desc}] 抓取中...`);
  await delay(2000); // 延遲 2 秒避免被 TDX 阻擋
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  return res.ok ? res.json() : null;
}

// 🤖 AI 篩選核心函數 (針對新聞事件優化)
async function aiFilterEvents(rawEvents) {
  if (rawEvents.length === 0) return [];
  
  console.log(`🤖 正在讓 GPT-4o mini 分析 ${rawEvents.length} 筆突發事件的新聞價值...`);
  
  const prompt = `
你是一位台灣突發新聞編輯。請分析以下「路況事件」文字，判斷其新聞價值。
任務：
1. 判斷是否為具有「地圖新聞價值」的事件 (isReal: true/false)。
   - ✅ 保留 (true)：嚴重車禍、火警、倒塌、淹水、土石流、大型抗爭、化學品洩漏、全線封閉。
   - ❌ 拒絕 (false)：單純施工公告、例行性交管、沒內容的測試、宣導標語、過期訊息。
2. 重新潤飾標題 (title)：將口語或簡碼轉成易讀的新聞標題 (例如將 "國1南向10K車禍" 改為 "國道1號南向10K處發生車禍")。
3. 精準分類 (category)：
   - accident: 車禍、火燒車、散落物
   - disaster: 淹水、土石流、天候災情
   - construction: 重大施工封閉
   - activity: 大型活動交管
4. 預估事件存活時間 (ttl_hours)：
   - 事故/災情 (accident/disaster)：4 (小時)
   - 施工/活動 (construction/activity)：168 (7天)
   - 無效事件 (isReal=false)：720 (30天，避免重複判斷)

請回傳 JSON 格式，包含 events 陣列：
{
  "events": [
    {
      "id": "原始ID", 
      "title": "潤飾後的新聞標題", 
      "category": "accident|disaster|construction|activity", 
      "isReal": true/false, 
      "ttl_hours": 數字
    }
  ]
}

待處理資料：
${JSON.stringify(rawEvents.map(e => ({ id: e.id, text: e.text })))}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: "你只會回傳 JSON 格式的新聞事件分析資料。" }, { role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(response.choices[0].message.content);
    return result.events || [];
  } catch (err) {
    console.error("❌ AI 篩選發生錯誤:", err);
    return [];
  }
}

async function main() {
  try {
    console.log("🚀 啟動全台新聞事件同步 (RoadEvent 精準座標版)...");
    const token = await getTDXToken();
    
    // --- 1. 讀取並清理過期快取 ---
    let rawCache = await kv.get("taiwan_traffic_cache");
    let cacheMap = new Map();
    const now = Date.now();
    
    if (rawCache) {
      const parsedCache = typeof rawCache === "string" ? JSON.parse(rawCache) : rawCache;
      parsedCache.forEach(item => {
        if (item.expiresAt > now) {
          cacheMap.set(item.id, item);
        }
      });
    }
    console.log(`🗃️ 載入有效快取：${cacheMap.size} 筆`);

    // --- 2. 抓取 TDX RoadEvent 新資料 ---
    let candidatesMap = new Map(); // 用 Map 來去重
    
    // 包含所有的目標區域 (加入你特別交代的 City、Highway、Freeway)
    const targets = [
      { path: "City/Taipei", name: "台北市" }, { path: "City/NewTaipei", name: "新北市" },
      { path: "City/Taoyuan", name: "桃園市" }, { path: "City/Taichung", name: "台中市" },
      { path: "City/Tainan", name: "台南市" }, { path: "City/Kaohsiung", name: "高雄市" },
      { path: "Highway", name: "省道" }, { path: "Freeway", name: "國道" }
    ];

    for (const target of targets) {
      // 💡 為了保證「不漏掉」，我們同時抓 Event 與 LiveEvent
      const eventTypes = ["Event", "LiveEvent"];
      
      for (const evType of eventTypes) {
        const url = `https://tdx.transportdata.tw/api/basic/v1/Traffic/RoadEvent/${evType}/${target.path}?$format=JSON`;
        const data = await fetchTDX(url, token, `${target.name}-${evType}`);
        
        const eventsList = data?.Events || data?.LiveEvents || (Array.isArray(data) ? data : []);
        
        for (const event of eventsList) {
          const summary = event.EventSummary || event.Description || "";
          const lat = event.PositionLat;
          const lng = event.PositionLon;
          const eventId = event.EventID;
          
          // 排除沒有座標或沒有內容的無效資料
          if (!eventId || !summary || !lat || !lng) continue;
          
          // 粗略過濾：在送給 AI 之前，先把明顯沒有新聞價值的直接擋掉 (省錢)
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

    // --- 3. 進行 Diffing 比對 ---
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

    console.log(`🛡️ Diffing 完成！有 ${candidates.length - itemsForAI.length} 筆沿用快取，僅需讓 AI 處理 ${itemsForAI.length} 筆新資料。`);

    // --- 4. 批次交給 AI 處理新資料 ---
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
            title: aiDecision.title || item.text, // 使用 AI 潤飾後的新聞標題
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

    // --- 5. 寫回 Redis ---
    await kv.set("taiwan_traffic_cache", JSON.stringify(newCacheList));
    await kv.set("taiwan_traffic_events", JSON.stringify(finalEvents));
    
    console.log(`💾 完工！共 ${newCacheList.length} 筆寫入快取，產生 ${finalEvents.length} 筆地圖新聞事件。`);
  } catch (error) {
    console.error("💥 錯誤:", error.message);
  }
}

main();
