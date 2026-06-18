const { getReaction, incrementReaction } = require("../reaction-store");

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
    if (req.method === "POST") {
      const { type } = req.body;
      if (type !== "muyu" && type !== "candle") {
        return res.status(400).json({ error: "Invalid reaction type" });
      }
      await incrementReaction(eventId, type);
    }

    return res.status(200).json(await getReaction(eventId));
  } catch (error) {
    console.error("[reaction] API error:", error.message);
    return res.status(200).json({ muyu: 0, candle: 0 });
  }
};
