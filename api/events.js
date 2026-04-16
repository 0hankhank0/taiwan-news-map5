require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Parser = require("rss-parser");
const axios = require("axios");
const { OpenAI } = require("openai");

const app = express();
const parser = new Parser();

const openaiApiKey = process.env.OPENAI_API_KEY;
const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

const DEFAULT_RSS_SOURCES = [
  "https://news.ltn.com.tw/rss/all.xml",
  "https://udn.com/rssfeed/news/2/6638?ch=news",
  "https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
];

const RSS_TIMEOUT_MS = 5000;
const TDX_TIMEOUT_MS = 1500;
const OPENAI_TIMEOUT_MS = 3000;
const MAX_NEWS_FOR_AI = 6;

const TDX_CITY_SOURCES = [
  { path: "Taipei", city: "Taipei", lat: 25.033, lng: 121.5654 },
  { path: "NewTaipei", city: "New Taipei", lat: 25.0169, lng: 121.4628 },
  { path: "Taoyuan", city: "Taoyuan", lat: 24.9937, lng: 121.3009 },
];

const CITY_FALLBACKS = Object.fromEntries(
  TDX_CITY_SOURCES.map((item) => [
    item.city,
    { city: item.city, lat: item.lat, lng: item.lng },
  ])
);

async function fetchOneRssFeed(rssUrl) {
  try {
    const xmlResponse = await axios.get(rssUrl, {
      timeout: RSS_TIMEOUT_MS,
      responseType: "text",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });

    const feed = await parser.parseString(String(xmlResponse.data || ""));
    return { items: feed.items || [] };
  } catch (err) {
    console.log(`[events] RSS fetch failed for ${rssUrl}:`, err.message);
    return { items: [] };
  }
}

async function fetchTDXAccessToken() {
  const authRes = await axios.post(
    "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token",
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.TDX_CLIENT_ID,
      client_secret: process.env.TDX_CLIENT_SECRET,
    }),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: TDX_TIMEOUT_MS,
    }
  );

  return authRes.data?.access_token;
}

function normalizeTdxRecord(item) {
  const lng = parseFloat(
    item.LocationPt?.PositionLon ??
      item.PositionLon ??
      item.Geometry?.Coordinates?.[0]
  );
  const lat = parseFloat(
    item.LocationPt?.PositionLat ??
      item.PositionLat ??
      item.Geometry?.Coordinates?.[1]
  );
  const content =
    item.Comment || item.EventDescription || item.Description || "Traffic event";
  const title = item.AreaName || item.RoadName || item.EventTitle || "Traffic";
  const city = (item.AreaName || item.CityName || "Taiwan").split("-")[0];

  return {
    title: `${title} - ${content}`,
    content,
    category: "traffic",
    lat,
    lng,
    city,
    source: "TDX",
    url: "",
  };
}

async function fetchTDXPoliceRecords() {
  try {
    if (!process.env.TDX_CLIENT_ID || !process.env.TDX_CLIENT_SECRET) {
      console.warn("[events] Missing TDX credentials; skipping TDX fetch.");
      return [];
    }

    const accessToken = await fetchTDXAccessToken();
    if (!accessToken) {
      throw new Error("Missing TDX access token");
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };

    const combinedRecords = [];
    for (const source of TDX_CITY_SOURCES) {
      const url = `https://tdx.transportdata.tw/api/advanced/v3/Road/Traffic/Event/City/${source.path}?$format=JSON`;

      try {
        const response = await axios.get(url, { headers, timeout: TDX_TIMEOUT_MS });
        const data =
          response.data?.Events ||
          response.data?.Event ||
          response.data ||
          [];

        if (Array.isArray(data)) {
          combinedRecords.push(...data);
        }
      } catch (err) {
        const status = err.response?.status;
        const detail = status ? `HTTP ${status}` : err.message;
        console.error(`[events] TDX fetch failed for ${url}:`, detail);

        if (status === 429) {
          break;
        }
      }
    }

    return combinedRecords
      .map(normalizeTdxRecord)
      .filter((item) => !Number.isNaN(item.lat) && !Number.isNaN(item.lng));
  } catch (err) {
    console.error("[events] TDX fetch failed:", err.message);
    return [];
  }
}

