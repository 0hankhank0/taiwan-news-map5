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
const TDX_TIMEOUT_MS = 1800;
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

const TDX_CMS_SOURCES = [
  ...TDX_CITY_SOURCES.map((item) => ({
    type: "City",
    path: item.path,
    city: item.city,
    lat: item.lat,
    lng: item.lng,
  })),
  { type: "Highway", path: "Highway", city: "Highway", lat: 23.8, lng: 120.9 },
  { type: "Freeway", path: "Freeway", city: "Freeway", lat: 23.8, lng: 120.9 },
];

let tdxStaticCmsCache = {
  expiresAt: 0,
  bySource: new Map(),
};

const CITY_FALLBACKS = Object.fromEntries(
  TDX_CITY_SOURCES.map((item) => [
    item.city,
    { city: item.city, lat: item.lat, lng: item.lng },
  ])
);

const CITY_ALIASES = [
  { keywords: ["台北", "臺北", "Taipei"], city: "Taipei" },
  { keywords: ["新北", "New Taipei"], city: "New Taipei" },
  { keywords: ["桃園", "Taoyuan"], city: "Taoyuan" },
  { keywords: ["台中", "臺中", "Taichung"], city: "Taichung" },
  { keywords: ["台南", "臺南", "Tainan"], city: "Tainan" },
  { keywords: ["高雄", "Kaohsiung"], city: "Kaohsiung" },
  { keywords: ["基隆", "Keelung"], city: "Keelung", lat: 25.1276, lng: 121.7392 },
  { keywords: ["新竹"], city: "Hsinchu", lat: 24.8138, lng: 120.9675 },
  { keywords: ["苗栗"], city: "Miaoli", lat: 24.5602, lng: 120.8214 },
  { keywords: ["彰化"], city: "Changhua", lat: 24.0817, lng: 120.5384 },
  { keywords: ["南投"], city: "Nantou", lat: 23.9609, lng: 120.9719 },
  { keywords: ["雲林"], city: "Yunlin", lat: 23.7092, lng: 120.4313 },
  { keywords: ["嘉義"], city: "Chiayi", lat: 23.4801, lng: 120.4491 },
  { keywords: ["屏東"], city: "Pingtung", lat: 22.5519, lng: 120.5488 },
  { keywords: ["宜蘭"], city: "Yilan", lat: 24.7021, lng: 121.7378 },
  { keywords: ["花蓮"], city: "Hualien", lat: 23.9872, lng: 121.6015 },
  { keywords: ["台東", "臺東", "Taitung"], city: "Taitung", lat: 22.7583, lng: 121.1444 },
  { keywords: ["澎湖"], city: "Penghu", lat: 23.5712, lng: 119.5793 },
  { keywords: ["金門"], city: "Kinmen", lat: 24.4321, lng: 118.3171 },
  { keywords: ["連江", "馬祖"], city: "Lienchiang", lat: 26.1602, lng: 119.9517 },
 ];

const CATEGORY_KEYWORDS = [
  { category: "traffic", keywords: ["車禍", "撞", "塞車", "封路", "改道", "交通", "道路", "路段", "國道", "省道"] },
  { category: "disaster", keywords: ["地震", "颱風", "豪雨", "淹水", "坍方", "土石流", "災情", "停電"] },
  { category: "fire", keywords: ["火警", "火災", "燃燒", "爆炸"] },
  { category: "police", keywords: ["警方", "警察", "嫌犯", "逮捕", "詐騙", "槍擊"] },
  { category: "construction", keywords: ["施工", "工程", "開工", "封閉施工", "捷運"] },
  { category: "activity", keywords: ["活動", "演唱會", "展覽", "賽事", "燈會", "遊行", "集會"] },
  { category: "politics", keywords: ["市府", "縣府", "立院", "議會", "總統", "行政院"] },
  { category: "finance", keywords: ["台積電", "投資", "股市", "漲價", "財報"] },
  { category: "social", keywords: ["命案", "受傷", "死亡", "失蹤", "糾紛"] },
];

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

