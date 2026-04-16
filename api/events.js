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

// ─────────────────────────────────────────────
// RSS 抓取
// ─────────────────────────────────────────────
async function fetchOneRssFeed(rssUrl) {
  try {
    const xmlResponse = await axios.get(rssUrl, {
      timeout: 8000,
      responseType: "text",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });
    const feed = await parser.parseString(String(xmlResponse.data || ""));
    return feed.items || [];
  } catch {
    try {
      const feed = await parser.parseURL(rssUrl);
      return feed.items || [];
    } catch {
      return [];
    }
  }
}
// ─────────────────────────────────────────────
// TDX Token：加日誌、加錯誤細節
// ─────────────────────────────────────────────
async function getTDXToken() {
  if (!process.env.TDX_CLIENT_ID || !process.env.TDX_CLIENT_SECRET) {
    console.warn("⚠️ 未設定 TDX_CLIENT_ID / TDX_CLIENT_SECRET，跳過 TDX 抓取");
    return null;
  }
  try {
    const authRes = await axios.post(
      "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token",
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.TDX_CLIENT_ID,
        client_secret: process.env.TDX_CLIENT_SECRET,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 8000 }
    );
    const token = authRes.data.access_token || null;
    console.log(token ? "✅ TDX Token 取得成功" : "❌ TDX Token 回應無 access_token");
    return token;
  } catch (err) {
    // 印出詳細錯誤讓你看清楚是 401/403 還是網路問題
    console.error("❌ TDX Token 取得失敗:", err.response?.status, err.response?.data || err.message);
    return null;
  }
}
// 1. TDX 路況事件（traffic）
//    全國高快速路 + 省道：用單一 All 端點一次搞定，不再逐縣市迴圈
// ─────────────────────────────────────────────
async function fetchTDXTraffic(token) {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  // V3 All 端點一次抓全國，省去多次請求+延遲
  const urls = [
    "https://tdx.transportdata.tw/api/advanced/v3/Road/Traffic/Event/Freeway?$format=JSON",
    "https://tdx.transportdata.tw/api/advanced/v3/Road/Traffic/Event/ProvincialHighway?$format=JSON",
  ];

  const results = await Promise.allSettled(
    urls.map(url => axios.get(url, { headers, timeout: 8000 }))
  );

  const records = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const data = r.value.data?.Events || r.value.data?.Event || r.value.data || [];
    if (Array.isArray(data)) records.push(...data);
  }

  return records.map(item => {
    const lng = parseFloat(item.LocationPt?.PositionLon ?? item.StartPositionLon ?? "");
    const lat = parseFloat(item.LocationPt?.PositionLat ?? item.StartPositionLat ?? "");
    const content = item.Comment || item.EventDescription || item.Description || "無詳細說明";
    const road = item.RoadName || item.AreaName || item.EventTitle || "道路";
    return {
      title: `${road} - ${content}`.substring(0, 80),
      content,
      category: "traffic",
      lat, lng,
      city: (item.CityName || item.AreaName || "全國").replace(/市$|縣$/, "市").split("-")[0],
      source: "TDX路況",
      url: "",
    };
  }).filter(r => isValidTW(r.lat, r.lng));
}

// ─────────────────────────────────────────────
// 2. TDX 道路施工（construction）
//    Road/Construction 端點
// ─────────────────────────────────────────────
async function fetchTDXTraffic(token) {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const urls = [
    "https://tdx.transportdata.tw/api/advanced/v3/Road/Traffic/Event/Freeway?$format=JSON",
    "https://tdx.transportdata.tw/api/advanced/v3/Road/Traffic/Event/ProvincialHighway?$format=JSON",
  ];

  const results = await Promise.allSettled(
    urls.map(url => axios.get(url, { headers, timeout: 8000 }))
  );

  const records = [];
  for (const r of results) {
    if (r.status !== "fulfilled") {
      console.warn("❌ TDX Traffic 失敗:", r.reason?.response?.status, r.reason?.message);
      continue;
    }
    const raw = r.value.data;
    // 印出結構讓你看清楚
    const keys = Object.keys(raw || {});
    console.log("🔍 TDX Traffic 回傳 keys:", keys, "| 第一層型別:", typeof raw);
    
    // 嘗試更多可能的 key
    const data = raw?.Events ?? raw?.Event ?? raw?.TrafficEvents ?? raw?.data ?? raw ?? [];
    console.log(`  → 取得陣列長度: ${Array.isArray(data) ? data.length : "非陣列"}`);
    if (Array.isArray(data)) records.push(...data);
  }

  return records.map(item => { /* ... 同原本 ... */ }).filter(r => isValidTW(r.lat, r.lng));
}

  return records.map(item => {
    const lng = parseFloat(item.StartPositionLon ?? item.LocationPt?.PositionLon ?? "");
    const lat = parseFloat(item.StartPositionLat ?? item.LocationPt?.PositionLat ?? "");
    const content = item.ConstructionDescription || item.Comment || item.Description || "道路施工中";
    const road = item.RoadName || item.AreaName || "施工路段";
    const start = item.StartTime ? item.StartTime.substring(0, 10) : "";
    const end = item.EndTime ? item.EndTime.substring(0, 10) : "";
    const timeInfo = start ? `（${start}${end ? " ~ " + end : ""}）` : "";
    return {
      title: `${road} 施工${timeInfo}`.substring(0, 80),
      content,
      category: "construction",
      lat, lng,
      city: (item.CityName || item.AreaName || "全國").split("-")[0],
      source: "TDX施工",
      url: "",
    };
  }).filter(r => isValidTW(r.lat, r.lng));
}

