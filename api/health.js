const { normalizeEventsForFrontend } = require("./event-normalizer");
const { isAuthorized } = require("./admin-auth");
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
      byReviewState: countBy(events, (event) => event.reviewState),
    },
    cache: {
      hasKv: Boolean(cache.hasKv),
      eventCount: cache.eventCount,
      lastLocalUpdate: cache.lastLocalUpdate,
      localEntries: cache.localEntries,
    },
    reports: {
      total: reports.length,
      pending: pendingReports.length,
      byStatus: countBy(reports, (report) => report.status),
    },
    integrations: {
      mapboxPublicToken: hasEnv("MAPBOX_PUBLIC_TOKEN") || hasEnv("MAPBOX_TOKEN"),
      mapboxGeocodingToken: hasEnv("MAPBOX_GEOCODING_TOKEN") || hasEnv("MAPBOX_PUBLIC_TOKEN") || hasEnv("MAPBOX_TOKEN"),
      tdxCredentials: hasEnv("TDX_CLIENT_ID") && hasEnv("TDX_CLIENT_SECRET"),
      openAiKey: hasEnv("OPENAI_API_KEY"),
      azureOpenAi: hasEnv("AZURE_OPENAI_API_KEY") && (hasEnv("AZURE_OPENAI_DEPLOYMENT") || hasEnv("AZURE_OPENAI_DEPLOYMENT_NAME")),
      discordWebhook: hasEnv("DISCORD_WEBHOOK_URL"),
      ecpay: hasEnv("ECPAY_MERCHANT_ID") && hasEnv("ECPAY_HASH_KEY") && hasEnv("ECPAY_HASH_IV"),
    },
  });
};
