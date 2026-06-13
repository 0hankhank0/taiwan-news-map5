const { Redis } = require("@upstash/redis");
const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  const { eventId } = req.method === "GET" ? req.query : req.body;

  if (!eventId) {
    return res.status(400).json({ error: "Missing eventId" });
  }

  try {
    const muyuKey = `reaction:${eventId}:muyu`;
    const candleKey = `reaction:${eventId}:candle`;

    if (req.method === "POST") {
      const { type } = req.body;
      if (type !== "muyu" && type !== "candle") {
        return res.status(400).json({ error: "Invalid reaction type" });
      }
      const key = type === "muyu" ? muyuKey : candleKey;
      await kv.incr(key);
    }

    // 不管是 GET 還是 POST 完，都回傳最新的計數
    const [muyu, candle] = await Promise.all([
      kv.get(muyuKey),
      kv.get(candleKey)
    ]);

    return res.status(200).json({
      muyu: parseInt(muyu || 0),
      candle: parseInt(candle || 0)
    });
  } catch (error) {
    console.error("[reaction] API error:", error.message);
    return res.status(500).json({ muyu: 0, candle: 0 });
  }
};
