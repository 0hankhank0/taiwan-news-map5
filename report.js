const axios = require("axios");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { title, errorType, message } = req.body || {};

    if (!title || !errorType || !message) {
      return res.status(400).json({ error: "\u7f3a\u5c11\u5fc5\u8981\u6b04\u4f4d" });
    }

    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      console.error("[report] Missing DISCORD_WEBHOOK_URL");
      return res.status(500).json({ error: "Webhook \u672a\u8a2d\u5b9a" });
    }

    const payload = {
      embeds: [
        {
          title: "\u4e8b\u4ef6\u8cc7\u6599\u56de\u5831",
          color: 15158332,
          fields: [
            { name: "\u4e8b\u4ef6\u6a19\u984c", value: String(title), inline: false },
            { name: "\u56de\u5831\u985e\u578b", value: String(errorType), inline: true },
            { name: "\u88dc\u5145\u8aaa\u660e", value: String(message), inline: false }
          ],
          timestamp: new Date().toISOString(),
          footer: { text: "\u53f0\u7063\u65b0\u805e\u4e8b\u4ef6\u5730\u5716 \u56de\u5831\u7cfb\u7d71" }
        }
      ]
    };

    await axios.post(webhookUrl, payload, {
      headers: { "Content-Type": "application/json" }
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("[report] Discord webhook failed:", error.message);
    return res.status(500).json({ error: "\u56de\u5831\u9001\u51fa\u5931\u6557" });
  }
};
