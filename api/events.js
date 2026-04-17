require("dotenv").config();

const Parser = require("rss-parser");
const axios = require("axios");
const { OpenAI } = require("openai");

const parser = new Parser();

const openaiApiKey = process.env.OPENAI_API_KEY;
const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

const DEFAULT_RSS_SOURCES = [
  "https://news.ltn.com.tw/rss/all.xml",
  "https://udn.com/rssfeed/news/2/6638?ch=news",
  "https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
];

const RSS_TIMEOUT_MS = 2200;
const TDX_TIMEOUT_MS = 1200;
const OPENAI_TIMEOUT_MS = 2200;
const MAX_NEWS_FOR_AI = 8;
const SOFT_DEADLINE_MS = 7000;

const TDX_CITY_SOURCES = [
  { path: "Taipei", city: "Taipei", lat: 25.033, lng: 121.5654 },
  { path: "NewTaipei", city: "New Taipei", lat: 25.0169, lng: 121.4628 },
  { path: "Taoyuan", city: "Taoyuan", lat: 24.9937, lng: 121.3009 },
  { path: "Taichung", city: "Taichung", lat: 24.1477, lng: 120.6736 },
  { path: "Tainan", city: "Tainan", lat: 22.9997, lng: 120.227 },
  { path: "Kaohsiung", city: "Kaohsiung", lat: 22.6273, lng: 120.3014 },
];

const CITY_FALLBACKS = Object.fromEntries(
  TDX_CITY_SOURCES.map((item) => [
    item.city,
    { city: item.city, lat: item.lat, lng: item.lng },
  ])
);

function getRemainingTime(startedAt) {
  return Math.max(0, SOFT_DEADLINE_MS - (Date.now() - startedAt));
}

async function fetchOneRssFeed(rssUrl, startedAt) {
  try {
    const xmlResponse = await axios.get(rssUrl, {
      timeout: Math.max(800, Math.min(RSS_TIMEOUT_MS, getRemainingTime(startedAt) - 200)),
      responseType: "text",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });

    const feed = await parser.parseString(String(xmlResponse.data || ""));
    return feed.items || [];
  } catch (error) {
    console.warn(`[events] RSS fetch failed for ${rssUrl}:`, error.message);
    return [];
  }
}

async function fetchTDXAccessToken(startedAt) {
  const response = await axios.post(
    "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token",
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.TDX_CLIENT_ID,
      client_secret: process.env.TDX_CLIENT_SECRET,
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: Math.max(800, Math.min(TDX_TIMEOUT_MS, getRemainingTime(startedAt) - 200)),
    }
  );

  return response.data?.access_token || "";
}

function normalizeTdxRecord(item) {
  const lng = Number(
    item.LocationPt?.PositionLon ??
      item.PositionLon ??
      item.Geometry?.Coordinates?.[0]
  );
  const lat = Number(
    item.LocationPt?.PositionLat ??
      item.PositionLat ??
      item.Geometry?.Coordinates?.[1]
  );

  const content =
    item.Comment ||
    item.EventDescription ||
    item.Description ||
    "Traffic event";
  const title = item.AreaName || item.RoadName || item.EventTitle || "Traffic";
  const city = String(item.AreaName || item.CityName || "Taiwan").split("-")[0];

  return {
    title: `${title} - ${content}`.slice(0, 120),
    content: String(content).slice(0, 220),
    category: "traffic",
    lat,
    lng,
    city,
    source: "TDX",
    url: "",
  };
}

