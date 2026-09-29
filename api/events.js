const { normalizeEventsForFrontend } = require("../event-normalizer");
const { getOfficialEvents, getEventCacheStatus } = require("../event-store");
const { applyEventQueryFilters, getEventStatusSummary } = require("../event-query");
const { getEventIntegrationStatuses } = require("../integration-store");
const { getRequestQuery } = require("../request-query");
function publicEvent(event = {}) {
  const fields = ["id","submissionId","title","content","summary","category","groupCategory","eventKind","categorySource","secondaryTags","categoryConfidence","categoryReason","sourceCategory","address","venue","city","district","lat","lng","source","sourceName","sourceUrl","url","occurredAt","startsAt","endsAt","expiresAt","status","publishedAt","updatedAt","createdAt","fetchedAt","locationPrecision","locationQuality","locationDisplayMode","locationConfidence","publicationNotice"];
  return Object.fromEntries(fields.filter((key) => event[key] !== undefined).map((key) => [key, event[key]]));
}
function apiFilterDiagnostics(events = [], query = {}, returned = []) {
  const count = Array.isArray(events) ? events.length : 0;
  const normalize = (value) => String(Array.isArray(value) ? value[0] : value || "").trim().toLowerCase();
  const category = normalize(query.category), status = normalize(query.status);
  const categoryRows = category && category !== "all" ? events.filter((event) => String(event.category || "").toLowerCase() === category || String(event.groupCategory || "").toLowerCase() === category) : events;
  const statusRows = status && status !== "all" ? categoryRows.filter((event) => String(event.status || "").toLowerCase() === status) : categoryRows;
  const afterQuery = applyEventQueryFilters(events, query).length;
  return {
    databaseRowsFetched: count,
    rowsAfterStatusFilter: statusRows.length, rowsAfterCategoryFilter: categoryRows.length, rowsReturned: returned.length,
    filters: [{ filterName: "normalization", before: count, rejected: 0, after: count, note: "normalization is recorded separately" },
      { filterName: "query", before: count, rejected: Math.max(0, count - afterQuery), after: afterQuery },
      { filterName: "category", before: count, rejected: count - categoryRows.length, after: categoryRows.length },
      { filterName: "status", before: categoryRows.length, rejected: categoryRows.length - statusRows.length, after: statusRows.length }],
  };
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
  const query = getRequestQuery(req);
  if (String(req.url || "").includes("/api/integrations/events/status") || query.integrationStatus === "1") {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ integrations: await getEventIntegrationStatuses() });
  }

  try {
    const storedEvents = await getOfficialEvents();
    const normalizedEvents = normalizeEventsForFrontend(storedEvents);
    const events = applyEventQueryFilters(normalizedEvents, query).map(publicEvent);
    console.info("[events] diagnostics", apiFilterDiagnostics(normalizedEvents, query, events));
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
module.exports.apiFilterDiagnostics = apiFilterDiagnostics;
