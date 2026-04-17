const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

app.post("/api/report", async (req, res) => {
  try {
    const { title, errorType, message } = req.body;

    if (!title || !errorType) {
      return res.status(400).json({ error: "缺少必要參數" });
    }

    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

    if (!webhookUrl) {
      console.error("❌ 缺少 DISCORD_WEBHOOK_URL 環境變數");
      return res.status(500).json({ error: "伺服器未設定 Webhook" });
    }

    const discordPayload = {
      content: null,
      embeds: [
        {
          title: "📢 收到新的錯誤回報",
          color: 15158332,
          fields: [
            {
              name: "📰 新聞標題",
              value: title || "無",
              inline: false,
            },
            {
              name: "🏷️ 錯誤類型",
              value: errorType || "未分類",
              inline: true,
            },
            {
              name: "💬 補充說明",
              value: message || "無",
              inline: false,
            },
          ],
          timestamp: new Date().toISOString(),
          footer: {
            text: "台灣新聞地圖｜錯誤回報系統",
          },
        },
      ],
    };

    await axios.post(webhookUrl, discordPayload, {
      headers: { "Content-Type": "application/json" },
    });

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Discord Webhook 發送失敗:", error.message);
    res.status(500).json({ error: "回報發送失敗" });
  }
});

module.exports = app;