// ─────────────────────────────────────────────
// 3. 消防事件（fire）
//    主源：政府開放資料平台（data.gov.tw）
//    備援：RSS 關鍵字過濾
// ─────────────────────────────────────────────
async function fetchFireEvents() {
  // 正確的政府開放資料消防資料集（119即時）
  const FIRE_URLS = [
    // 嘗試多個可能的資料集
    "https://data.gov.tw/api/v2/rest/datastore/301000000A-000076-001?limit=50&format=json",
    "https://data.gov.tw/api/v2/rest/datastore/301000000A-000223-001?limit=50&format=json",
    // NFA 備用域名
    "https://opendata.nfa.gov.tw/api/FireDepartmentData/GetFireDepartmentData?$format=JSON",
  ];

  for (const url of FIRE_URLS) {
    try {
      const res = await axios.get(url, { timeout: 8000 });
      const records =
        res.data?.result?.records ||
        res.data?.records ||
        res.data?.value ||
        res.data || [];

      if (Array.isArray(records) && records.length > 0) {
        // 印出第一筆讓你確認欄位名稱
        console.log("✅ 消防資料成功，第一筆 keys:", Object.keys(records[0] || {}));
        return records.slice(0, 50).map(item => {
          const lat = parseFloat(
            item.Lat ?? item.lat ?? item.latitude ?? item.Y ?? ""
          );
          const lng = parseFloat(
            item.Lon ?? item.lon ?? item.longitude ?? item.Lng ?? item.X ?? ""
          );
          const content =
            item.CaseContent ?? item.EventType ?? item.Description ??
            item.casecontent ?? item.eventtype ?? "消防出動";
          const city = (
            item.UnitName ?? item.City ?? item.city ?? item.AreaName ?? "全國"
          ).replace(/消防局.*/, "");
          return {
            title: `${city} - ${content}`.substring(0, 80),
            content,
            category: "fire",
            lat: isNaN(lat) ? 23.5 : lat,
            lng: isNaN(lng) ? 120.5 : lng,
            city,
            source: "消防署",
            url: "",
          };
        }).filter(r => isValidTW(r.lat, r.lng));
      }
      console.warn(`⚠️ 消防 URL 無資料: ${url}`);
    } catch (err) {
      console.warn(`⚠️ 消防 API 失敗 (${url}):`, err.response?.status ?? err.message);
    }
  }

  return fetchFireRSSFallback();
}

// 消防 RSS 備援（多來源 + 更多關鍵字）
async function fetchFireRSSFallback() {
  const RSS_URLS = [
    "https://news.ltn.com.tw/rss/all.xml",
    "https://udn.com/rssfeed/news/2/6638?ch=news",
  ];
  const FIRE_KEYWORDS = /火災|消防|救援|火警|爆炸|火勢|起火|燃燒/;

  const allItems = [];
  for (const url of RSS_URLS) {
    try {
      const items = await fetchOneRssFeed(url);
      const matched = items.filter(item => FIRE_KEYWORDS.test(item.title || ""));
      allItems.push(...matched);
      if (allItems.length >= 10) break;
    } catch { /* skip */ }
  }

  console.log(`🔄 消防 RSS 備援: ${allItems.length} 筆`);
  return allItems.slice(0, 10).map(item => ({
    title: item.title || "消防事件",
    content: (item.contentSnippet || "").substring(0, 200),
    category: "fire",
    lat: 23.5, lng: 120.5,
    city: "全國",
    source: "RSS備援",
    url: item.link || "",
  }));
}

// ─────────────────────────────────────────────
// 工具函式：確認台灣範圍
// ─────────────────────────────────────────────
function isValidTW(lat, lng) {
  return !isNaN(lat) && !isNaN(lng) && lat >= 21 && lat <= 26 && lng >= 118 && lng <= 122;
}

