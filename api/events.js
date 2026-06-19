const { normalizeEventsForFrontend } = require("./event-normalizer");
const { getCachedEvents } = require("../event-store");

function normalizeQueryValue(value) {
  return String(Array.isArray(value) ? value[0] : value || "").trim();
}

function applyEventQueryFilters(events, query = {}) {
  const category = normalizeQueryValue(query.category).toLowerCase();
  const status = normalizeQueryValue(query.status).toLowerCase();
  const city = normalizeQueryValue(query.city);
  const source = normalizeQueryValue(query.source).toLowerCase();
  const q = normalizeQueryValue(query.q).toLowerCase();
  const limit = Math.max(0, Math.min(Number(normalizeQueryValue(query.limit)) || 0, 500));

  let filtered = events;
  if (category && category !== "all") {
    filtered = filtered.filter((event) =>
      String(event.category || "").toLowerCase() === category
      || String(event.groupCategory || "").toLowerCase() === category
    );
  }
  if (status && status !== "all") {
    filtered = filtered.filter((event) => String(event.status || "").toLowerCase() === status);
  }
  if (city && city !== "all") {
    filtered = filtered.filter((event) => String(event.city || "").includes(city));
  }
  if (source && source !== "all") {
    filtered = filtered.filter((event) =>
      String(event.source || "").toLowerCase().includes(source)
      || String(event.sourceName || "").toLowerCase().includes(source)
    );
  }
  if (q) {
    filtered = filtered.filter((event) =>
      [event.title, event.content, event.summary, event.address, event.venue, event.city, event.district]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }
  return limit > 0 ? filtered.slice(0, limit) : filtered;
}

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
    const events = applyEventQueryFilters(normalizeEventsForFrontend(storedEvents), req.query);
    res.setHeader("X-Event-Count", String(events.length));
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(events);
  } catch (error) {
    console.error("[events] cache fetch failed:", error.message);
    return res.status(500).json([]);
  }
};
