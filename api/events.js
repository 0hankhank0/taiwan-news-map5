const { normalizeEventsForFrontend } = require("../event-normalizer");
const { getCachedEvents, getEventCacheStatus } = require("../event-store");
const { applyEventQueryFilters, getEventStatusSummary } = require("../event-query");
const { getEventIntegrationStatuses } = require("../integration-store");
const { getPublicMapSubmissionEvents } = require("../submission-store");

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
    const [storedEvents, publicSubmissions] = await Promise.all([getCachedEvents(), getPublicMapSubmissionEvents()]);
    const normalizedEvents = normalizeEventsForFrontend(storedEvents);
    const seenSubmissionIds = new Set();
    const combinedEvents = [...normalizedEvents, ...publicSubmissions].filter((event) => {
      if (event?.source !== "user_submission") return true;
      if (!event.submissionId || seenSubmissionIds.has(event.submissionId)) return false;
      seenSubmissionIds.add(event.submissionId);
      return true;
    });
    const events = applyEventQueryFilters(combinedEvents, req.query);
    const cacheStatus = await getEventCacheStatus();
    const summary = getEventStatusSummary(combinedEvents, cacheStatus);
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
    return res.status(500).json([]);
  }
};
