import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Parser from "rss-parser";
import axios from "axios";
import { OpenAI } from "openai";

dotenv.config();

const app = express();
const parser = new Parser();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mapDataCache = [];
let isSyncing = false;

const DEFAULT_RSS_SOURCES = [
  "https://news.ltn.com.tw/rss/all.xml",
  "https://udn.com/rssfeed/news/2/6638?ch=news",
  "https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
];

const FALLBACK_EVENTS = [];

async function fetchOneRssFeed(rssUrl) {
  try {
    const xmlResponse = await axios.get(rssUrl, {
      timeout: 20000,
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

const PBS_TRAFFIC_URL = "https://rtr.pbs.gov.tw/NMP103_PbsWS/resources/roadData/opendata";

async function fetchPoliceRecords() {
  console.log("📡 正在從警廣官方介接點獲取全國路況資料...");
  try {
    const res = await axios.get(PBS_TRAFFIC_URL, { 
      timeout: 30000,
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    let data = res.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch(e) {}
    }

    const records = data?.result || [];
    console.log(`✅ 獲取警廣資料成功，共 ${records.length} 筆`);

    return records.map(item => ({
      id: item.UID || `pbs-${Math.random()}`,
      eventType: item.roadtype || "路況事件",
      description: item.comment || "無詳細說明",
      city: (item.areaNm || "全國").split('-')[0],
      road: item.road || item.areaNm || "未知路段",
      occurredAt: item.modDttm || new Date().toISOString(),
      lat: parseFloat(item.y1),
      lng: parseFloat(item.x1),
      source: item.srcdetail || "警廣即時路況",
    })).filter(item => !isNaN(item.lat) && !isNaN(item.lng));
  } catch (error) {
    console.warn("⚠️ 獲取警廣路況資料失敗:", error.message);
    return [];
  }
}

async function performBackgroundSync() {
  if (isSyncing) return;
  isSyncing = true;
  console.log("🔄 開始背景同步新聞與警政資料 (使用 OpenAI gpt-4o-mini)... ");

  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ 缺少 OPENAI_API_KEY");
    isSyncing = false;
    return;
  }

  try {
    const rawRssFeeds = await Promise.all(DEFAULT_RSS_SOURCES.map(url => fetchOneRssFeed(url)));
    const newsItems = rawRssFeeds.flatMap(f => f.items);
    const latestNews = newsItems.slice(0, 10);
    const policeRecords = await fetchPoliceRecords();

    const batchSize = 3;
    let allAIResults = [];

    const cleanAndTruncate = (text) => {
      if (!text) return "";
      return text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim().substring(0, 300);        
    };

    for (let i = 0; i < latestNews.length; i += batchSize) {
      try {
        const batch = latestNews.slice(i, i + batchSize);
        const simplifiedBatch = batch.map(item => ({
          title: item.title, 
          content: cleanAndTruncate(item.contentSnippet || item.content || ""),
          link: item.link
        }));

        const limitedPoliceRecords = policeRecords.slice(0, 5).map(record => ({
          ...record,
          description: cleanAndTruncate(record.description)
        }));

        const systemPrompt = `You are a geographic labeling assistant. Your task is to extract real physical events in Taiwan from news and police records.
Output MUST be in JSON format with a root key "events".

【CRITICAL RULES】
1. If no valid events are found, return {"events": []}.
2. STRICTLY extract real facts only.
3. TITLE OPTIMIZATION: Do not use generic titles like "全國" or "國道". Titles MUST follow the format: "Location - Event Description" (e.g., "國道一號北上 88k - 道路施工").
4. CATEGORY RULES:
   - **construction**: MUST use if content mentions "施工", "挖路", "養護", "鋪柏油", "管線工程".
   - **disaster**: MUST use if content mentions "火災", "火警", "車禍", "交通事故", "坍方", "淹水", "土石流".
   - **traffic**: Use for traffic congestion, signal failure, or general road conditions NOT involving accidents or construction.
   - **police**: Use for police enforcement, checkpoints, or criminal investigations.
   - **activity**: Use for local festivals, parades, or scheduled public events.
   - **other**: ONLY use if no other category fits. Avoid this as much as possible.

【JSON STRUCTURE】
Each event object MUST include: "title", "content", "category", "url", "lat", "lng", "city".
"category" MUST be one of: ["traffic", "construction", "crime", "disaster", "activity", "other", "police"].`;

        const userContent = `分析以下資料並提取台灣實體事件：
新聞內容：${JSON.stringify(simplifiedBatch)}
警政紀錄：${JSON.stringify(limitedPoliceRecords)}`;

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent }
          ],
          response_format: { type: "json_object" },
          temperature: 0
        });

        const responseText = completion.choices[0].message.content || "{}";
        const parsed = JSON.parse(responseText);
        // 標記來源為新聞
        const eventsArray = (parsed.events || []).map(ev => ({ ...ev, source: "news" }));

        for (const event of eventsArray) {
          if (!event.title || !event.city) continue;
          const rawLat = parseFloat(event.lat);
          const rawLng = parseFloat(event.lng);
          if (isNaN(rawLat) || isNaN(rawLng)) continue;
          if (rawLng < 118 || rawLng > 122 || rawLat < 21 || rawLat > 26) continue;
          event.lat = rawLat;
          event.lng = rawLng;
          allAIResults.push(event);
        }
        console.log(`✅ 第 ${Math.floor(i / batchSize) + 1} 組處理完畢`);
      } catch (error) {
        console.error("❌ OpenAI 分組處理失敗:", error.message);
      }
      if (i + batchSize < latestNews.length) await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // 整合警政原始資料（標記來源為警廣）
    const mappedPolice = policeRecords.map(r => ({
      title: `${r.road || r.city} - ${r.eventType}`,
      content: r.description,
      category: r.eventType.includes("施工") ? "construction" : (r.eventType.includes("事故") ? "disaster" : "traffic"),
      url: "",
      lat: r.lat,
      lng: r.lng,
      city: r.city,
      source: r.source
    }));

    const allData = [...allAIResults, ...mappedPolice];
    const now = new Date();
    mapDataCache = allData.filter(item => {
      if (!item.published_date) return true;
      const pubDate = new Date(item.published_date);
      return (now - pubDate) / (1000 * 60 * 60 * 24) <= 30;
    });

    console.log(`✅ 同步任務全部結束: 最終保留 ${mapDataCache.length} 則事件`);
  } catch (error) {
    console.error("❌ 同步流程異常:", error.message);
  } finally {
    isSyncing = false;
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get("/api/news", (req, res) => res.json(mapDataCache));
app.post("/api/parse", (req, res) => res.json(mapDataCache));
app.get("/api/rss", async (req, res) => {
  try { res.json(await fetchOneRssFeed(req.query.url)); } catch (e) { res.status(502).json({error: "fail"}); }
});

app.post("/api/report", async (req, res) => {
  const { title, errorType, message } = req.body;
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return res.status(500).json({ error: "缺少 Webhook" });
  try {
    await axios.post(webhookUrl, { content: `📢 **回報**: ${title}\n**類型**: ${errorType}\n**說明**: ${message}` });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: "失敗" }); }
});

app.use((_, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  performBackgroundSync();
  setInterval(performBackgroundSync, 30 * 60 * 1000);
});