function cleanNewsText(text) {
  if (!text) return "";
  return text.replace(/<[^>]*>?/gm, "").replace(/\s+/g, " ").trim().slice(0, 240);
}

async function extractAiEvents(newsItems) {
  if (!openai || !newsItems.length) {
    if (!openai) {
      console.warn("[events] Missing OpenAI API key; skipping AI extraction.");
    }
    return [];
  }

  const simplifiedNews = newsItems.slice(0, MAX_NEWS_FOR_AI).map((item) => ({
    title: item.title || "",
    content: cleanNewsText(item.contentSnippet || item.content || ""),
    link: item.link || "",
  }));

  const systemPrompt = `Extract only Taiwan real-world events from news input.
Return JSON that exactly matches the schema.
Skip editorials, finance, entertainment gossip, and items without a physical location.
Prefer precise coordinates when present; otherwise use a Taiwan city-center fallback.
Set source to "news".`;

  const userPayload = {
    news: simplifiedNews,
    cityFallbacks: CITY_FALLBACKS,
  };

  try {
    const completion = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userPayload) },
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
                      category: {
                        type: "string",
                        enum: [
                          "traffic",
                          "construction",
                          "disaster",
                          "police",
                          "activity",
                          "politics",
                          "social",
                          "life",
                          "tech",
                          "fire",
                          "other",
                        ],
                      },
                      url: { type: "string" },
                      lat: { type: "number" },
                      lng: { type: "number" },
                      city: { type: "string" },
                      source: { type: "string" },
                    },
                    required: [
                      "title",
                      "content",
                      "category",
                      "url",
                      "lat",
                      "lng",
                      "city",
                      "source",
                    ],
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
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`OpenAI timeout after ${OPENAI_TIMEOUT_MS}ms`)),
          OPENAI_TIMEOUT_MS
        )
      ),
    ]);

    const parsed =
      completion.choices?.[0]?.message?.parsed ||
      JSON.parse(completion.choices?.[0]?.message?.content || "{}");

    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.events)) return parsed.events;
    return [];
  } catch (err) {
    console.error("[events] AI extraction failed:", err.message);
    return [];
  }
}

function normalizeFinalEvents(events) {
  return events
    .filter((item) => {
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lng);
      return !Number.isNaN(lat) && !Number.isNaN(lng) && lat >= 21 && lat <= 26 && lng >= 118 && lng <= 122;
    })
    .map((item) => ({
      ...item,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lng),
    }));
}

app.use(cors());
app.use(express.json());

app.get("/api/events", async (req, res) => {
  try {
    const startedAt = Date.now();
    const [rawRssFeeds, tdxEvents] = await Promise.all([
      Promise.all(DEFAULT_RSS_SOURCES.map((url) => fetchOneRssFeed(url))),
      fetchTDXPoliceRecords(),
    ]);
    const afterFeedsAt = Date.now();

    const newsItems = rawRssFeeds.flatMap((feed) => feed.items || []);
    const aiEvents = await extractAiEvents(newsItems);
    const afterAiAt = Date.now();
    const finalEvents = normalizeFinalEvents([...tdxEvents, ...aiEvents]);

    console.log(
      "[events] rssItems=%d tdxEvents=%d aiEvents=%d final=%d rss+tdxMs=%d aiMs=%d totalMs=%d",
      newsItems.length,
      tdxEvents.length,
      aiEvents.length,
      finalEvents.length,
      afterFeedsAt - startedAt,
      afterAiAt - afterFeedsAt,
      afterAiAt - startedAt
    );

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json(finalEvents);
  } catch (error) {
    console.error("[events] handler failed:", error.message);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.status(200).json([]);
  }
});

module.exports = app;
