
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const Parser = require("rss-parser");
const axios = require("axios");
const { OpenAI } = require("openai");

const app = express();
const parser = new Parser();

const openaiApiKey = process.env.OPENAI_API_KEY;
];

const RSS_TIMEOUT_MS = 5000;
const TDX_TIMEOUT_MS = 1500;
const OPENAI_TIMEOUT_MS = 3000;
const MAX_NEWS_FOR_AI = 6;
const TDX_TIMEOUT_MS = 2500;
const OPENAI_TIMEOUT_MS = 5000;
const MAX_NEWS_FOR_AI = 8;

const TDX_CITY_SOURCES = [
  { path: "Taipei", city: "Taipei", lat: 25.033, lng: 121.5654 },
  { path: "NewTaipei", city: "New Taipei", lat: 25.0169, lng: 121.4628 },
  { path: "Taoyuan", city: "Taoyuan", lat: 24.9937, lng: 121.3009 },
  { path: "Taichung", city: "Taichung", lat: 24.1477, lng: 120.6736 },
  { path: "Tainan", city: "Tainan", lat: 22.9997, lng: 120.227 },
  { path: "Kaohsiung", city: "Kaohsiung", lat: 22.6273, lng: 120.3014 },
];

const CITY_FALLBACKS = Object.fromEntries(
      responseType: "text",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });

    const feed = await parser.parseString(String(xmlResponse.data || ""));
    return { items: feed.items || [] };
  } catch (err) {
    console.log(`[events] RSS fetch failed for ${rssUrl}:`, err.message);
    return { items: [] };
    return feed.items || [];
  } catch (error) {
    console.warn(`[events] RSS fetch failed for ${rssUrl}:`, error.message);
    return [];
  }
}

async function fetchTDXAccessToken() {
  const authRes = await axios.post(
  const response = await axios.post(
    "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token",
    new URLSearchParams({
      grant_type: "client_credentials",
      client_secret: process.env.TDX_CLIENT_SECRET,
    }),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: TDX_TIMEOUT_MS,
    }
  );

  return authRes.data?.access_token;
  return response.data?.access_token || "";
}