function getTdxHeaders(accessToken) {
  const headers = { Accept: "application/json" };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

function buildTdxCmsUrl(source, isLive = false) {
  const basePath = isLive
    ? ["api", "basic", "v2", "Road", "Traffic", "Live", "CMS"]
    : ["api", "basic", "v2", "Road", "Traffic", "CMS"];

  if (source.type === "City") {
    basePath.push("City", encodeURIComponent(source.path));
  } else if (source.type === "Highway" || source.type === "Freeway") {
    basePath.push(source.type);
  } else {
    throw new Error(`Unsupported TDX CMS source type: ${source.type}`);
  }

  return `https://tdx.transportdata.tw/${basePath.join("/")}?$format=JSON`;
}

function extractArrayFromTdxPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  for (const key of Object.keys(payload)) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }
  }

  return [];
}

function getCmsKey(item) {
  return String(
    item.CMSID ||
      item.CmsID ||
      item.cmsId ||
      item.CMSId ||
      item.DeviceID ||
      item.id ||
      ""
  ).trim();
}

function normalizeCmsStaticRecord(item, source) {
  const cmsId = getCmsKey(item);
  const lng = Number(
    item.PositionLon ??
      item.positionLon ??
      item.px ??
      item.Location?.PositionLon ??
      item.LocationPt?.PositionLon
  );
  const lat = Number(
    item.PositionLat ??
      item.positionLat ??
      item.py ??
      item.Location?.PositionLat ??
      item.LocationPt?.PositionLat
  );

  if (!cmsId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    cmsId,
    city: source.city,
    lat,
    lng,
    roadName: String(item.RoadName || item.roadName || item.LinkName || "").trim(),
    location: String(item.LocationDescription || item.locationDescription || "").trim(),
  };
}

