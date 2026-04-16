const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { OpenAI } = require("openai");
const Parser = require("rss-parser");

const app = express();
const parser = new Parser();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * 終極路況抓取：只用 TDX V3 (因為政府公開資料會 Timeout)
 */
async function fetchTrafficData() {
  try {
    if (!process.env.TDX_CLIENT_ID) return [];

    // 1. 取得 Token
    const auth = await axios.post("https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token", 
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.TDX_CLIENT_ID,
        client_secret: process.env.TDX_CLIENT_SECRET
      }), { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 5000 }
    );
    const token = auth.data.access_token;

    // 2. 抓取最核心的路況 (國道 + 省道)
    const paths = ['Freeway', 'ProvincialHighway'];
    let allEvents = [];
    
    for (const path of paths) {
      try {
        const res = await axios.get(`https://tdx.transportdata.tw/api/advanced/v3/Road/Traffic/Event/${path}?$format=JSON`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 5000
        });
        const events = res.data?.Events || [];
        allEvents.push(...events);
      } catch (e) { console.error(`${path} 抓取跳過`); }
    }

    return allEvents.map(e => ({
      title: `【路況】${e.RoadName || '即時訊息'}`,
      content: e.Description || e.Comment || "請注意駕駛安全",
      category: "traffic",
      lat: parseFloat(e.LocationPt?.PositionLat),
      lng: parseFloat(e.LocationPt?.PositionLon),
      city: e.AreaName || "全國",
      source: "TDX/警廣",
      url: ""
    })).filter(r => r.lat && r.lng);
  } catch (err) {
    console.error("TDX 抓取失敗");
    return [];
  }
}

app.use(cors());
app.use(express.json());

app.get("/api/events", async (req, res) => {
  // 設定 Vercel 響應頭，避免被快取舊資料
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=30");

  try {
    // 同時啟動路況抓取與 RSS 抓取 (平行執行省時間)
    const [trafficItems, rssData] = await Promise.all([
      fetchTrafficData(),
      axios.get("https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant", { timeout: 5000 })
        .then(r => parser.parseString(r.data))
        .catch(() => ({ items: [] }))
    ]);

    // 只取前 5 則新聞交給 AI，減少 OpenAI 運算時間 (避免超過 50 秒)
    const newsToProcess = rssData.items.slice(0, 5).map(item => ({
      title: item.title,
      content: (item.contentSnippet || "").substring(0, 100),
      link: item.link
    }));

    let aiEvents = [];
    if (openai && newsToProcess.length > 0) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "你是一個台灣地理標記助手。請將新聞轉為 JSON 格式，必須包含 lat, lng 座標。格式：{events: [{title, content, category, lat, lng, city, source, url}]}" },
          { role: "user", content: JSON.stringify(newsToProcess) }
        ],
        response_format: { type: "json_object" }
      });
      const parsed = JSON.parse(completion.choices[0].message.content);
      aiEvents = parsed.events || [];
    }

    const finalResult = [...trafficItems, ...aiEvents];
    console.log(`🚀 任務完成！回傳 ${finalResult.length} 筆資料`);
    res.status(200).json(finalResult);

  } catch (error) {
    console.error("嚴重錯誤:", error.message);
    res.status(200).json([]);
  }
});

module.exports = app;
