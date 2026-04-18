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

// 🤖 AI 篩選核心函數 (已將事故與路況分開)
async function aiFilterEvents(rawEvents) {
  if (rawEvents.length === 0) return [];
  
  console.log(`🤖 正在讓 GPT-4o mini 處理 ${rawEvents.length} 筆資料...`);
  
  // 💡 強化版的 Prompt：教導 AI 把「車多/壅塞」跟「車禍/掉落物」分開
  const prompt = `
你是一位台灣交通路況專家。請分析以下交通跑馬燈(CMS)文字。
任務：
1. 判斷是否為「當下正在發生」的真實路況 (isReal: true/false)。
   - ❌ 拒絕 (false)：政令宣導、交通安全宣導、歷史統計數據 (例如：「3月交通事故死亡4人」、「開車不喝酒」、「取締違規大客車」)。即使包含「死亡」、「酒駕」、「事故」等字眼，只要是宣導或統計，一律為 false。
   - ✅ 保留 (true)：當下真實發生的突發事件 (例如：「前方車禍佔用內線」、「酒駕肇事全線封閉」、「重大事故1人死亡」)。
2. 精準分類 (category)：
   - accident: 車禍、追撞、肇事、散落物、火燒車等「突發事故」
   - traffic: 車多回堵、壅塞、車流量大、走走停停等「純粹的路況」
   - construction: 施工、管制、禁行大貨車、封閉
   - disaster: 坍方、落石、大雨、濃霧、積水等天候自然災害
   - activity: 跨年、演習、馬拉松、遶境活動

請回傳 JSON 格式，格式必須如下 (包含一個 events 陣列)：
{
  "events": [
    {"id": "原始ID", "category": "accident|traffic|construction|disaster|activity", "isReal": true 或 false}
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
    console.log("🚀 啟動全台路況同步 (GPT-4o mini AI 篩選強化版)...");
    const token = await getTDXToken();
    let candidates = [];
    
    const targets = [
      { path: "City/Taipei", name: "台北市" }, { path: "City/NewTaipei", name: "新北市" },
      { path: "City/Taoyuan", name: "桃園市" }, { path: "City/Taichung", name: "台中市" },
      { path: "City/Tainan", name: "台南市" }, { path: "City/Kaohsiung", name: "高雄市" },
      { path: "Highway", name: "省道" }, { path: "Freeway", name: "國道" }
    ];

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

    let finalEvents = [];
    for (let i = 0; i < candidates.length; i += 20) {
      const batch = candidates.slice(i, i + 20);
      const aiResults = await aiFilterEvents(batch);
      
      batch.forEach(item => {
        const aiDecision = aiResults.find(r => r.id === item.id);
        if (aiDecision && aiDecision.isReal) {
          finalEvents.push({
            id: item.id,
            title: item.text,
            content: item.text,
            // 💡 預設值改成 traffic，但 AI 會傳回 accident
            category: aiDecision.category || "traffic",
            source: "TDX CMS",
            lat: item.lat,
            lng: item.lng,
            city: item.city
          });
        }
      });
    }

    await kv.set("taiwan_traffic_events", JSON.stringify(finalEvents));
    console.log(`💾 完工！AI 從 ${candidates.length} 筆中挑選了 ${finalEvents.length} 筆真實路況。`);
  } catch (error) {
    console.error("💥 錯誤:", error.message);
  }
}
main();
