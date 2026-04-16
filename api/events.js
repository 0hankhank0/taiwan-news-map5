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
 * CategoryEnum 摰儔
 * ?嚗漱?瘝颯冗??瘣颯???瓷蝬???璅?隞亙????楝瘜?憿?
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

const PBS_TRAFFIC_URL = "https://rtr.pbs.gov.tw/NMP103_PbsWS/resources/roadData/opendata";

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
    const feed = await parser.parseURL(rssUrl);
    return { items: feed.items || [] };
  }
}

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

    const accessToken = authRes.data?.access_token;
    if (!accessToken) throw new Error("無法取得 TDX Token");

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };

    // 2. 嚴格使用你提供的 sequential 抓取迴圈（含 regions + 300ms 延遲）
    const regions = ['N', 'C', 'S', 'E']; // 絕對不能改成別的
    const combinedRecords = [];

    for (const region of regions) {
      try {
        const res = await axios.get(`https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/PBS/Region/${region}?$format=JSON`, { headers, timeout: 10000 });
        combinedRecords.push(...(res.data || []));
        // 加上 300 毫秒的禮貌性延遲，避免 429 錯誤
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (err) {
        console.error(`⚠️ TDX 抓取失敗 (${region}):`, err?.response?.data || err.message);
      }
    }

    // 3. 資料解析與容錯
    const formatted = combinedRecords
      .map((item) => {
        const lng = parseFloat(item.LocationPt?.PositionLon);
        const lat = parseFloat(item.LocationPt?.PositionLat);
        const content = item.Comment || item.EventDescription;

        return {
          title: `${item.AreaName || "路況"} - ${content || "無詳細說明"}`,
          content: content || "無詳細說明",
          // 所有 TDX 資料類別強制為交通
          category: CategoryEnum.TRAFFIC,
          url: "",
          lat,
          lng,
          city: (item.AreaName || item.CityName || "全國").split("-")[0],
          source: "警廣路況",
        };
      })
      .filter((r) => !isNaN(r.lat) && !isNaN(r.lng));

    return formatted;
  } catch (error) {
    console.error("❌ TDX 流程發生錯誤:", error.message);
    return [];
  }
}

app.use(cors());
app.use(express.json());

app.get("/api/events", async (req, res) => {
  try {
    // 1. ???? RSS ?啗??郎撱????
    const [rawRssFeeds, policeRecords] = await Promise.all([
      Promise.all(DEFAULT_RSS_SOURCES.map(url => fetchOneRssFeed(url))),
      fetchTDXPoliceRecords()
    ]);

    const newsItems = rawRssFeeds.flatMap(f => f.items).slice(0, 12);

    // 2. 皜???瑟?摰?
    const cleanAndTruncate = (text) => {
      if (!text) return "";
      return text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim().substring(0, 300);
    };

    const simplifiedNews = newsItems.map(item => ({
      title: item.title || "",
      content: cleanAndTruncate(item.contentSnippet || item.content || ""),
      link: item.link || ""
    }));

    // 3. 撱箸? AI Prompt
    const systemPrompt = `You are a professional news and geographic labeling assistant. 
Your task is to extract real physical events in Taiwan from news and classify them into the most appropriate category.

?TRICT CATEGORY ENUM??
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

?SON SCHEMA??
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

?ULES??
1. If an event has no clear physical location in Taiwan, skip it.
2. TITLE format: "Location - Event" (e.g., "?啣?撣縑蝢拙? - ?琿?撌亦??賢極").
3. Use traditional Chinese for content and title.`;

    const userContent = `Analyze the following news items and extract physical events in Taiwan:
${JSON.stringify(simplifiedNews, null, 2)}`;

    // 4. ?澆 OpenAI
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
    let eventsArray = parsed?.events || [];

    // 5. ?蔥霅行鞈?嚗歇??fetchPoliceRecords 銝剖撥?嗉身??traffic嚗?
    const allEvents = [...eventsArray, ...policeRecords];

    // 6. ?蕪????
    const validEvents = allEvents.filter(item => {
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lng);
      return !isNaN(lat) && !isNaN(lng) && 
             lat >= 21 && lat <= 26 && 
             lng >= 118 && lng <= 122;
    });

    // 7. 敹怠?閮剖?
    res.setHeader('Vercel-CDN-Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json(validEvents);

  } catch (error) {
    console.error("??/api/events ?航炊:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default app;

module.exports = app;
