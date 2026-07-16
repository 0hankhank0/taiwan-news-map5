const assert = require("assert");
const os = require("os");
const path = require("path");

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `taiwan-news-refresh-test-${Date.now()}.sqlite`);
process.env.DISABLE_LOCAL_EVENT_CACHE = "0";
process.env.CRON_SECRET = "cron-test-secret";

const eventRefresh = require("../event-refresh");
const eventNormalizer = require("../event-normalizer");
const {
  CRON_LOCK_KEY,
  DEFAULT_CRON_LOCK_TTL_SECONDS,
  EVENT_BUCKET_KEY_MAP,
  EVENT_REFRESH_STATUS_KEY,
  acquireCronLock,
  clearEventCaches,
  deleteCachedValue,
  getCachedEvents,
  getCachedValue,
  getRefreshStatus,
  releaseCronLock,
} = require("../event-store");
const { applyEventQueryFilters } = require("../event-query");
const { getEventIntegrationStatuses } = require("../integration-store");
const eventsApi = require("../api/events");

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { return this; },
  };
}

async function call(handler, req) {
  const res = createRes();
  await handler({
    method: "GET",
    headers: {},
    query: {},
    body: {},
    ...req,
  }, res);
  return res;
}

(async () => {
  await clearEventCaches();
  await deleteCachedValue(EVENT_REFRESH_STATUS_KEY);
  await deleteCachedValue(CRON_LOCK_KEY);

  assert.equal(DEFAULT_CRON_LOCK_TTL_SECONDS, 120);
  assert.equal(eventRefresh.DEFAULT_EVENT_CACHE_TTL_SECONDS, 60 * 60 * 6);
  assert.equal(eventRefresh.resolveEventCacheTtlSeconds(), 60 * 60 * 6);
  assert.equal(eventRefresh.resolveEventCacheTtlSeconds("120"), 60 * 60);
  assert.equal(eventRefresh.resolveEventCacheTtlSeconds("7200"), 7200);
  assert.equal(eventRefresh.isGenericCmsNotice("天候不佳小心駕駛"), true);
  assert.equal(eventRefresh.isGenericCmsNotice("中山高北上事故封閉，請改道"), false);

  const genericCmsNotice = {
    id: "cms_notice_1",
    title: "New Taipei CMS - CMS",
    content: "天候不佳小心駕駛",
    category: "traffic",
    city: "Taipei",
    lat: 25.0478,
    lng: 121.517,
    source: "TDX CMS",
  };
  const directCmsEvent = {
    ...genericCmsNotice,
    id: "cms_event_1",
    title: "國道一號 - CMS",
    content: "北上事故封閉，車流回堵",
  };
  assert.equal(eventNormalizer.isGenericCmsNoticeEvent(genericCmsNotice), true);
  assert.equal(eventNormalizer.isGenericCmsNoticeEvent(directCmsEvent), false);
  assert.deepEqual(eventNormalizer.normalizeEventsForFrontend([genericCmsNotice, directCmsEvent]).map((event) => event.id), ["cms_event_1"]);
  assert.deepEqual(eventRefresh.normalizeFinalEvents([genericCmsNotice, directCmsEvent]).map((event) => event.id), ["cms_event_1"]);

  const kktixMeta = eventRefresh.parseKktixMeta({
    content: [
      "時間：2026/07/20 19:00 ~ 2026/07/20 21:00",
      "地點：Legacy Taipei / 台北市中正區八德路一段1號",
    ].join("\n"),
  });
  assert.equal(kktixMeta.timeLine, "2026/07/20 19:00 ~ 2026/07/20 21:00");
  assert.ok(kktixMeta.startAt);
  assert.ok(kktixMeta.endAt);
  assert.equal(kktixMeta.venue, "Legacy Taipei");
  assert.equal(kktixMeta.address, "台北市中正區八德路一段1號");

  const now = Date.now();
  const officialTraffic = {
    id: "tdx_official_1",
    title: "TDX official traffic event",
    content: "Road event near Taipei Main Station",
    category: "traffic",
    city: "Taipei",
    lat: 25.0478,
    lng: 121.517,
    source: "TDX CMS",
    locationPrecision: "exact",
    locationSource: "official",
    locationConfidence: 1,
    locationQuality: "high",
    locationDisplayMode: "point",
    createdAt: now,
    expiresAt: now + 60 * 60 * 1000,
  };
  const duplicateTraffic = { ...officialTraffic, id: "tdx_official_duplicate" };
  const activity = {
    id: "activity_1",
    title: "Taipei park weekend activity",
    content: "Activity at Daan Park",
    category: "activity",
    city: "Taipei",
    address: "Taipei Daan Park",
    lat: 25.0329,
    lng: 121.5355,
    source: "KKTIX",
    locationPrecision: "exact",
    locationSource: "nominatim",
    locationConfidence: 0.82,
    locationQuality: "high",
    locationDisplayMode: "point",
    createdAt: now,
    expiresAt: now + 60 * 60 * 1000,
  };

  const refreshResult = await eventRefresh.runEventRefresh({
    runId: "test-refresh",
    startedAt: now - 10,
    now,
    sourceData: {
      tdxEvents: [officialTraffic, duplicateTraffic],
      activityEvents: [activity],
    },
    existingEvents: [],
    skipExternalGeocoding: true,
    cacheTtlSeconds: 60,
  });

  assert.equal(refreshResult.success, true);
  assert.equal(refreshResult.count, 2);
  assert.equal(refreshResult.cacheTtlSeconds, 60 * 60);
  assert.equal(refreshResult.buckets.traffic, 1);
  assert.equal(refreshResult.buckets.activities, 1);
  assert.equal(refreshResult.sourceCounts.tdx, 2);
  assert.equal(refreshResult.geocodingHits, 0);

  const storedEvents = await getCachedEvents();
  assert.equal(storedEvents.length, 2);
  const storedTraffic = storedEvents.find((event) => event.id === officialTraffic.id);
  assert.equal(storedTraffic.locationSource, "official");
  assert.equal(storedTraffic.locationDisplayMode, "point");
  assert.equal(storedTraffic.locationConfidence, 1);

  const trafficBucket = await getCachedValue(EVENT_BUCKET_KEY_MAP.traffic);
  const activityBucket = await getCachedValue(EVENT_BUCKET_KEY_MAP.activities);
  const newsBucket = await getCachedValue(EVENT_BUCKET_KEY_MAP.news);
  assert.equal(trafficBucket.length, 1);
  assert.equal(activityBucket.length, 1);
  assert.equal(newsBucket.length, 0);

  const status = await getRefreshStatus();
  assert.equal(status.status, "success");
  assert.equal(status.lastSuccessRunId, "test-refresh");
  assert.ok(status.lastSuccessAt);

  const sampleEvents = [
    { title: "Road closure", content: "A road closure", category: "traffic", status: "active", city: "Taipei", sourceName: "TDX" },
    { title: "Concert", content: "Music event", category: "activity", status: "upcoming", city: "Kaohsiung", sourceName: "KKTIX" },
  ];
  assert.equal(applyEventQueryFilters(sampleEvents, { category: "traffic" }).length, 1);
  assert.equal(applyEventQueryFilters(sampleEvents, { status: "upcoming" })[0].title, "Concert");
  assert.equal(applyEventQueryFilters(sampleEvents, { city: "Taipei" })[0].title, "Road closure");
  assert.equal(applyEventQueryFilters(sampleEvents, { source: "kktix" })[0].title, "Concert");
  assert.equal(applyEventQueryFilters(sampleEvents, { q: "music" })[0].title, "Concert");
  assert.equal(applyEventQueryFilters(sampleEvents, { limit: "1" }).length, 1);

  // KKTIX success records a bounded integration status; failures retry three times and never clear cached events.
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>KKTIX test activity</title><link href="https://kktix.com/events/test"/><content type="html"><![CDATA[Time: 2099/07/20 19:00 ~ 2099/07/20 21:00\nLocation: Test venue / Taipei]]></content></entry></feed>` });
  await eventRefresh.fetchKktixActivityEvents(Date.now());
  assert.equal((await getEventIntegrationStatuses()).find((item) => item.service === "kktix").status, "success");
  const cachedCountBeforeFailure = (await getCachedEvents()).length;
  let attempts = 0;
  global.fetch = async () => { attempts += 1; return { ok: false, status: 500, text: async () => "upstream failure" }; };
  assert.deepEqual(await eventRefresh.fetchKktixActivityEvents(Date.now()), []);
  assert.equal(attempts, 3);
  assert.equal((await getCachedEvents()).length, cachedCountBeforeFailure);
  const integrationStatus = await call(eventsApi, { method: "GET", query: { integrationStatus: "1" }, url: "/api/integrations/events/status" });
  assert.equal(integrationStatus.statusCode, 200);
  assert.equal(JSON.stringify(integrationStatus.payload).includes("upstream failure"), false);
  assert.equal(JSON.stringify(integrationStatus.payload).includes("token"), false);
  global.fetch = originalFetch;

  const originalRunEventRefresh = eventRefresh.runEventRefresh;
  eventRefresh.runEventRefresh = async (options) => ({
    success: true,
    runId: options.runId,
    mode: options.mode,
    durationMs: 3,
    count: 0,
    buckets: { traffic: 0, news: 0, activities: 0 },
    sourceCounts: { tdx: 0 },
    geocodingHits: 0,
    geocodingAttempts: 0,
    events: [],
  });
  delete require.cache[require.resolve("../api/cron")];
  const cron = require("../api/cron");

  const denied = await call(cron, { method: "POST" });
  assert.equal(denied.statusCode, 401);

  await deleteCachedValue(CRON_LOCK_KEY);
  const ok = await call(cron, {
    method: "POST",
    headers: { authorization: "Bearer cron-test-secret" },
    query: { mode: "traffic" },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.payload.skippedByLock, false);
  assert.equal(ok.payload.mode, "traffic");
  assert.equal(ok.payload.events, undefined);
  assert.equal(ok.payload.geocodingHits, 0);

  await acquireCronLock({ owner: "other-run", ttlSeconds: 60 });
  const skipped = await call(cron, {
    method: "POST",
    headers: { authorization: "Bearer cron-test-secret" },
  });
  assert.equal(skipped.statusCode, 200);
  assert.equal(skipped.payload.skippedByLock, true);
  await releaseCronLock("other-run");
  eventRefresh.runEventRefresh = originalRunEventRefresh;

  console.log("event refresh tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