function normalizeTdxRecord(item) {
  const lng = parseFloat(
  const lng = Number(
    item.LocationPt?.PositionLon ??
      item.PositionLon ??
      item.Geometry?.Coordinates?.[0]
  );
  const lat = parseFloat(
  const lat = Number(
    item.LocationPt?.PositionLat ??
      item.PositionLat ??
      item.Geometry?.Coordinates?.[1]
  );

  const content =
    item.Comment || item.EventDescription || item.Description || "Traffic event";
    item.Comment ||
    item.EventDescription ||
    item.Description ||
    "Traffic event";
  const title = item.AreaName || item.RoadName || item.EventTitle || "Traffic";
  const city = (item.AreaName || item.CityName || "Taiwan").split("-")[0];
  const city = String(item.AreaName || item.CityName || "Taiwan").split("-")[0];

  return {
    title: `${title} - ${content}`,
    content,
    title: `${title} - ${content}`.slice(0, 120),
    content: String(content).slice(0, 220),
    category: "traffic",
    lat,
    lng,
  };
}

async function fetchTDXPoliceRecords() {
async function fetchTDXTrafficEvents() {
  if (!process.env.TDX_CLIENT_ID || !process.env.TDX_CLIENT_SECRET) {
    console.warn("[events] Missing TDX credentials; skipping traffic feed.");
    return [];
  }

  try {
    if (!process.env.TDX_CLIENT_ID || !process.env.TDX_CLIENT_SECRET) {
      console.warn("[events] Missing TDX credentials; skipping TDX fetch.");
      return [];
    }

    const accessToken = await fetchTDXAccessToken();
    if (!accessToken) {
      throw new Error("Missing TDX access token");
      return [];
    }

    const headers = {
      Accept: "application/json",
    };

    const combinedRecords = [];
    const trafficEvents = [];

    for (const source of TDX_CITY_SOURCES) {
      const url = `https://tdx.transportdata.tw/api/advanced/v3/Road/Traffic/Event/City/${source.path}?$format=JSON`;

      try {
        const response = await axios.get(url, { headers, timeout: TDX_TIMEOUT_MS });
        const data =
        const records =
          response.data?.Events ||
          response.data?.Event ||
          response.data ||
          [];

        if (Array.isArray(data)) {
          combinedRecords.push(...data);
        if (Array.isArray(records)) {
          trafficEvents.push(...records.map(normalizeTdxRecord));
        }
      } catch (err) {
        const status = err.response?.status;
        const detail = status ? `HTTP ${status}` : err.message;
        console.error(`[events] TDX fetch failed for ${url}:`, detail);
      } catch (error) {
        const status = error.response?.status;
        console.warn(
          `[events] TDX fetch failed for ${source.path}:`,
          status ? `HTTP ${status}` : error.message
        );

        if (status === 429) {
          break;
      }
    }

    return combinedRecords
      .map(normalizeTdxRecord)
      .filter((item) => !Number.isNaN(item.lat) && !Number.isNaN(item.lng));
  } catch (err) {
    console.error("[events] TDX fetch failed:", err.message);
    return trafficEvents.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
  } catch (error) {
    console.error("[events] TDX fetch failed:", error.message);
    return [];
  }
}

function cleanNewsText(text) {
  if (!text) return "";
  return text.replace(/<[^>]*>?/gm, "").replace(/\s+/g, " ").trim().slice(0, 240);
  return String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

async function extractAiEvents(newsItems) {
  if (!openai || !newsItems.length) {
    if (!openai) {
      console.warn("[events] Missing OpenAI API key; skipping AI extraction.");
      console.warn("[events] Missing OPENAI_API_KEY; skipping AI extraction.");
    }
    return [];
  }
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
  const systemPrompt = [
    "Extract only real-world Taiwan events from the provided news.",
    "Return strict JSON with an events array.",
    "Keep only items with a physical place in Taiwan.",
    "Use one category from the allowed enum.",
    "Use the provided city fallback coordinates when exact coordinates are unknown.",
    'Set source to "news".',
  ].join(" ");

  try {
    const completion = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userPayload) },
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
          },
        },
        temperature: 0,
      }),
      new Promise((_, reject) =>
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error(`OpenAI timeout after ${OPENAI_TIMEOUT_MS}ms`)),
          OPENAI_TIMEOUT_MS
        )
      ),
        );
      }),
    ]);

    const parsed =
      completion.choices?.[0]?.message?.parsed ||
      JSON.parse(completion.choices?.[0]?.message?.content || "{}");

    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.events)) return parsed.events;
    return [];
  } catch (err) {
    console.error("[events] AI extraction failed:", err.message);
    return Array.isArray(parsed?.events) ? parsed.events : [];
  } catch (error) {
    console.error("[events] AI extraction failed:", error.message);
    return [];
  }
}
function normalizeFinalEvents(events) {
  return events
    .filter((item) => {
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lng);
      return !Number.isNaN(lat) && !Number.isNaN(lng) && lat >= 21 && lat <= 26 && lng >= 118 && lng <= 122;
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
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lng),
      title: String(item.title || "").trim(),
      content: String(item.content || "").trim(),
      city: String(item.city || "Taiwan").trim(),
      source: String(item.source || "unknown").trim(),
      url: String(item.url || "").trim(),
      lat: Number(item.lat),
      lng: Number(item.lng),
    }));
}

app.use(cors());
app.use(express.json());
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

app.get("/api/events", async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const startedAt = Date.now();
    const [rawRssFeeds, tdxEvents] = await Promise.all([
    const [rssResults, tdxEvents] = await Promise.all([
      Promise.all(DEFAULT_RSS_SOURCES.map((url) => fetchOneRssFeed(url))),
      fetchTDXPoliceRecords(),
      fetchTDXTrafficEvents(),
    ]);
    const afterFeedsAt = Date.now();

    const newsItems = rawRssFeeds.flatMap((feed) => feed.items || []);
    const aiEvents = await extractAiEvents(newsItems);
    const afterAiAt = Date.now();
    const rssItems = rssResults.flat();
    const aiEvents = await extractAiEvents(rssItems);
    const finalEvents = normalizeFinalEvents([...tdxEvents, ...aiEvents]);

    console.log(
      "[events] rssItems=%d tdxEvents=%d aiEvents=%d final=%d rss+tdxMs=%d aiMs=%d totalMs=%d",
      newsItems.length,
      "[events] rss=%d tdx=%d ai=%d final=%d totalMs=%d",
      rssItems.length,
      tdxEvents.length,
      aiEvents.length,
      finalEvents.length,
      afterFeedsAt - startedAt,
      afterAiAt - afterFeedsAt,
      afterAiAt - startedAt
      Date.now() - startedAt
    );

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json(finalEvents);
    return res.status(200).json(finalEvents);
  } catch (error) {
    console.error("[events] handler failed:", error.message);
    console.error("[events] Handler failed:", error.message);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.status(200).json([]);
    return res.status(200).json([]);
  }
});

module.exports = app;
};
