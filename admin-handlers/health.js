const { normalizeEventsForFrontend } = require("../event-normalizer");
const { isAuthorized } = require("../admin-auth");
const { getCachedEvents, getEventCacheStatus } = require("../event-store");
const { getReports } = require("../report-store");

function sendJson(res, status, payload) {
  return res.status(status).json(payload);
}

function countBy(items, getter) {
  return items.reduce((acc, item) => {
    const key = String(getter(item) || "unknown").trim() || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function newestTimestamp(events) {
  return events
    .map((event) => Date.parse(event.updatedAt || event.publishedAt || event.createdAt || ""))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0] || 0;
}

function hasEnv(name) {
  return Boolean(String(process.env[name] || "").trim());
}

function roundRatio(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 1000;
}

function isMarkerableEvent(event) {
  return Number.isFinite(Number(event.lat))
    && Number.isFinite(Number(event.lng))
    && event.locationDisplayMode !== "list_only"
    && event.locationPrecision !== "city"
    && event.locationQuality !== "low";
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });

  const auth = isAuthorized(req);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });

  const rawEvents = await getCachedEvents();
  const events = normalizeEventsForFrontend(rawEvents);
  const cache = await getEventCacheStatus();
  const reports = await getReports();
  const pendingReports = reports.filter((report) => ["new", "ai_reviewed"].includes(report.status));
  const newest = newestTimestamp(events);
  const ageMinutes = newest ? Math.round((Date.now() - newest) / 60000) : null;
  const markerableCount = events.filter(isMarkerableEvent).length;
  const listOnlyCount = events.filter((event) => event.locationDisplayMode === "list_only").length;
  const refresh = cache.refreshStatus || {};
  const geocodingAttempts = Number(refresh.geocodingAttempts || 0);
  const geocodingHits = Number(refresh.geocodingHits || 0);

  return sendJson(res, 200, {
    beta: true,
    generatedAt: new Date().toISOString(),
    events: {
      total: events.length,
      rawTotal: Array.isArray(rawEvents) ? rawEvents.length : 0,
      newestEventAt: newest ? new Date(newest).toISOString() : "",
      newestEventAgeMinutes: ageMinutes,
      bySource: countBy(events, (event) => event.sourceName || event.source),
      byCategory: countBy(events, (event) => event.groupCategory || event.category),
      byLocationPrecision: countBy(events, (event) => event.locationPrecision),
      byLocationQuality: countBy(events, (event) => event.locationQuality),
      byLocationDisplayMode: countBy(events, (event) => event.locationDisplayMode),
      byReviewState: countBy(events, (event) => event.reviewState),
      markerable: markerableCount,
      listOnly: listOnlyCount,
      markerableRatio: roundRatio(markerableCount, events.length),
      listOnlyRatio: roundRatio(listOnlyCount, events.length),
    },
    cache: {
      hasKv: Boolean(cache.hasKv),
      eventCount: cache.eventCount,
      lastLocalUpdate: cache.lastLocalUpdate,
      localEntries: cache.localEntries,
    },
    refresh: {
      status: refresh.status || "unknown",
      lastRunId: refresh.runId || "",
      lastMode: refresh.mode || "",
      lastCompletedAt: refresh.completedAt || "",
      lastSuccessAt: refresh.lastSuccessAt || "",
      lastError: refresh.lastError || null,
      durationMs: refresh.durationMs || 0,
      cacheTtlSeconds: refresh.cacheTtlSeconds || 0,
      sourceCounts: refresh.sourceCounts || {},
      geocodingAttempts,
      geocodingHits,
      geocodingHitRate: roundRatio(geocodingHits, geocodingAttempts),
      cronLock: cache.cronLock || { locked: false },
    },
    reports: {
      total: reports.length,
      pending: pendingReports.length,
      byStatus: countBy(reports, (report) => report.status),
    },
    integrations: {
      mapboxPublicToken: hasEnv("MAPBOX_PUBLIC_TOKEN") || hasEnv("MAPBOX_TOKEN"),
      mapboxGeocodingToken: hasEnv("MAPBOX_GEOCODING_TOKEN") || hasEnv("MAPBOX_PUBLIC_TOKEN") || hasEnv("MAPBOX_TOKEN"),
      geoapifyGeocodingToken: hasEnv("GEOAPIFY_API_KEY") || hasEnv("GEOAPIFY_KEY"),
      tdxCredentials: hasEnv("TDX_CLIENT_ID") && hasEnv("TDX_CLIENT_SECRET"),
      openAiKey: hasEnv("OPENAI_API_KEY"),
      azureOpenAi: hasEnv("AZURE_OPENAI_API_KEY") && (hasEnv("AZURE_OPENAI_DEPLOYMENT") || hasEnv("AZURE_OPENAI_DEPLOYMENT_NAME")),
      discordWebhook: hasEnv("DISCORD_WEBHOOK_URL"),
      ecpay: hasEnv("ECPAY_MERCHANT_ID") && hasEnv("ECPAY_HASH_KEY") && hasEnv("ECPAY_HASH_IV"),
    },
  });
};
