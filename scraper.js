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
  await delay(3000); // 減少延遲提高效率
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  return res.ok ? res.json() : null;
}

// 🤖 AI 篩選核心函數
async function aiFilterEvents(rawEvents) {
  if (rawEvents.length === 0) return [];
  
  console.log(`🤖 正在讓 GPT-4o mini 處理 ${rawEvents.length} 筆資料...`);
  
  const prompt = `
你是一位台灣交通路況專家。請分析以下交通跑馬燈(CMS)文字，判斷是否為「真實、具即時性的交通事件」。
- **必須過濾掉**：政令宣導(酒駕、安全帶、疲勞駕駛、反光背心、故障標誌、專線)、純問候、統計數據、旅行時間宣導。
- **必須保留**：車禍、施工、故障車、散落物、封閉管制、交通活動(路跑/遶境)、天候災害(濃霧/大雨/落石)、嚴重回堵。

請將合格的事件依照以下 JSON 格式回傳，不要有任何解釋文字：
[
  {"id": "原始ID", "category": "traffic|construction|disaster|activity", "isReal": true/false}
]
分類說明：
- traffic: 一般事故、車多回堵
- construction: 施工、管制、禁行大貨車
- disaster: 火燒車、坍方、大雨濃霧災害
- activity: 活動、演習、馬拉松

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
    // 假設 AI 回傳的是物件包陣列，視情況調整
    const list = Array.isArray(result) ? result : result.events || result.data || Object.values(result)[0];
    return list;
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
          // 基礎過濾：擋掉最明顯的垃圾，節省 AI Token
          if (cleanMsg.match(/安全車距|保持距離|酒駕|反光背心|故障標誌|繫妥|宣導/)) continue;

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

    // 將候選名單丟給 AI 裁決 (每 20 筆一批)
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
