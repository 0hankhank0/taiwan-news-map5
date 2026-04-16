const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { OpenAI } = require("openai");

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * 警廣資料抓取：嘗試「公開連結」與「TDX 備案」雙保險
 */
async function fetchTrafficData() {
  // --- 嘗試 1: 警廣公開 JSON (內政部) ---
  try {
    console.log('📡 正在抓取警廣公開路況 (新加坡節點)...');
    const pbsUrl = "https://od.moi.gov.tw/api/v1/rest/datastore/A01010000C-000628-063";
    const res = await axios.get(pbsUrl, { 
      timeout: 25000, // 拉長到 25 秒，這在 Vercel 是極限了
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
      }
    });
    const records = res.data?.result?.records || [];
    if (records.length > 0) {
      console.log(`✅ 警廣公開資料抓取成功: ${records.length} 筆`);
      return records.map(item => ({
        title: `【警廣】${item.roadtype || '路況'} - ${item.area_nm || ''}`,
        content: item.srcdetail || "無詳細說明",
        category: "traffic",
        lat: parseFloat(item.Y),
        lng: parseFloat(item.X),
        city: (item.area_nm || "全國").substring(0, 3),
        source: "警廣路況",
        url: ""
      })).filter(r => r.lat && r.lng);
    }
  } catch (err) {
    console.warn('⚠️ 警廣公開連結 Timeout 或失敗，嘗試 TDX 備案...');
  }

  // --- 嘗試 2: TDX 備案 (如果環境變數有設定，這招最穩) ---
  if (process.env.TDX_CLIENT_ID && process.env.TDX_CLIENT_SECRET) {
    try {
      const auth = await axios.post("https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token", 
        new URLSearchParams({
          grant_type: "client_credentials",
          client_id: process.env.TDX_CLIENT_ID,
          client_secret: process.env.TDX_CLIENT_SECRET
        }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      const token = auth.data.access_token;
      const tdxRes = await axios.get("https://tdx.transportdata.tw/api/advanced/v3/Road/Traffic/Event/Freeway?$format=JSON", {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000
      });
      console.log('✅ TDX 備案抓取成功');
      return (tdxRes.data?.Events || []).map(e => ({
        title: `【國道】${e.RoadName || '即時路況'}`,
        content: e.Description || e.Comment,
        lat: parseFloat(e.LocationPt?.PositionLat),
        lng: parseFloat(e.LocationPt?.PositionLon),
        category: "traffic",
        source: "TDX",
        url: ""
      }));
    } catch (e) {
      console.error('❌ 所有交通資料來源均失效');
    }
  }

  return [];
}

app.use(cors());
app.use(express.json());

app.get("/api/events", async (req, res) => {
  // 設定較長的超時處理，避免 Vercel 504
  try {
    const trafficItems = await fetchTrafficData();
    
    // 如果想要新聞，也可以在此加入 RSS 邏輯
    // ...

    console.log(`🚀 最終準備回傳筆數: ${trafficItems.length}`);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=30");
    res.status(200).json(trafficItems);
  } catch (error) {
    console.error('❌ API 嚴重錯誤:', error.message);
    res.status(200).json([]);
  }
});

module.exports = app;
