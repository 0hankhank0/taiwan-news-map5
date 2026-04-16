const express = require("express");
const cors = require("cors");
const Parser = require("rss-parser");
const axios = require("axios");
const { OpenAI } = require("openai");

const app = express();
const parser = new Parser();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const DEFAULT_RSS_SOURCES = [
  "https://news.ltn.com.tw/rss/all.xml",
  "https://udn.com/rssfeed/news/2/6638?ch=news",
  "https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
];

/**
 * 警廣 (PBS) 即時路況抓取 - 使用政府公開資料 API
 * 優點：無需登入、無需 Token、穩定性高
 */
async function fetchPBSOpenData() {
  try {
    console.log('📡 正在從政府公開平台抓取警廣路況...');
    // 這是內政部資料開放平台提供的警廣即時路況 API
    const pbsUrl = "https://od.moi.gov.tw/api/v1/rest/datastore/A01010000C-000628-063";
    
    const res = await axios.get(pbsUrl, { timeout: 10000 });
    const records = res.data?.result?.records || [];
    
    console.log(`📊 警廣原始資料總計: ${records.length} 筆`);

    return records.map((item) => {
      // 警廣座標通常在 X (經度), Y (緯度)
      const lng = parseFloat(item.X);
      const lat = parseFloat(item.Y);
      
      return {
        title: `【警廣】${item.roadtype || '路況'} - ${item.area_nm || ''}`,
        content: item.srcdetail || "無詳細說明",
        category: "traffic",
        lat: lat,
        lng: lng,
        city: (item.area_nm || "全國").substring(0, 3),
        source: "警廣路況",
        url: "",
      };
    }).filter(r => !isNaN(r.lat) && !isNaN(r.lng) && r.lat !== 0);

  } catch (err) {
    console.error('❌ 警廣資料抓取失敗:', err.message);
    return [];
  }
}

app.use(cors());
app.use(express.json());

app.get("/api/events", async (req, res) => {
  try {
    // 同時抓取 RSS 新聞與警廣資料
    const [rawRssFeeds, pbsEvents] = await Promise.all([
      Promise.all(DEFAULT_RSS_SOURCES.map(url => 
        axios.get(url, { timeout: 5000 }).then(r => parser.parseString(r.data)).catch(() => ({ items: [] }))
      )),
      fetchPBSOpenData(),
    ]);

    const newsItems = rawRssFeeds.flatMap(f => f.items || []).slice(0, 10);
    console.log('✅ RSS 新聞抓取數量:', newsItems.length);

    // AI 解析邏輯 (保留原樣)
    let aiEvents = [];
    if (openai && newsItems.length > 0) {
      const simplifiedNews = newsItems.map(item => ({
        title: item.title || "",
        content: (item.contentSnippet || item.content || "").substring(0, 200),
        link: item.link || ""
      }));

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "你是一個地理標記助手，將新聞轉換為 JSON 格式。務必包含 lat, lng。" },
          { role: "user", content: JSON.stringify(simplifiedNews) }
        ],
        response_format: { type: "json_object" }
      });
      
      const parsed = JSON.parse(completion.choices[0].message.content);
      aiEvents = parsed.events || [];
    }

    // 合併資料
    const validEvents = [...pbsEvents, ...aiEvents].filter(item => {
      return item.lat > 21 && item.lat < 26 && item.lng > 118 && item.lng < 123;
    });

    console.log(`🚀 最終回傳總數: ${validEvents.length}`);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=30");
    res.status(200).json(validEvents);

  } catch (error) {
    console.error('❌ 發生錯誤:', error);
    res.status(200).json([]);
  }
});

module.exports = app;
