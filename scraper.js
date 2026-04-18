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
  await delay(1500); // 稍微調快一點，因為現在要抓的縣市變多了
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  return res.ok ? res.json() : null;
}

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
   - 無效事件 (isReal=false)：720 (30天)

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
    console.log("🚀 啟動全台新聞事件同步 (全台 22 縣市 + 座標修復版)...");
    const token = await getTDXToken();
    
    let rawCache = await kv.get("taiwan_traffic_cache");
    let cacheMap = new Map();
    const now = Date.now();
    
    if (rawCache) {
      const parsedCache = typeof rawCache === "string" ? JSON.parse(rawCache) : rawCache;
      parsedCache.forEach(item => {
        if (item.expiresAt > now) cacheMap.set(item.id, item);
      });
    }
    console.log(`🗃️ 載入有效快取：${cacheMap.size} 筆`);

    let candidatesMap = new Map(); 
    
    // 🌍 補齊全台 22 縣市 + 省道國道
    const targets = [
      { path: "City/Keelung", name: "基隆市" }, { path: "City/Taipei", name: "台北市" },
      { path: "City/NewTaipei", name: "新北市" }, { path: "City/Taoyuan", name: "桃園市" },
      { path: "City/Hsinchu", name: "新竹市" }, { path: "City/HsinchuCounty", name: "新竹縣" },
      { path: "City/MiaoliCounty", name: "苗栗縣" }, { path: "City/Taichung", name: "台中市" },
      { path: "City/ChanghuaCounty", name: "彰化縣" }, { path: "City/NantouCounty", name: "南投縣" },
      { path: "City/YunlinCounty", name: "雲林縣" }, { path: "City/Chiayi", name: "嘉義市" },
      { path: "City/ChiayiCounty", name: "嘉義縣" }, { path: "City/Tainan", name: "台南市" },
      { path: "City/Kaohsiung", name: "高雄市" }, { path: "City/PingtungCounty", name: "屏東縣" },
      { path: "City/YilanCounty", name: "宜蘭縣" }, { path: "City/HualienCounty", name: "花蓮縣" },
      { path: "City/TaitungCounty", name: "台東縣" }, { path: "City/PenghuCounty", name: "澎湖縣" },
      { path: "City/KinmenCounty", name: "金門縣" }, { path: "City/LienchiangCounty", name: "連江縣" },
      { path: "Highway", name: "省道" }, { path: "Freeway", name: "國道" }
    ];

    for (const target of targets) {
      const eventTypes = ["Event", "LiveEvent"];
      
      for (const evType of eventTypes) {
        const url = `https://tdx.transportdata.tw/api/basic/v1/Traffic/RoadEvent/${evType}/${target.path}?$format=JSON`;
        const data = await fetchTDX(url, token, `${target.name}-${evType}`);
        
        const eventsList = data?.Events || data?.LiveEvents || (Array.isArray(data) ? data : []);
        
        for (const event of eventsList) {
          const summary = event.EventSummary || event.Description || "";
          const eventId = event.EventID;
          
          // 💡 關鍵修復：TDX 的座標通常包在 EventPosition 裡面
          const lat = event.PositionLat || event.EventPosition?.PositionLat;
          const lng = event.PositionLon || event.EventPosition?.PositionLon;
          
          if (!eventId || !summary || !lat || !lng) continue;
          
          // 排除無用資訊
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

    console.log(`🛡️ Diffing 完成！有 ${candidates.length - itemsForAI.length} 筆沿用快取，將讓 AI 處理 ${itemsForAI.length} 筆新資料。`);

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

    // 將沒過期且還在發生的快取保留，避免遇到短暫 API 異常時資料全毀
    cacheMap.forEach(cached => {
      if (!newCacheList.find(n => n.id === cached.id)) {
        newCacheList.push(cached);
        if (cached.isReal) finalEvents.push(cached);
      }
    });

    await kv.set("taiwan_traffic_cache", JSON.stringify(newCacheList));
    await kv.set("taiwan_traffic_events", JSON.stringify(finalEvents));
    
    console.log(`💾 完工！共 ${newCacheList.length} 筆寫入快取，產生 ${finalEvents.length} 筆地圖新聞事件。`);
  } catch (error) {
    console.error("💥 錯誤:", error.message);
  }
}

main();
