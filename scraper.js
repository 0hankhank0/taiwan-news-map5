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
  await delay(3000); 
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  return res.ok ? res.json() : null;
}

// 🤖 AI 篩選核心函數 (新增 ttl_hours 判斷)
async function aiFilterEvents(rawEvents) {
  if (rawEvents.length === 0) return [];
  
  console.log(`🤖 正在讓 GPT-4o mini 處理 ${rawEvents.length} 筆新資料...`);
  
  const prompt = `
你是一位台灣交通路況專家。請分析以下交通跑馬燈(CMS)文字。
任務：
1. 判斷是否為「當下正在發生」的真實路況 (isReal: true/false)。
   - ❌ 拒絕 (false)：政令宣導、交通安全宣導、歷史統計數據 (例如：「開車不喝酒」、「取締違規大客車」)。
   - ✅ 保留 (true)：當下真實發生的突發事件 (例如：「前方車禍佔用內線」、「重大事故封閉」)。
2. 精準分類 (category)：
   - accident: 車禍、追撞、肇事、散落物、火燒車等「突發事故」
   - traffic: 車多回堵、壅塞、車流量大等「純粹路況」
   - construction: 施工、管制、封閉
   - disaster: 坍方、落石、大雨、積水等天候災害
   - activity: 演習、馬拉松、活動
3. 預估事件存活時間 (ttl_hours)：
   - 輕微事故/車多壅塞 (accident/traffic)：2 (小時)
   - 嚴重事故/災情 (disaster/嚴重 accident)：6 (小時)
   - 長期施工/活動管制 (construction/activity)：168 (7天)
   - 無效宣導 (isReal=false)：720 (30天，避免短期內重複浪費資源判斷)

請回傳 JSON 格式，包含 events 陣列：
{
  "events": [
    {"id": "原始ID", "category": "accident|traffic|construction|disaster|activity", "isReal": true/false, "ttl_hours": 數字}
  ]
}

待處理資料：
${JSON.stringify(rawEvents.map(e => ({ id: e.id, text: e.text })))}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: "你只會回傳 JSON 格式的台灣交通分析資料。" }, { role: "user", content: prompt }],
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
    console.log("🚀 啟動全台路況同步 (快取省錢版)...");
    const token = await getTDXToken();
    let candidates = [];
    
    // --- 1. 讀取並清理過期快取 ---
    let rawCache = await kv.get("taiwan_traffic_cache");
    let cacheMap = new Map();
    const now = Date.now();
    
    if (rawCache) {
      const parsedCache = typeof rawCache === "string" ? JSON.parse(rawCache) : rawCache;
      parsedCache.forEach(item => {
        // 只保留還沒過期的快取
        if (item.expiresAt > now) {
          cacheMap.set(item.id, item);
        }
      });
    }
    console.log(`🗃️ 載入有效快取：${cacheMap.size} 筆`);

    const targets = [
      { path: "City/Taipei", name: "台北市" }, { path: "City/NewTaipei", name: "新北市" },
      { path: "City/Taoyuan", name: "桃園市" }, { path: "City/Taichung", name: "台中市" },
      { path: "City/Tainan", name: "台南市" }, { path: "City/Kaohsiung", name: "高雄市" },
      { path: "Highway", name: "省道" }, { path: "Freeway", name: "國道" }
    ];

    // --- 2. 抓取 TDX 新資料 ---
    for (const target of targets) {
      const basicData = await fetchTDX(`https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CMS/${target.path}?$format=JSON`, token, `${target.name}-座標`);
      const liveData = await fetchTDX(`https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/CMS/${target.path}?$format=JSON`, token, `${target.name}-文字`);

      const basicList = basicData?.CMSs || basicData?.CMSLists || (Array.isArray(basicData) ? basicData : []);
      const liveList = liveData?.CMSLives || liveData?.LiveCMSs || (Array.isArray(liveData) ? liveData : []);

      if (basicList.length > 0 && liveList.length > 0) {
        const locationMap = {};
        basicList.forEach(cms => { locationMap[cms.CMSID] = { lat: cms.PositionLat, lng: cms.PositionLon }; });

        for (const live of liveList) {
          const rawMsg = (live.Messages && live.Messages[0]?.Text) || live.Message || "";
          if (!rawMsg) continue;
          
          const cleanMsg = rawMsg.replace(/\s+/g, "");
          if (cleanMsg.match(/安全車距|保持距離|反光背心|故障標誌|繫妥|禮讓行人|路口慢看停|專線/)) continue;
          if (cleanMsg.includes("約") && cleanMsg.includes("分")) continue; 

          candidates.push({
            id: live.CMSID,
            text: rawMsg,
            lat: locationMap[live.CMSID]?.lat,
            lng: locationMap[live.CMSID]?.lng,
            city: target.name
          });
        }
      }
    }

    // --- 3. 進行 Diffing 比對 ---
    let itemsForAI = [];
    let newCacheList = [];
    let finalEvents = [];

    for (const item of candidates) {
      const cached = cacheMap.get(item.id);
      
      // 如果快取存在，且「文字內容沒變」，直接沿用，不叫 AI！
      if (cached && cached.text === item.text) {
        newCacheList.push(cached); 
        if (cached.isReal) {
          finalEvents.push(cached); // 只有真實路況才放進要顯示的清單
        }
      } else {
        // 沒見過的新資料，或是文字進度有更新的，放進 AI 處理區
        itemsForAI.push(item);
      }
    }

    console.log(`🛡️ Diffing 完成！有 ${candidates.length - itemsForAI.length} 筆沿用快取，僅需處理 ${itemsForAI.length} 筆新資料。`);

    // --- 4. 批次交給 AI 處理新資料 ---
    for (let i = 0; i < itemsForAI.length; i += 20) {
      const batch = itemsForAI.slice(i, i + 20);
      const aiResults = await aiFilterEvents(batch);
      
      batch.forEach(item => {
        const aiDecision = aiResults.find(r => r.id === item.id);
        if (aiDecision) {
          const ttlMs = (aiDecision.ttl_hours || 2) * 60 * 60 * 1000;
          const processedItem = {
            id: item.id,
            text: item.text,          // 保留原始文字用於下次 Diff 比對
            title: item.text,
            content: item.text,
            category: aiDecision.category || "traffic",
            isReal: aiDecision.isReal,
            source: "TDX CMS",
            lat: item.lat,
            lng: item.lng,
            city: item.city,
            expiresAt: now + ttlMs    // 加上過期時間戳記
          };

          newCacheList.push(processedItem); // 存入完整快取（含 true/false）
          
          if (aiDecision.isReal) {
            finalEvents.push(processedItem); // 存入前端顯示清單
          }
        }
      });
    }

    // --- 5. 寫回 Redis ---
    await kv.set("taiwan_traffic_cache", JSON.stringify(newCacheList));
    await kv.set("taiwan_traffic_events", JSON.stringify(finalEvents));
    
    console.log(`💾 完工！共 ${newCacheList.length} 筆寫入快取，產生 ${finalEvents.length} 筆真實路況供前端使用。`);
  } catch (error) {
    console.error("💥 錯誤:", error.message);
  }
}

main();
