import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import Parser from "rss-parser";
import axios from "axios";
import { OpenAI } from "openai";

dotenv.config();

const app = express();
const parser = new Parser();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * CategoryEnum 定義
 * 包含：交通、政治、社會、生活、科技、金融、國際、娛樂、施工、災害、警察、活動、其他
 */
const CategoryEnum = {
  TRAFFIC: "traffic",
  POLITICS: "politics",
  SOCIAL: "social",
  LIFE: "life",
  TECH: "tech",
  FINANCE: "finance",
  INTERNATIONAL: "international",
  ENTERTAINMENT: "entertainment",
  CONSTRUCTION: "construction",
  DISASTER: "disaster",
  POLICE: "police",
  ACTIVITY: "activity",
  OTHER: "other"
};

const DEFAULT_RSS_SOURCES = [
  "https://news.ltn.com.tw/rss/all.xml",
  "https://udn.com/rssfeed/news/2/6638?ch=news",
  "https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
];

async function fetchOneRssFeed(rssUrl) {
  try {
    const xmlResponse = await axios.get(rssUrl, {
      timeout: 15000,
      responseType: "text",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) RSSFetcher/1.0",
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });
    const feed = await parser.parseString(String(xmlResponse.data || ""));
    return { items: feed.items || [] };
  } catch {
    try {
      const feed = await parser.parseURL(rssUrl);
      return { items: feed.items || [] };
    } catch (e) {
      return { items: [] };
    }
  }
}

/**
 * 強化版 TDX 抓取：改用警廣 (PBS) 分區路況 API
 * 分區代號：N (北區), C (中區), S (南區), E (東區)
 */
async function fetchTDXPoliceRecords() {
  try {
    // 1. 取得 TDX Token
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
    if (!accessToken) throw new Error("無法取得 TDX Token");

    const regions = ['N', 'C', 'S', 'E'];
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };

    // 2. 並行抓取四大分區的警廣路況 API
    const fetchPromises = regions.map(region => 
      axios.get(`https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/PBS/Region/${region}?$format=JSON`, { headers, timeout: 10000 })
        .then(res => res.data || [])
        .catch(err => {
          console.error(`⚠️ TDX 抓取失敗 (${region}):`, err.message);
          return [];
        })
    );

    const regionResults = await Promise.all(fetchPromises);
    const combinedRecords = regionResults.flat();

    // 3. 解析與轉換資料
    return combinedRecords.map(item => ({
      id: item.UID || `pbs-${Math.random()}`,
      title: item.RoadName || item.AreaName || "即時路況",
      content: item.Comment || item.EventDescription || "無詳細內容",
      city: (item.AreaName || "全國").split('-')[0],
      lat: parseFloat(item.LocationPt?.PositionLat),
      lng: parseFloat(item.LocationPt?.PositionLon),
      source: "即時路況",
      category: CategoryEnum.TRAFFIC // 強制設為交通類別
    })).filter(item => !isNaN(item.lat) && !isNaN(item.lng));

  } catch (error) {
    console.error("❌ TDX 流程發生錯誤:", error.message);
    return [];
  }
}

app.use(cors());
app.use(express.json());

app.get("/api/events", async (req, res) => {
  try {
    // 1. 同時抓取 RSS 與 TDX 警廣資料
    const [rawRssFeeds, pbsEvents] = await Promise.all([
      Promise.all(DEFAULT_RSS_SOURCES.map(url => fetchOneRssFeed(url))),
      fetchTDXPoliceRecords()
    ]);

    const newsItems = rawRssFeeds.flatMap(f => f.items).slice(0, 40);

    // 2. 簡化新聞內容供 AI 處理
    const cleanAndTruncate = (text) => {
      if (!text) return "";
      return text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim().substring(0, 300);
    };

    const simplifiedNews = newsItems.map(item => ({
      title: item.title || "",
      content: cleanAndTruncate(item.contentSnippet || item.content || ""),
      link: item.link || ""
    }));

    // 3. 構建 AI Prompt
    const systemPrompt = `You are a professional news and geographic labeling assistant. 
Your task is to extract real physical events in Taiwan from news and classify them into the most appropriate category.

【STRICT CATEGORY ENUM】
You MUST pick EXACTLY one category from this list:
- traffic: Traffic congestion, road reports, vehicle breakdowns.
- politics: Government policies, elections, political movements.
- social: Crime, social issues, human interest stories, accidents (if not traffic).
- life: Lifestyle, health, entertainment, weather, local news.
- tech: Technology, AI, gadgets, internet, science.
- finance: Economy, stock market, business, real estate.
- international: World news, foreign affairs.
- entertainment: Celebrity news, movies, music, arts.
- construction: Road construction, maintenance, closures.
- disaster: Fires, floods, earthquakes, major accidents.
- police: Police enforcement, checkpoints.
- activity: Festivals, parades, public events.

【JSON SCHEMA】
Output MUST be a JSON object with a root key "events":
{
  "events": [
    {
      "title": "Specific Location - Event Description",
      "content": "Brief summary",
      "category": "one_from_the_enum_above",
      "url": "original_link",
      "lat": number,
      "lng": number,
      "city": "Taiwanese City Name",
      "source": "news"
    }
  ]
}

【RULES】
1. If an event has no clear physical location in Taiwan, skip it.
2. TITLE format: "Location - Event" (e.g., "台北市信義區 - 交通管制執行中").
3. Use traditional Chinese for content and title.`;

    const userContent = `Analyze the following news items and extract physical events in Taiwan:
${JSON.stringify(simplifiedNews, null, 2)}`;

    // 4. 調用 OpenAI 解析新聞
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      response_format: { type: "json_object" },
      temperature: 0
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    let aiEvents = parsed?.events || [];

    // 5. 合併 AI 新聞事件與 TDX 警廣路況
    const allEvents = [...aiEvents, ...pbsEvents];

    // 6. 過濾有效座標 (台灣範圍)
    const validEvents = allEvents.filter(item => {
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lng);
      return !isNaN(lat) && !isNaN(lng) && 
             lat >= 21 && lat <= 26 && 
             lng >= 118 && lng <= 122;
    });

    // 7. 設定快取並回傳
    res.setHeader('Vercel-CDN-Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json(validEvents);

  } catch (error) {
    console.error("❌ /api/events 發生錯誤:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default app;