// ─────────────────────────────────────────────
// AI 地理標註（新聞 + 消防 RSS）
// ─────────────────────────────────────────────
async function parseWithAI(newsItems) {
  if (!openai || newsItems.length === 0) return [];

  const cleanAndTruncate = (text) =>
    (text || "").replace(/<[^>]*>?/gm, "").replace(/\s+/g, " ").trim().substring(0, 300);

  const simplified = newsItems.slice(0, 15).map(item => ({
    title: item.title || "",
    content: cleanAndTruncate(item.contentSnippet || item.content || ""),
    link: item.link || "",
  }));

  const systemPrompt = `You are a geographic labeling assistant for Taiwan news events.

【RULES】
1. 每條新聞都必須轉成 JSON，禁止略過任何一條，禁止回傳空陣列。
2. 沒有精確地址時，給該縣市中心點座標。
3. 火災/救援/火警類新聞 category 必須填 "fire"。
4. 施工/道路封閉 category 填 "construction"。

【CATEGORY ENUM】
traffic | construction | disaster | police | activity | politics | social | life | tech | finance | fire | entertainment | international | other

【CITY FALLBACK COORDINATES】
台北市: 25.0330,121.5654 | 新北市: 25.0169,121.4628 | 桃園市: 24.9937,121.3009
台中市: 24.1477,120.6736 | 高雄市: 22.6273,120.3014 | 台南市: 22.9997,120.2270
彰化縣: 24.0685,120.5575 | 宜蘭縣: 24.7021,121.7378 | 花蓮縣: 23.9872,121.6015
其他: 23.5,120.5`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `【新聞】${JSON.stringify(simplified)}` },
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
                    category: { type: "string", enum: ["traffic","construction","disaster","police","activity","politics","social","life","tech","finance","fire","entertainment","international","other"] },
                    url: { type: "string" },
                    lat: { type: "number" },
                    lng: { type: "number" },
                    city: { type: "string" },
                    source: { type: "string" },
                  },
                  required: ["title","content","category","url","lat","lng","city","source"],
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

    const parsedData = completion.choices[0].message.parsed
      || JSON.parse(completion.choices[0].message.content || "{}");
    return Array.isArray(parsedData) ? parsedData : (parsedData?.events || []);
  } catch (err) {
    console.error("❌ AI 解析失敗:", err.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// Express 路由
// ─────────────────────────────────────────────
app.use(cors());
app.use(express.json());
// 在 /api/events 路由中，把 newsItems 傳進備援
app.get("/api/events", async (req, res) => {
  try {
    const tdxToken = await getTDXToken().catch(() => null);

    const [rssResults, trafficEvents, constructionEvents, fireApiEvents] = await Promise.all([
      Promise.all(DEFAULT_RSS_SOURCES.map(fetchOneRssFeed)),
      tdxToken ? fetchTDXTraffic(tdxToken) : Promise.resolve([]),
      tdxToken ? fetchTDXConstruction(tdxToken) : Promise.resolve([]),
      fetchFireEvents(),
    ]);

    const newsItems = rssResults.flat();

    // ✅ 若 API 消防事件為 0，從已有 RSS 撈
    const fireEvents = fireApiEvents.length > 0
      ? fireApiEvents
      : extractFireFromRSS(newsItems);  // 新函式，見下方

    console.log(`RSS: ${newsItems.length} 則 | 路況: ${trafficEvents.length} 筆 | 施工: ${constructionEvents.length} 筆 | 消防: ${fireEvents.length} 筆`);

    const aiEvents = await parseWithAI(newsItems);
    const allEvents = [...trafficEvents, ...constructionEvents, ...fireEvents, ...aiEvents];
    // ...
  }
});

// 從 RSS items 直接過濾消防新聞（不需再 AI 解析，先給預設座標）
function extractFireFromRSS(newsItems) {
  const FIRE_RE = /火災|消防|救援|火警|爆炸|火勢|起火|燃燒/;
  return newsItems
    .filter(item => FIRE_RE.test(item.title || ""))
    .slice(0, 10)
    .map(item => ({
      title: item.title || "消防事件",
      content: (item.contentSnippet || "").substring(0, 200),
      category: "fire",
      lat: 23.5, lng: 120.5,  // AI parseWithAI 會幫補正
      city: "全國",
      source: "RSS",
      url: item.link || "",
    }));
}


    console.log(`✅ 回傳總數: ${validEvents.length} 筆`);

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=30");
    res.status(200).json(validEvents);
  } catch (error) {
    console.error("❌ 後端嚴重錯誤:", error);
    res.setHeader("Cache-Control", "no-cache");
    res.status(200).json([]);
  }
});

module.exports = app;
