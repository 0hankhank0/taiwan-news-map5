const assert = require("assert");
const os = require("os");
const path = require("path");

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `taiwan-news-refresh-test-${Date.now()}.sqlite`);
process.env.DISABLE_LOCAL_EVENT_CACHE = "0";
process.env.EVENT_STORE_MODE = "local";
process.env.CRON_SECRET = "cron-test-secret";

const eventRefresh = require("../event-refresh");

function makeStoredZipJson(payload) {
  const name = Buffer.from("events.json");
  const body = Buffer.from(JSON.stringify(payload));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
  const centralOffset = local.length + name.length + body.length;
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, body, central, name, end]);
}
const eventNormalizer = require("../event-normalizer");
const {
  CRON_LOCK_KEY,
  DEFAULT_CRON_LOCK_TTL_SECONDS,
  EVENT_BUCKET_KEY_MAP,
  EVENT_REFRESH_STATUS_KEY,
  EVENT_REFRESH_LOG_KEY,
  EVENT_REFRESH_RUN_INDEX_KEY,
  acquireCronLock,
  clearEventCaches,
  deleteCachedValue,
  getCachedEvents,
  getCachedValue,
  getCronLockStatus,
  getRefreshStatus,
  getRefreshLog,
  getRefreshRunDetail,
  releaseCronLock,
  saveRefreshRunDetail,
  setCachedValue,
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
  await deleteCachedValue(EVENT_REFRESH_LOG_KEY);
  await deleteCachedValue(EVENT_REFRESH_RUN_INDEX_KEY);
  await deleteCachedValue(CRON_LOCK_KEY);

  assert.equal(DEFAULT_CRON_LOCK_TTL_SECONDS, 120);
  const firstLock = await acquireCronLock({ owner: "lock-owner", ttlSeconds: 60 });
  assert.equal(firstLock.acquired, true);
  assert.equal(firstLock.lock.locked, true);
  assert.equal(firstLock.lock.ownerRunId, "lock-owner");
  assert.ok(firstLock.lock.acquiredAt);
  assert.ok(firstLock.lock.expiresAt);
  const duplicateLock = await acquireCronLock({ owner: "duplicate-owner", ttlSeconds: 60 });
  assert.equal(duplicateLock.acquired, false);
  assert.equal(duplicateLock.lock.locked, true);
  assert.equal(duplicateLock.lock.ownerRunId, "lock-owner");
  assert.equal(await releaseCronLock("duplicate-owner"), false);
  assert.equal((await getCronLockStatus()).locked, true);
  assert.equal(await releaseCronLock("lock-owner"), true);
  assert.deepEqual(await getCronLockStatus(), { locked: false });

  await setCachedValue(CRON_LOCK_KEY, {
    ownerRunId: "expired-owner",
    acquiredAt: new Date(Date.now() - 120000).toISOString(),
    expiresAt: new Date(Date.now() - 60000).toISOString(),
  });
  assert.deepEqual(await getCronLockStatus(), { locked: false });
  const lockAfterExpiry = await acquireCronLock({ owner: "after-expiry", ttlSeconds: 60 });
  assert.equal(lockAfterExpiry.acquired, true);
  await releaseCronLock("after-expiry");
  assert.equal(eventRefresh.DEFAULT_EVENT_CACHE_TTL_SECONDS, 60 * 60 * 6);
  assert.equal(eventRefresh.resolveEventCacheTtlSeconds(), 60 * 60 * 6);
  assert.equal(eventRefresh.resolveEventCacheTtlSeconds("120"), 60 * 60);
  assert.equal(eventRefresh.resolveEventCacheTtlSeconds("7200"), 7200);

  const azureEnvNames = ["AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_VERSION", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_DEPLOYMENT", "OPENAI_API_KEY"];
  const originalAzureEnv = Object.fromEntries(azureEnvNames.map((name) => [name, process.env[name]]));
  const restoreAzureEnv = () => {
    for (const name of azureEnvNames) {
      if (originalAzureEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalAzureEnv[name];
    }
  };
  const originalAiFetch = global.fetch;
  process.env.AZURE_OPENAI_ENDPOINT = "https://example-resource.openai.azure.com///";
  process.env.AZURE_OPENAI_API_VERSION = "2024-02-15-preview";
  process.env.AZURE_OPENAI_API_KEY = "azure-test-key";
  process.env.AZURE_OPENAI_DEPLOYMENT = "gpt 4o/test";
  process.env.OPENAI_API_KEY = "ordinary-openai-test-key";
  let azureRequest;
  global.fetch = async (url, options) => {
    azureRequest = { url, options };
    return { ok: true, status: 200, json: async () => ({ choices: [] }) };
  };
  await eventRefresh.createAzureOpenAiChatCompletion({ messages: [] });
  assert.equal(azureRequest.url, "https://example-resource.openai.azure.com/openai/deployments/gpt%204o%2Ftest/chat/completions?api-version=2024-02-15-preview");
  assert.equal(azureRequest.options.headers["api-key"], "azure-test-key");
  assert.equal(azureRequest.options.headers["Content-Type"], "application/json");
  assert.equal(Object.hasOwn(azureRequest.options.headers, "Authorization"), false);
  assert.equal(azureRequest.url.includes("api.openai.com"), false);

  for (const missingName of azureEnvNames.slice(0, 4)) {
    const saved = process.env[missingName];
    delete process.env[missingName];
    let fetchCount = 0;
    global.fetch = async () => { fetchCount += 1; throw new Error("fetch should not run"); };
    await assert.rejects(
      () => eventRefresh.createAzureOpenAiChatCompletion({ messages: [] }),
      (error) => error.message === `Azure OpenAI configuration incomplete: missing ${missingName}`
    );
    assert.equal(fetchCount, 0);
    process.env[missingName] = saved;
  }

  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "azure-test-key must not leak" } }) });
  await assert.rejects(
    () => eventRefresh.createAzureOpenAiChatCompletion({ messages: [] }),
    (error) => error.message === "Azure OpenAI authentication failed (HTTP 401)"
  );
  try {
    await eventRefresh.createAzureOpenAiChatCompletion({ messages: [] });
  } catch (error) {
    assert.equal(error.message.includes("azure-test-key"), false);
  }
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "azure-test-key must not leak" } }) });
  await assert.rejects(
    () => eventRefresh.createAzureOpenAiChatCompletion({ messages: [] }),
    (error) => error.message === "Azure OpenAI rate limit or quota exceeded (HTTP 429)"
  );
  global.fetch = originalAiFetch;
  restoreAzureEnv();
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
  const initialRefreshLog = await getRefreshLog();
  assert.equal(initialRefreshLog.length, 1);
  assert.equal(initialRefreshLog[0].status, "success");
  assert.equal(initialRefreshLog[0].runId, "test-refresh");
  const firstRunDetail = await getRefreshRunDetail("test-refresh");
  assert.equal(firstRunDetail.runId, "test-refresh");
  assert.equal(firstRunDetail.sources.tdxTraffic.items.length, 2);
  assert.ok(firstRunDetail.finalEvents.some((item) => item.processingResult === "accepted"));

  const partialResult = await eventRefresh.runEventRefresh({
    runId: "partial-refresh", startedAt: now + 1, now: now + 1,
    sourceData: { tdxEvents: [officialTraffic], activityEvents: [activity] }, existingEvents: [], skipExternalGeocoding: true,
    sourceFailures: { tdxTraffic: "Authorization: Bearer hidden-value HTTP 500" },
  });
  assert.equal(partialResult.status, "partial_success");
  assert.equal((await getRefreshLog())[0].runId, "partial-refresh");
  const partialDetail = await getRefreshRunDetail("partial-refresh");
  assert.equal(partialDetail.sources.tdxTraffic.status, "failed");
  assert.equal(JSON.stringify(partialDetail).includes("hidden-value"), false);

  await assert.rejects(() => eventRefresh.runEventRefresh({
    runId: "error-refresh",
    startedAt: Date.now() - 5,
    fetchSources: async () => { throw new Error("Authorization: Bearer secret-value https://example.test/path?token=bad"); },
  }));
  const errorRefreshLog = await getRefreshLog();
  assert.equal(errorRefreshLog[0].status, "error");
  assert.equal(JSON.stringify(errorRefreshLog[0]).includes("secret-value"), false);
  assert.equal(JSON.stringify(errorRefreshLog[0]).includes("token=bad"), false);
  const errorDetail = await getRefreshRunDetail("error-refresh");
  assert.equal(errorDetail.status, "error");
  assert.equal(JSON.stringify(errorDetail).includes("secret-value"), false);

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

  // iCulture creates one map event per valid future showInfo session and uses its official coordinates.
  const originalFetch = global.fetch;
  // Mapbox sends only location-focused, bounded queries and safely records 422 diagnostics.
  const verboseMapboxEvent = { title: "這是一段很長的新聞標題，內容描述事件經過但不應完整送往地理編碼服務", content: Array.from({ length: 30 }, (_, index) => `token${index}`).join(" "), address: "臺北市中正區忠孝西路一段 1 號", city: "Taipei" };
  const boundedQuery = eventRefresh.buildMapboxQuery(verboseMapboxEvent, { city: "Taipei" });
  assert(boundedQuery.length <= 80);
  assert(boundedQuery.split(/\s+/).length <= 15);
  assert.equal(boundedQuery.includes("token29"), false);
  assert.equal(eventRefresh.getMapboxProximity({ city: "Taipei", lat: 0, lng: 121.5 }), "");
  assert.equal(eventRefresh.getCityBboxParam("not-a-taiwan-city"), "");
  const originalMapboxToken = process.env.MAPBOX_TOKEN;
  process.env.MAPBOX_TOKEN = "mapbox-test-token-secret";
  const mapboxRequests = [];
  const mapboxWarnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => mapboxWarnings.push(args);
  global.fetch = async (url) => {
    mapboxRequests.push(String(url));
    if (mapboxRequests.length === 1) return { ok: false, status: 422, text: async () => JSON.stringify({ message: "Invalid bbox parameter" }) };
    return { ok: true, status: 200, json: async () => ({ features: [] }) };
  };
  await eventRefresh.geocodeLocationWithMapbox(verboseMapboxEvent, { city: "Taipei", lat: 0, lng: 121.5 }, Date.now());
  console.warn = originalWarn;
  if (originalMapboxToken === undefined) delete process.env.MAPBOX_TOKEN; else process.env.MAPBOX_TOKEN = originalMapboxToken;
  assert.equal(mapboxRequests.length, 2);
  assert.equal(mapboxRequests[0].includes("proximity="), false);
  assert.equal(mapboxRequests[1].includes("bbox="), false);
  assert.equal(mapboxRequests.some((url) => url.includes("token29")), false);
  assert.equal(JSON.stringify(mapboxWarnings).includes("Invalid bbox parameter"), true);
  assert.equal(JSON.stringify(mapboxWarnings).includes("mapbox-test-token-secret"), false);
  const cultureStart = new Date(Date.now() + 60 * 60 * 1000);
  const cultureEnd = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const twDate = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date).replace(", ", " ").replaceAll("-", "/");
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ([
    { UID: "culture-1", title: "iCulture test activity", showInfo: [
      { time: twDate(cultureStart), endTime: twDate(cultureEnd), location: "\u81fa\u5317\u5e02\u4e2d\u6b63\u5340\u6e2c\u8a66\u8def 1 \u865f", locationName: "\u6587\u5316\u5834\u9928", latitude: "25.0478", longitude: "121.5170" },
      { time: twDate(cultureStart), endTime: twDate(cultureEnd), location: "\u81fa\u5317\u5e02\u4e2d\u6b63\u5340\u6e2c\u8a66\u8def 1 \u865f", locationName: "\u6587\u5316\u5834\u9928", latitude: "25.0478", longitude: "121.5170" },
      { time: twDate(cultureStart), endTime: twDate(cultureEnd), location: "\u672a\u77e5\u5730\u5740", latitude: "25.0478", longitude: "121.5170" },
      { time: twDate(cultureStart), endTime: twDate(cultureEnd), location: "\u81fa\u5317\u5e02\u4e2d\u6b63\u5340\u6e2c\u8a66\u8def 2 \u865f", latitude: "0", longitude: "0" },
    ] },
  ]) });
  const cultureEvents = await eventRefresh.fetchCultureActivityEvents(Date.now());
  assert.equal(cultureEvents.length, 1);
  assert.equal(cultureEvents[0].source, "iCulture");
  assert.equal(cultureEvents[0].sourceName, "iCulture");
  assert.equal(cultureEvents[0].address, "\u81fa\u5317\u5e02\u4e2d\u6b63\u5340\u6e2c\u8a66\u8def 1 \u865f");
  assert.equal(cultureEvents[0].venue, "\u6587\u5316\u5834\u9928");
  assert.equal(cultureEvents[0].lat, 25.0478);
  assert.equal(cultureEvents[0].lng, 121.517);
  assert.equal((await getEventIntegrationStatuses()).find((item) => item.service === "iculture").status, "success");

  // Tourism Events normalizes the official ZIP payload, rejects bad/end records, and de-duplicates EventID.
  const tourismFuture = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const tourismPast = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const tourismRecord = { EventID: "tourism-1", EventName: "Tourism test activity", Description: "Official activity", PositionLat: "25.0478", PositionLon: "121.517", PostalAddress: "臺北市中正區測試路 1 號", LocatedCities: ["臺北市"], WebsiteURL: "https://example.test/tourism", Images: [{ Src: "https://example.test/image.jpg" }], StartDateTime: tourismFuture, EndDateTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), EventStatus: "Open", UpdateTime: tourismFuture };
  assert.equal(eventRefresh.normalizeTourismEvent({ ...tourismRecord, PositionLat: "0" }), null);
  assert.equal(eventRefresh.normalizeTourismEvent({ ...tourismRecord, EndDateTime: tourismPast }), null);
  const tourismZip = makeStoredZipJson([tourismRecord, tourismRecord]);
  global.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => tourismZip.buffer.slice(tourismZip.byteOffset, tourismZip.byteOffset + tourismZip.byteLength) });
  const tourismEvents = await eventRefresh.fetchTourismEvents(Date.now());
  assert.equal(tourismEvents.length, 1);
  assert.equal(tourismEvents[0].source, "Tourism Events");
  assert.equal(tourismEvents[0].tourismEvent.EventID, "tourism-1");
  assert.equal((await getEventIntegrationStatuses()).find((item) => item.service === "tourismEvents").status, "success");
  global.fetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(() => eventRefresh.fetchTourismEvents(Date.now()), /Tourism Events HTTP 503/);
  assert.equal((await getEventIntegrationStatuses()).find((item) => item.service === "tourismEvents").status, "error");

  // KKTIX only retries transient upstream statuses and records bounded, redacted diagnostics.
  global.fetch = async () => ({ ok: true, text: async () => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>KKTIX test activity</title><link href="https://kktix.com/events/test"/><content type="html"><![CDATA[Time: 2099/07/20 19:00 ~ 2099/07/20 21:00\nLocation: Test venue / Taipei]]></content></entry></feed>` });
  await eventRefresh.fetchKktixActivityEvents(Date.now());
  assert.equal((await getEventIntegrationStatuses()).find((item) => item.service === "kktix").status, "success");
  const cachedCountBeforeFailure = (await getCachedEvents()).length;
  let attempts = 0;
  global.fetch = async () => { attempts += 1; return { ok: false, status: 503, url: "https://kktix.com/events.atom", headers: new Headers({ "content-type": "text/html", server: "test" }), text: async () => "upstream failure" }; };
  await assert.rejects(() => eventRefresh.fetchKktixActivityEvents(Date.now()));
  assert.equal(attempts, 3);
  assert.equal((await getCachedEvents()).length, cachedCountBeforeFailure);

  attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    return {
      ok: false,
      status: 403,
      url: "https://kktix.com/events.atom",
      headers: new Headers({ "content-type": "text/html; charset=utf-8", server: "cloudflare", "retry-after": "120", "cf-ray": "test-ray" }),
      text: async () => "<html>Cloudflare Access Denied token=secret-value Cookie=session-secret contact=test@example.com Authorization: Bearer hidden-value</html>",
    };
  };
  await assert.rejects(() => eventRefresh.fetchKktixActivityEvents(Date.now()), /KKTIX HTTP 403/);
  assert.equal(attempts, 1);
  const blockedStatus = (await getEventIntegrationStatuses()).find((item) => item.service === "kktix");
  assert.equal(blockedStatus.status, "provider_blocked");
  assert.equal(blockedStatus.lastErrorType, "provider_blocked");
  assert.equal(blockedStatus.lastDiagnostic.httpStatus, 403);
  assert.equal(blockedStatus.lastDiagnostic.contentType, "text/html; charset=utf-8");
  assert.equal(blockedStatus.lastDiagnostic.server, "cloudflare");
  assert.equal(blockedStatus.lastDiagnostic.requestId, "test-ray");
  assert.equal(JSON.stringify(blockedStatus.lastDiagnostic).includes("secret-value"), false);
  assert.equal(JSON.stringify(blockedStatus.lastDiagnostic).includes("test@example.com"), false);
  assert.equal(JSON.stringify(blockedStatus.lastDiagnostic).includes("hidden-value"), false);

  const rssFeed = `<?xml version="1.0"?><rss version="2.0"><channel><title>test</title><item><title>Taipei event</title><link>https://example.test/event</link><description>Road event in Taipei</description></item></channel></rss>`;
  global.fetch = async (url) => {
    if (String(url).includes("kktix")) {
      return { ok: false, status: 403, url: String(url), headers: new Headers({ "content-type": "text/html", server: "cloudflare" }), text: async () => "Cloudflare bot protection" };
    }
    if (String(url).includes("cloud.culture.tw")) {
      return { ok: true, status: 200, url: String(url), json: async () => ([{
        UID: "culture-after-kktix-block", title: "iCulture remains available", showInfo: [{
          time: twDate(cultureStart), endTime: twDate(cultureEnd), location: "\u81fa\u5317\u5e02\u4e2d\u6b63\u5340\u6e2c\u8a66\u8def 1 \u865f", locationName: "\u6587\u5316\u5834\u9928", latitude: "25.0478", longitude: "121.5170",
        }],
      }]) };
    }
    return { ok: true, status: 200, url: String(url), headers: new Headers({ "content-type": "application/rss+xml" }), text: async () => rssFeed };
  };
  const sourcesAfterKktixBlock = await eventRefresh.fetchDefaultSources("news", Date.now(), { skipAi: true });
  assert.equal(sourcesAfterKktixBlock.__collectorResults.rss.status, "success");
  assert.equal(sourcesAfterKktixBlock.__collectorResults.iculture.status, "success");
  assert.equal(sourcesAfterKktixBlock.cultureActivityEvents.length, 1);
  assert.equal(sourcesAfterKktixBlock.__collectorResults.kktix.status, "failed");
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
  const logCountBeforeAuthorizedCron = (await getRefreshLog()).length;
  assert.equal(logCountBeforeAuthorizedCron, 3);

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
  assert.deepEqual(await getCronLockStatus(), { locked: false });

  await acquireCronLock({ owner: "other-run", ttlSeconds: 60 });
  const skipped = await call(cron, {
    method: "POST",
    headers: { authorization: "Bearer cron-test-secret" },
  });
  assert.equal(skipped.statusCode, 200);
  assert.equal(skipped.payload.skippedByLock, true);
  assert.equal(skipped.payload.lock.locked, true);
  assert.equal(skipped.payload.lock.ownerRunId, "other-run");
  assert.ok(skipped.payload.lock.acquiredAt);
  assert.ok(skipped.payload.lock.expiresAt);
  const skippedLog = (await getRefreshLog())[0];
  assert.equal(skippedLog.status, "skipped");
  assert.equal(skippedLog.skippedReason, "cron_lock");
  assert.equal((await getRefreshRunDetail(skippedLog.runId)).status, "skipped");
  await releaseCronLock("other-run");

  eventRefresh.runEventRefresh = async () => { throw new Error("expected refresh failure"); };
  delete require.cache[require.resolve("../api/cron")];
  const failingCron = require("../api/cron");
  const failed = await call(failingCron, {
    method: "POST",
    headers: { authorization: "Bearer cron-test-secret" },
  });
  assert.equal(failed.statusCode, 500);
  assert.equal(failed.payload.success, false);
  assert.deepEqual(await getCronLockStatus(), { locked: false });

  for (let index = 0; index < 51; index += 1) {
    await saveRefreshRunDetail({ runId: `retention-${index}`, startedAt: new Date(now + index * 1000).toISOString(), completedAt: new Date(now + index * 1000).toISOString(), status: "success", mode: "news", sources: {}, pipeline: {}, finalEvents: [] });
  }
  assert.equal(await getRefreshRunDetail("retention-0"), null);
  assert.equal((await getRefreshRunDetail("retention-50")).runId, "retention-50");
  eventRefresh.runEventRefresh = originalRunEventRefresh;

  console.log("event refresh tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