async function fetchTDXTrafficEvents(startedAt) {
  if (!process.env.TDX_CLIENT_ID || !process.env.TDX_CLIENT_SECRET) {
    console.warn("[events] Missing TDX credentials; skipping traffic feed.");
    return [];
  }

  try {
    if (getRemainingTime(startedAt) < 1200) {
      return [];
    }

    const accessToken = await fetchTDXAccessToken(startedAt);
    if (!accessToken) {
      return [];
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };

    const requests = TDX_CITY_SOURCES.map(async (source) => {
      if (getRemainingTime(startedAt) < 500) {
        return [];
      }

      const url = `https://tdx.transportdata.tw/api/advanced/v3/Road/Traffic/Event/City/${source.path}?$format=JSON`;

      try {
        const response = await axios.get(url, {
          headers,
          timeout: Math.max(600, Math.min(TDX_TIMEOUT_MS, getRemainingTime(startedAt) - 150)),
        });
        const records =
          response.data?.Events ||
          response.data?.Event ||
          response.data ||
          [];

        if (Array.isArray(records)) {
          return records.map(normalizeTdxRecord);
        }

        return [];
      } catch (error) {
        const status = error.response?.status;
        console.warn(
          `[events] TDX fetch failed for ${source.path}:`,
          status ? `HTTP ${status}` : error.message
        );
        return [];
      }
    });

    const results = await Promise.allSettled(requests);
    const trafficEvents = results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : []
    );

    return trafficEvents.filter(
      (item) => Number.isFinite(item.lat) && Number.isFinite(item.lng)
    );
  } catch (error) {
    console.error("[events] TDX fetch failed:", error.message);
    return [];
  }
}

function cleanNewsText(text) {
  return String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

async function extractAiEvents(newsItems, startedAt) {
  if (!openai || !newsItems.length) {
    if (!openai) {
      console.warn("[events] Missing OPENAI_API_KEY; skipping AI extraction.");
    }
    return [];
  }

  const simplifiedNews = newsItems.slice(0, MAX_NEWS_FOR_AI).map((item) => ({
    title: item.title || "",
    content: cleanNewsText(item.contentSnippet || item.content || ""),
    link: item.link || "",
  }));

  const systemPrompt = [
    "Extract only real-world Taiwan events from the provided news.",
    "Return strict JSON with an events array.",
    "Keep only items with a physical place in Taiwan.",
    "Use one category from the allowed enum.",
    "Use the provided city fallback coordinates when exact coordinates are unknown.",
    'Set source to "news".',
  ].join(" ");

  try {
    if (getRemainingTime(startedAt) < 1800) {
      console.warn("[events] Skipping AI extraction due to time budget.");
      return [];
    }

    const completion = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              cityFallbacks: CITY_FALLBACKS,
              news: simplifiedNews,
            }),
          },
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
                          "finance",
                          "international",
                          "entertainment",
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
      }),
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error(`OpenAI timeout after ${OPENAI_TIMEOUT_MS}ms`)),
          OPENAI_TIMEOUT_MS
        );
      }),
    ]);

    const parsed =
      completion.choices?.[0]?.message?.parsed ||
      JSON.parse(completion.choices?.[0]?.message?.content || "{}");

    return Array.isArray(parsed?.events) ? parsed.events : [];
  } catch (error) {
    console.error("[events] AI extraction failed:", error.message);
    return [];
  }
}

function normalizeFinalEvents(events) {
  return events
    .filter((item) => {
      const lat = Number(item.lat);
      const lng = Number(item.lng);
      return (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= 21 &&
        lat <= 26.5 &&
        lng >= 118 &&
        lng <= 123
      );
    })
    .map((item) => ({
      ...item,
      title: String(item.title || "").trim(),
      content: String(item.content || "").trim(),
      city: String(item.city || "Taiwan").trim(),
      source: String(item.source || "unknown").trim(),
      url: String(item.url || "").trim(),
      lat: Number(item.lat),
      lng: Number(item.lng),
    }));
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const startedAt = Date.now();
    const [rssResults, tdxEvents] = await Promise.all([
      Promise.all(DEFAULT_RSS_SOURCES.map((url) => fetchOneRssFeed(url, startedAt))),
      fetchTDXTrafficEvents(startedAt),
    ]);
    const rssItems = rssResults.flat();
    const aiEvents = await extractAiEvents(rssItems, startedAt);
    const finalEvents = normalizeFinalEvents([...tdxEvents, ...aiEvents]);

    console.log(
      "[events] rss=%d tdx=%d ai=%d final=%d totalMs=%d",
      rssItems.length,
      tdxEvents.length,
      aiEvents.length,
      finalEvents.length,
      Date.now() - startedAt
    );

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(finalEvents);
  } catch (error) {
    console.error("[events] Handler failed:", error.message);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.status(200).json([]);
  }
};
