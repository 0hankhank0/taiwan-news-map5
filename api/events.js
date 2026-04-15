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

async function fetchOneRssFeed(rssUrl) {
  try {
    const xmlResponse = await axios.get(rssUrl, {
      timeout: 10000,
      responseType: "text",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });
    const feed = await parser.parseString(String(xmlResponse.data || ""));
    return { items: feed.items || [] };
  } catch (err) {
    console.log(`⚠️ RSS fetch failed for ${rssUrl}:`, err.message);
    try {
      const feed = await parser.parseURL(rssUrl);
      return { items: feed.items || [] };
    } catch (innerErr) {
      return { items: [] };
    }
  }
}

/**
 * 強化版 TDX 抓取：抓取全台主要縣市道路事件
 */
async function fetchTDXPoliceRecords() {
  try {
    console.log('📡 正在請求 TDX 認證 Token...');
    
    // 1. 取得 Token
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

    // 2. 定義要抓取的縣市清單
    const cities = ['Taipei', 'NewTaipei', 'Taoyuan', 'Taichung', 'Tainan', 'Kaohsiung', 'Keelung'];
    console.log(`✅ TDX Token 取得成功，正在並行抓取全台路況 (${cities.join(', ')})...`);

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };

    // 使用 Promise.all 並行請求，並為每個請求加上獨立 catch 確保容錯
    const fetchPromises = cities.map(city => 
      axios.get(`https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Event/City/${city}?$format=JSON`, { headers, timeout: 10000 })
        .then(res => res.data || [])
        .catch(err => {
          console.error(`⚠️ TDX 抓取失敗 (${city}):`, err.message);
          return []; // 單一縣市失敗回傳空陣列，不影響整體
        })
    );

    const cityResults = await Promise.all(fetchPromises);
    const combinedRecords = cityResults.flat(); // 合併所有縣市資料

    console.log(`📊 TDX 原始資料總計: ${combinedRecords.length} 筆`);

    // 3. 解析與轉換
    const formatted = combinedRecords.map((item) => {
      // 經緯度抓取：優先使用 item.PositionLon / item.PositionLat，或 item.LocationPt 內的屬性
      const lat = parseFloat(item.PositionLat || item.LocationPt?.PositionLat);
      const lng = parseFloat(item.PositionLon || item.LocationPt?.PositionLon);
      
      // 內容抓取：優先使用 item.EventDescription，其次為 item.Description 或 item.RoadDirection
      const description = item.EventDescription || item.Description || item.RoadDirection || "無詳細說明";
      
      const roadType = item.RoadType || item.EventType || "";
      const title = item.RoadName || item.AreaName || item.EventTitle || "即時路況";

      return {
        title: `${title} - ${roadType || '路況'}`,
        content: description,
        category: (roadType + description).includes("施工") ? "construction" : 
                  (roadType + description).includes("事故") ? "disaster" : "traffic",
        lat: lat,
        lng: lng,
        city: (item.AreaName || item.CityName || "全國").split("-")[0],
        source: "即時路況",
        url: "",
      };
    }).filter((r) => !isNaN(r.lat) && !isNaN(r.lng)); // 過濾掉沒有經緯度的無效資料

    console.log(`✅ TDX 解析成功：${formatted.length} 筆有效事件`);
    return formatted;

  } catch (err) {
    console.error('❌ TDX 流程發生錯誤:', err.message);
    return [];
  }
}

app.use(cors());
app.use(express.json());

app.get("/api/events", async (req, res) => {
  try {
    const [rawRssFeeds, pbsEvents] = await Promise.all([
      Promise.all(DEFAULT_RSS_SOURCES.map((url) => fetchOneRssFeed(url))),
      fetchTDXPoliceRecords(),
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

    const systemPrompt = `You are a geographic labeling assistant. Your job is to extract EVERY single physical event from the provided Taiwan news.

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

    const userContent = `【新聞】${JSON.stringify(simplifiedNews)}`;

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
      console.error('❌ AI JSON 解析失敗:', parseErr.message);
    }

    // 合併 TDX 與 AI 新聞
    const finalEvents = [...pbsEvents, ...aiEvents];

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

    console.log('✅ 最終合併準備回傳總數:', validEvents.length);

    // 設定 Cache-Control 標頭
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=30");
    res.status(200).json(validEvents);
  } catch (error) {
    console.error('❌ 後端發生嚴重錯誤:', error);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.status(200).json([]); 
  }
});

module.exports = app;
