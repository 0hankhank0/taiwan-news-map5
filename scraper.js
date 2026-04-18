const { Redis } = require("@upstash/redis");

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
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
  await delay(6000); 
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  return res.ok ? res.json() : null;
}

// 🏷️ 分類邏輯 (加入天氣/災害辨識)
function getCategoryKey(cleanMsg) {
  if (cleanMsg.match(/火災|火燒車|落石|坍方|淹水|積水|大雨|濃霧|強風/)) return "disaster"; 
  if (cleanMsg.match(/活動|展覽|演習|煙火|跨年|演唱會|遶境|燈會|馬拉松|路跑|踩街/)) return "activity"; 
  if (cleanMsg.match(/施工|封閉|管制|改道|交管|禁止進入|禁大貨車|禁行/)) return "construction"; 
  return "traffic"; 
}

async function main() {
  try {
    console.log("🚀 啟動全台路況同步 (放寬白名單 平衡版)...");
    const token = await getTDXToken();
    let allEvents = [];
    
    const targets = [
      { path: "City/Taipei", name: "台北市" },
      { path: "City/NewTaipei", name: "新北市" },
      { path: "City/Taoyuan", name: "桃園市" },
      { path: "City/Taichung", name: "台中市" },
      { path: "City/Tainan", name: "台南市" },
      { path: "City/Kaohsiung", name: "高雄市" },
      { path: "Highway", name: "省道" },
      { path: "Freeway", name: "國道" }
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
          
          const cleanMsg = rawMsg.replace(/\s+|　/g, "");

          // 🛑 核心攔截邏輯
          if (cleanMsg.match(/\d月/) || cleanMsg.includes("死亡")) continue;
          if (cleanMsg.includes("約") && cleanMsg.includes("分")) continue;
          if (cleanMsg.includes("至") && cleanMsg.includes("分")) continue;
          
          // 🎯 稍微放寬的黑名單：移除了「請勿」、「排隊車流」避免誤殺
          if (cleanMsg.match(/故障標誌|反光背心|備妥|牌照|累犯|沒入|罰款|專線|繫妥|宣導|安全車距|保持車距|保持距離|保持安全/)) continue;
          if (cleanMsg.match(/慢看停|停看聽|酒駕|酒後|測速|生命|頭燈|專心駕駛|疲勞|禮讓/)) continue;

          // 🟢 擴充白名單：補上「車多、車潮、車流、散落物、大雨、濃霧、強風、積水、禁行」等真實路況字眼
          const isReal = cleanMsg.match(/事故|車禍|塞|回堵|壅塞|緩慢|車多|車潮|車流|拋錨|故障|散落物|落石|坍方|淹水|積水|大雨|濃霧|強風|施工|封閉|管制|改道|交管|禁行|禁大貨車|禁止進入|活動|展覽|演習|煙火|跨年|演唱會|遶境|燈會|馬拉松|路跑/);
          if (!isReal) continue;

          const loc = locationMap[live.CMSID];
          if (!loc) continue;

          allEvents.push({
            id: live.CMSID,
            title: rawMsg,                    
            content: rawMsg,                  
            category: getCategoryKey(cleanMsg), 
            source: "TDX CMS",                
            lat: loc.lat,
            lng: loc.lng,
            city: target.name
          });
        }
        console.log(`✨ [${target.name}] 過濾後剩下 ${allEvents.filter(e => e.city === target.name).length} 筆`);
      }
    }

    await kv.set("taiwan_traffic_events", JSON.stringify(allEvents));
    console.log(`💾 完工！共存入 ${allEvents.length} 筆真實事件 (放寬白名單)。`);
  } catch (error) {
    console.error("💥 錯誤:", error.message);
  }
}
main();
