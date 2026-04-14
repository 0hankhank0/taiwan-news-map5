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
  } catch {
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
  } catch {
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

    const newsItems = rawRssFeeds.flatMap((f) => f.items).slice(0, 8);

    const cleanAndTruncate = (text) => {
      if (!text) return "";
      return text
        .replace(/<[^>]*>?/gm, "")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 300);
    };

    const simplifiedNews = newsItems.map((item) => ({
      title: item.title || "",
      content: cleanAndTruncate(item.contentSnippet || item.content || ""),
      link: item.link || "",
    }));

    const limitedPolice = policeRecords.slice(0, 5).map((record) => ({
      ...record,
      description: cleanAndTruncate(record.description),
    }));

    const systemPrompt = `You are a geographic labeling assistant. Extract real physical events in Taiwan from news and police records.
Output STRICTLY follows this JSON schema:
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
【CATEGORY RULES】
- **construction**: "施工", "挖路", "鋪柏油", "管線", "封閉", "改道"
- **disaster**: "火災", "火警", "車禍", "交通事故", "坍方", "淹水", "地震"
- **traffic**: congestion, signal failures WITHOUT accidents
- **police**: checkpoints, law enforcement
- **activity**: festivals, parades, ceremonies
- **other**: ONLY if nothing else fits
【TITLE】Never use "全國", "國道". Use "台北市忠孝東路 - 路面施工" format.`;

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

    const parsed = completion.choices[0].message.parsed;
    let eventsArray = parsed?.events || [];

    const policeEvents = policeRecords.map((r) => ({
      title: `${r.road || r.city} - ${r.eventType}`,
      content: r.description,
      category: r.eventType.includes("施工")
        ? "construction"
        : r.eventType.includes("事故") || r.eventType.includes("車禍")
        ? "disaster"
        : "traffic",
      url: "",
      lat: r.lat,
      lng: r.lng,
      city: r.city,
      source: "警廣路況",
    }));

    const allEvents = [...eventsArray, ...policeEvents];

    const validEvents = allEvents.filter((item) => {
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lng);
      return (
        !isNaN(lat) &&
        !isNaN(lng) &&
        lat >= 21 &&
        lat <= 26 &&
        lng >= 118 &&
        lng <= 122
      );
    }).map((item) => ({
      ...item,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lng),
    }));

    res.setHeader("Vercel-CDN-Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.json(validEvents);
  } catch (error) {
    console.error("❌ /api/events error:", error.message);
    res.status(500).json({ error: "處理失敗", details: error.message });
  }
});

module.exports = app;
