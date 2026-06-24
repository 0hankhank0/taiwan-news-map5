const { getReaction, getReactions, incrementReaction } = require("../reaction-store");

const MAX_BATCH_REACTIONS = 100;

function normalizeEventIds(value) {
  const raw = Array.isArray(value) ? value.join(",") : String(value || "");
  return Array.from(new Set(
    raw
      .split(",")
      .map((eventId) => eventId.trim())
      .filter(Boolean)
  )).slice(0, MAX_BATCH_REACTIONS);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (req.method === "GET") {
    const eventIds = normalizeEventIds(req.query?.eventIds);
    if (eventIds.length > 0) {
      try {
        return res.status(200).json({ reactions: await getReactions(eventIds) });
      } catch (error) {
        console.error("[reaction] batch API error:", error.message);
        return res.status(200).json({ reactions: {} });
      }
    }
  }

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