function normalizeCmsLiveRecord(item, source, staticLookup) {
  const cmsId = getCmsKey(item);
  const staticInfo = cmsId ? staticLookup.get(cmsId) : null;
  const lng = Number(
    item.PositionLon ??
      item.positionLon ??
      item.LocationPt?.PositionLon ??
      staticInfo?.lng ??
      source.lng
  );
  const lat = Number(
    item.PositionLat ??
      item.positionLat ??
      item.LocationPt?.PositionLat ??
      staticInfo?.lat ??
      source.lat
  );
  const message = String(
    item.Message ||
      item.message ||
      item.DisplayMessage ||
      item.displayMessage ||
      item.Msg ||
      ""
  )
    .replace(/\s+/g, " ")
    .trim();

  if (!message || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const roadName =
    staticInfo?.roadName ||
    String(item.RoadName || item.roadName || item.LinkName || "").trim();
  const location =
    staticInfo?.location ||
    String(item.LocationDescription || item.locationDescription || "").trim();
  const titleBase = roadName || location || `${source.city} CMS`;

  return {
    title: `${titleBase} - CMS`.slice(0, 120),
    content: message.slice(0, 220),
    category: "traffic",
    lat,
    lng,
    city: staticInfo?.city || source.city,
    source: "TDX CMS",
    url: "",
  };
}

async function fetchTdxJson(url, headers, startedAt) {
  const response = await axios.get(url, {
    headers,
    timeout: Math.max(800, Math.min(TDX_TIMEOUT_MS, getRemainingTime(startedAt) - 150)),
  });

  return response.data;
}

async function loadStaticCmsCache(accessToken, startedAt) {
  if (Date.now() < tdxStaticCmsCache.expiresAt && tdxStaticCmsCache.bySource.size > 0) {
    return tdxStaticCmsCache.bySource;
  }

  const headers = getTdxHeaders(accessToken);
  const bySource = new Map();

  const requests = TDX_CMS_SOURCES.map(async (source) => {
    if (getRemainingTime(startedAt) < 800) {
      return;
    }

    try {
      const url = buildTdxCmsUrl(source, false);
      const data = await fetchTdxJson(url, headers, startedAt);
      const records = extractArrayFromTdxPayload(data)
        .map((item) => normalizeCmsStaticRecord(item, source))
        .filter(Boolean);
      bySource.set(`${source.type}:${source.path}`, new Map(records.map((item) => [item.cmsId, item])));
    } catch (error) {
      const status = error.response?.status;
      console.warn(
        `[events] TDX static CMS failed for ${source.type}/${source.path}:`,
        status ? `HTTP ${status}` : error.message,
        `url=${buildTdxCmsUrl(source, false)}`
      );
      bySource.set(`${source.type}:${source.path}`, new Map());
    }
  });

  await Promise.allSettled(requests);

  tdxStaticCmsCache = {
    bySource,
    expiresAt: Date.now() + 1000 * 60 * 60 * 12,
  };

  return bySource;
}

async function fetchTDXTrafficEvents(startedAt) {
  try {
    if (getRemainingTime(startedAt) < 1200) {
      return [];
    }

    let accessToken = "";
    if (process.env.TDX_CLIENT_ID && process.env.TDX_CLIENT_SECRET) {
      try {
        accessToken = await fetchTDXAccessToken(startedAt);
      } catch (error) {
        console.warn("[events] Failed to get TDX token, falling back to public CMS endpoints:", error.message);
      }
    }

    const headers = getTdxHeaders(accessToken);
    const staticCache = await loadStaticCmsCache(accessToken, startedAt);
    const requests = TDX_CMS_SOURCES.map(async (source) => {
      if (getRemainingTime(startedAt) < 500) {
        return [];
      }

      try {
        const url = buildTdxCmsUrl(source, true);
        const data = await fetchTdxJson(url, headers, startedAt);
        const records = extractArrayFromTdxPayload(data);
        const staticLookup = staticCache.get(`${source.type}:${source.path}`) || new Map();
        return records
          .map((item) => normalizeCmsLiveRecord(item, source, staticLookup))
          .filter(Boolean);
      } catch (error) {
        const status = error.response?.status;
        console.warn(
          `[events] TDX live CMS failed for ${source.type}/${source.path}:`,
          status ? `HTTP ${status}` : error.message,
          `url=${buildTdxCmsUrl(source, true)}`
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

function inferCityFromText(text) {
  const sourceText = String(text || "");
  const matched = CITY_ALIASES.find(({ keywords }) =>
    keywords.some((keyword) => sourceText.includes(keyword))
  );

  if (!matched) {
    return null;
  }

  const fallback = CITY_FALLBACKS[matched.city];
  return {
    city: matched.city,
    lat: matched.lat ?? fallback?.lat,
    lng: matched.lng ?? fallback?.lng,
  };
}

function inferCategoryFromText(text) {
  const sourceText = String(text || "");
  const matched = CATEGORY_KEYWORDS.find(({ keywords }) =>
    keywords.some((keyword) => sourceText.includes(keyword))
  );

  return matched?.category || "other";
}

function extractRuleBasedEvents(newsItems) {
  const seen = new Set();

  return newsItems
    .map((item) => {
      const title = String(item.title || "").trim();
      const content = cleanNewsText(item.contentSnippet || item.content || "");
      const combinedText = `${title} ${content}`;
      const cityInfo = inferCityFromText(combinedText);

      if (!cityInfo || !title) {
        return null;
      }

      const dedupeKey = `${cityInfo.city}:${title.slice(0, 40)}`.toLowerCase();
      if (seen.has(dedupeKey)) {
        return null;
      }
      seen.add(dedupeKey);

      return {
        title: title.slice(0, 120),
        content: content || title,
        category: inferCategoryFromText(combinedText),
        url: String(item.link || ""),
        lat: cityInfo.lat,
        lng: cityInfo.lng,
        city: cityInfo.city,
        source: "RSS",
      };
    })
    .filter(Boolean)
    .slice(0, 40);
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
  const dedupe = new Set();

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
    }))
    .filter((item) => {
      const key = `${item.city}:${item.title.slice(0, 50)}:${item.category}`.toLowerCase();
      if (dedupe.has(key)) {
        return false;
      }
      dedupe.add(key);
      return true;
    });
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
    const ruleBasedEvents = extractRuleBasedEvents(rssItems);
    const finalEvents = normalizeFinalEvents(
      [...tdxEvents, ...aiEvents, ...ruleBasedEvents]
    );

    console.log(
      "[events] rss=%d tdx=%d ai=%d rule=%d final=%d totalMs=%d",
      rssItems.length,
      tdxEvents.length,
      aiEvents.length,
      ruleBasedEvents.length,
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
