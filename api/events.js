const { normalizeEventsForFrontend } = require("../event-normalizer");
const { getOfficialEvents, getEventCacheStatus } = require("../event-store");
const { applyEventQueryFilters, getEventStatusSummary } = require("../event-query");
const { getEventIntegrationStatuses } = require("../integration-store");
function publicEvent(event = {}) {
  const fields = ["id","submissionId","title","content","summary","category","groupCategory","eventKind","categorySource","secondaryTags","categoryConfidence","categoryReason","sourceCategory","address","venue","city","district","lat","lng","source","sourceName","sourceUrl","url","startsAt","endsAt","expiresAt","status","publishedAt","updatedAt","createdAt","locationPrecision","locationQuality","locationDisplayMode","locationConfidence","publicationNotice"];
  return Object.fromEntries(fields.filter((key) => event[key] !== undefined).map((key) => [key, event[key]]));
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // This route is intentionally shared with the events function to stay within
  // Vercel Hobby's function limit; the rewrite preserves the public endpoint.
  if (String(req.url || "").includes("/api/integrations/events/status") || req.query?.integrationStatus === "1") {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ integrations: await getEventIntegrationStatuses() });
  }

  try {
    const normalizedEvents = normalizeEventsForFrontend(await getOfficialEvents());
    const events = applyEventQueryFilters(normalizedEvents, req.query).map(publicEvent);
    const cacheStatus = await getEventCacheStatus();
    const summary = getEventStatusSummary(normalizedEvents, cacheStatus);
    res.setHeader("X-Event-Count", String(events.length));
    res.setHeader("X-Event-Total", String(summary.total));
    res.setHeader("X-Data-Sources", encodeURIComponent(summary.sources.join(",")));
    res.setHeader("X-Last-Event-Time", summary.newestEventAt);
    res.setHeader("X-Cache-Updated-Time", summary.cacheUpdatedAt);
    res.setHeader("X-Data-Store", summary.hasKv ? "kv+local" : "local");
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");
    return res.status(200).json(events);
  } catch (error) {
    console.error("[events] cache fetch failed:", error.message);
    return res.status(error?.code === "CONFIG" ? 503 : 500).json({ error: "Event service unavailable" });
  }
};
module.exports.publicEvent = publicEvent;
