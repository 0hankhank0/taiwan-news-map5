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

const PBS_TRAFFIC_URL = "https://rtr.pbs.gov.tw/NMP103_PbsWS/resources/roadData/opendata";

async function fetchOneRssFeed(rssUrl) {
  try {
    const xmlResponse = await axios.get(rssUrl, {
      timeout: 15000,
      responseType: "text",
      headers: {
        "User-Agent": "Mozilla/5.0 RSSFetcher/1.0",
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });
    const feed = await parser.parseString(String(xmlResponse.data || ""));
    return { items: feed.items || [] };
  } catch (err) {
    console.log(`⚠️ RSS fetch failed for ${rssUrl}:`, err.message);
    const feed = await parser.parseURL(rssUrl);
    return { items: feed.items || [] };
  }
}

async function fetchPoliceRecords() {
  try {
    const res = await axios.get(PBS_TRAFFIC_URL, { timeout: 15000 });
    let data = res.data;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (e) {}
    }
    const records = data?.result || [];
    return records.map((item) => ({
      id: item.UID || `pbs-${Math.random()}`,
      eventType: item.roadtype || "路況事件",
      description: item.comment || "無詳細說明",
      city: (item.areaNm || "全國").split("-")[0],
      road: item.road || item.areaNm || "未知路段",
      lat: parseFloat(item.y1),
      lng: parseFloat(item.x1),
      source: "警廣路況",
    })).filter((item) => !isNaN(item.lat) && !isNaN(item.lng));
  } catch (err) {
    console.error('❌ 警廣抓取錯誤:', err.message);
    return [];
  }
}

app.use(cors());
app.use(express.json());

app.get("/api/events", async (req, res) => {
  try {
    const [rawRssFeeds, policeRecords] = await Promise.all([
      Promise.all(DEFAULT_RSS_SOURCES.map((url) => fetchOneRssFeed(url))),
      fetchPoliceRecords(),
    ]);

    const newsItems = rawRssFeeds.flatMap((f) => f.items);
    console.log('✅ RSS 抓到的新聞數量:', newsItems.length);

    const latestNews = newsItems.slice(0, 10);

    const cleanAndTruncate = (text) => {
      if (!text) return "";
      return text.replace(/<[^>]*>?/gm, "").replace(/\s+/g, " ").trim().substring(0, 300);
    };

    const simplifiedNews = latestNews.map((item) => ({
      title: item.title || "",
      content: cleanAndTruncate(item.contentSnippet || item.content || ""),
      link: item.link || "",
    }));

    // 傳送給 AI 的警政資料 (限縮數量節省 token)
    const limitedPolice = policeRecords.slice(0, 5).map((record) => ({
      ...record,
      description: cleanAndTruncate(record.description),
    }));

    const systemPrompt = `You are a geographic labeling assistant. Your job is to extract EVERY single physical event from the provided Taiwan news and police records.

【CRITICAL RULES】
1. 請盡可能把所有新聞都轉換成 JSON 格式。
2. 即使新聞中沒有精確的街道地址，也請務必給它一個該縣市的概略經緯度中心點。
3. 絕對不要略過任何一條新聞，禁止回傳空陣列 []。
4. Output MUST follow this JSON schema:
{
  "events": [
    {
      "title": "Location - Event Description",
      "content": "Brief description...",
      "category": "traffic|construction|disaster|police|activity|other",
      "url": "https://...",
      "lat": 25.0330,
      "lng": 121.5654,
      "city": "台北市",
      "source": "news"
    }
  ]
}

【CITY TO COORDINATE FALLBACK】
If no precise address is found, use these coordinates:
- 台北市: 25.0330, 121.5654
- 新北市: 25.0169, 121.4628
- 桃園市: 24.9937, 121.3009
- 台中市: 24.1477, 120.6736
- 高雄市: 22.6273, 120.3014
- 台南市: 22.9997, 120.2270
- 彰化縣: 24.0685, 120.5575
- 宜蘭縣: 24.7021, 121.7378
- 花蓮縣: 23.9872, 121.6015
- 其他: 23.5, 120.5`;

    const userContent = `【新聞】${JSON.stringify(simplifiedNews)}\n【警政】${JSON.stringify(limitedPolice)}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "taiwan_events",
          strict: true,
          schema: {
            type: "object",
            properties: {
              events: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    content: { type: "string" },
                    category: { type: "string", enum: ["traffic", "construction", "disaster", "police", "activity", "other"] },
                    url: { type: "string" },
                    lat: { type: "number" },
                    lng: { type: "number" },
                    city: { type: "string" },
                    source: { type: "string" },
                  },
                  required: ["title", "content", "category", "url", "lat", "lng", "city", "source"],
                  additionalProperties: false,
                },
              },
            },
            required: ["events"],
            additionalProperties: false,
          },
        },
      },
      temperature: 0,
    });

    const responseContent = completion.choices[0].message.content;
    let aiEvents = [];
    try {
      const parsedData = completion.choices[0].message.parsed || JSON.parse(responseContent || "{}");
      if (Array.isArray(parsedData)) {
        aiEvents = parsedData;
      } else if (parsedData && Array.isArray(parsedData.events)) {
        aiEvents = parsedData.events;
      }
    } catch (parseErr) {
      console.error('❌ JSON 解析失敗:', parseErr.message);
    }

    console.log(`✅ 最終解析出 ${aiEvents.length} 筆 AI 新聞事件`);

    // 轉換警廣資料為統一格式，確保與 aiEvents 一致
    const pbsEvents = policeRecords.map((r) => ({
      title: `${r.road || r.city} - ${r.eventType}`,
      content: r.description,
      category: r.eventType.includes("施工") ? "construction" : 
                (r.eventType.includes("事故") || r.eventType.includes("車禍")) ? "disaster" : "traffic",
      url: "",
      lat: r.lat,
      lng: r.lng,
      city: r.city,
      source: "警廣路況",
    }));

    // 加入偵錯 Log：印出警廣資料抓取數量
    console.log('📻 警廣資料抓取數量:', pbsEvents.length);

    // 合併所有事件，確保寫法類似：const finalEvents = [...pbsEvents, ...aiEvents];
    const finalEvents = [...pbsEvents, ...aiEvents];
    
    // 加入偵錯 Log：印出最終合併準備回傳的總數
    console.log('📦 最終合併準備回傳的總數:', finalEvents.length);

    // 過濾有效經緯度
    const validEvents = finalEvents.filter((item) => {
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lng);
      return !isNaN(lat) && !isNaN(lng) && lat >= 21 && lat <= 26 && lng >= 118 && lng <= 122;
    }).map((item) => ({
      ...item,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lng),
    }));

    console.log('✅ 過濾後有效事件總數:', validEvents.length);

    res.setHeader("Vercel-CDN-Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.json(validEvents);
  } catch (error) {
    console.error('❌ 後端發生錯誤:', error);
    res.status(500).json({ error: "處理失敗", details: error.message });
  }
});

module.exports = app;
