const { normalizeEventsForFrontend } = require("./event-normalizer");
const { getCachedEvents } = require("./event-store");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const storedEvents = await getCachedEvents();
    const events = normalizeEventsForFrontend(storedEvents);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(events);
  } catch (error) {
    console.error("[events] Redis fetch failed:", error.message);
    return res.status(500).json([]);
  }
};
