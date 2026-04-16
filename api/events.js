const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { OpenAI } = require("openai");
const Parser = require("rss-parser");

const app = express();
const parser = new Parser();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * 終極修正版：確保 TDX V3 路徑完全正確
 */
async function fetchTrafficData() {
  try {
    if (!process.env.TDX_CLIENT_ID || !process.env.TDX_CLIENT_SECRET) {
      console.warn("⚠️ 缺少環境變數 TDX_CLIENT_ID 或 SECRET");
      return [];
    }

    // 1. 取得 Token (你現在這部分已經成功了)
    const authRes = await axios.post(
      "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token",
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.TDX_CLIENT_ID,
        client_secret: process.env.TDX_CLIENT_SECRET,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    const accessToken = authRes.data.access_token;
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

    // 2. 分開抓取，避免 404
    const paths = ["Freeway", "ProvincialHighway"];
    let combinedRecords = [];

    for (const path of paths) {
      try {
        // 修正後的精確網址
        const url = `https://tdx.transportdata.tw/api/advanced/v3/Road/Traffic/Event/${path}?$format=JSON`;
        const res = await axios.get(url, { headers, timeout: 10000 });
        
        // V3 的資料結構通常是在 Events 欄位下
        const data = res.data?.Events || res.data || [];
        if (Array.isArray(data)) {
          combinedRecords.push(...data);
        }
        // 稍作停頓避免觸發頻率限制
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.error(`⚠️ TDX 抓取失敗 (${path}):`, err.message);
      }
    }

    // 3. 轉換資料格式
    return combinedRecords.map((item) => ({
      title: `【路況】${item.RoadName || item.EventTitle || '即時訊息'}`,
      content: item.Description || item.Comment || "無詳細說明",
      category: "traffic",
      lat: parseFloat(item.LocationPt?.PositionLat || item.PositionLat),
      lng: parseFloat(item.LocationPt?.PositionLon || item.PositionLon),
      city: (item.AreaName || "全國").split("-")[0],
      source: "警廣/TDX",
      url: "",
    })).filter((r) => !isNaN(r.lat) && !isNaN(r.lng));

  } catch (err) {
    console.error('❌ TDX 總體流程錯誤:', err.message);
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
