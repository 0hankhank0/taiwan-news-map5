const assert = require("assert");
const os = require("os");
const path = require("path");

process.env.EVENT_STORE_MODE = "local";
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `taiwan-news-production-regression-${Date.now()}.sqlite`);
const refresh = require("../event-refresh");
const store = require("../event-store");
const cron = require("../api/cron");

(async () => {
  const originalFetch = global.fetch;
  const originalId = process.env.TDX_CLIENT_ID;
  const originalSecret = process.env.TDX_CLIENT_SECRET;
  process.env.TDX_CLIENT_ID = " client-id-with-whitespace ";
  process.env.TDX_CLIENT_SECRET = " client-secret-with-whitespace ";
  global.fetch = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: "unauthorized_client" }) });
  await assert.rejects(() => refresh.fetchTDXAccessToken(Date.now()), (error) => error.code === "authorization_failed" && /authorization_failed/.test(error.message));

  const originalOverride = process.env.TDX_STATUS_OVERRIDE;
  async function assertTdxFallback(override, expectedStatus) {
    if (override === undefined) delete process.env.TDX_STATUS_OVERRIDE; else process.env.TDX_STATUS_OVERRIDE = override;
    await store.setCachedValue("tdx_access_token", "");
    await store.setCachedValue("tdx:live_cms_events", { events: [{ id: `tdx-live-${expectedStatus}`, title: "cached traffic", category: "traffic", city: "Taipei", lat: 25.04, lng: 121.52 }] });
    await store.setCachedValue("tdx:construction_events", { events: [{ id: `tdx-construction-${expectedStatus}`, title: "cached construction", category: "construction", city: "Taipei", lat: 25.04, lng: 121.52 }] });
    global.fetch = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: "unauthorized_client" }) });
    const infoLogs = [];
    const originalInfo = console.info;
    console.info = (...args) => infoLogs.push(args);
    const sources = await refresh.fetchDefaultSources("traffic", Date.now(), { runId: `tdx-log-${expectedStatus}` });
    console.info = originalInfo;
    assert.match(sources.__collectorResults.tdxTraffic.reason, new RegExp(expectedStatus));
    assert.equal(sources.tdxEvents.length, 1, "TDX traffic cache must be retained");
    assert.equal(sources.constructionEvents.length, 1, "TDX construction cache must be retained");
    assert(infoLogs.some((args) => args[0] === "[cron] source fallback" && args[1]?.source === "tdxTraffic" && args[1]?.fallbackType === "persistent_cache" && args[1]?.failureCode === expectedStatus && args[1]?.runId === `tdx-log-${expectedStatus}`));
  }
  await assertTdxFallback(undefined, "authorization_failed");
  await assertTdxFallback("quota_exhausted", "quota_exhausted");
  await assertTdxFallback("not-a-valid-status", "authorization_failed");
  if (originalOverride === undefined) delete process.env.TDX_STATUS_OVERRIDE; else process.env.TDX_STATUS_OVERRIDE = originalOverride;

  let cultureAttempts = 0;
  global.fetch = async () => {
    cultureAttempts += 1;
    if (cultureAttempts === 1) { const error = new Error("timed out"); error.name = "TimeoutError"; throw error; }
    return { ok: true, json: async () => [] };
  };
  const cultureInfo = [];
  const originalInfoForCulture = console.info;
  console.info = (...args) => cultureInfo.push(args);
  assert.deepEqual(await refresh.fetchCultureActivityEvents(Date.now(), { runId: "iculture-retry-success" }), []);
  console.info = originalInfoForCulture;
  assert.equal(cultureAttempts, 2, "iCulture must make one delayed retry");
  assert(cultureInfo.some((args) => args[0] === "[cron] iCulture attempt" && args[1]?.stage === "collection" && args[1]?.attempt === 2 && args[1]?.outcome === "success" && args[1]?.runId === "iculture-retry-success"));
  assert.equal(cultureInfo.some((args) => args[1]?.stage === "collection" && args[1]?.outcome === "failed"), false);

  const failedCultureInfo = [];
  console.info = (...args) => failedCultureInfo.push(args);
  global.fetch = async () => ({ ok: true, json: async () => { const error = new Error("timed out"); error.name = "TimeoutError"; throw error; } });
  await refresh.fetchCultureActivityEvents(Date.now(), { runId: "iculture-parse-failure" });
  console.info = originalInfoForCulture;
  assert.equal(failedCultureInfo.some((args) => args[1]?.stage === "collection" && args[1]?.outcome === "success"), false, "a response-only success must not be logged as final success");
  assert(failedCultureInfo.some((args) => args[1]?.stage === "collection" && args[1]?.outcome === "failed"));

  const future = new Date(Date.now() + 86400000).toISOString();
  const tourism = refresh.normalizeTourismEvent({
    EventID: "postal-object", EventName: "Postal object", PositionLat: "25.04", PositionLon: "121.52",
    PostalAddress: { addressRegion: "臺北市", addressLocality: "中正區", streetAddress: "測試路 1 號" },
    LocatedCities: ["臺北市"], StartDateTime: future, EndDateTime: future,
  });
  assert.equal(tourism.address.includes("[object Object]"), false);
  assert.equal(tourism.district, "中正區");
  assert.equal(refresh.normalizeTourismEvent({ ...tourism, EventID: "bad-district", PostalAddress: "逛市 行於閩南地區", LocatedCities: ["臺北市"], PositionLat: "25.04", PositionLon: "121.52", EventName: "x" })?.district || "", "");

  const longAddress = "臺北市中正區忠孝西路一段 ".repeat(20);
  const mapboxQuery = refresh.buildMapboxQuery({ address: longAddress, city: "Taipei" }, { city: "Taipei" });
  assert(mapboxQuery.length <= 80);
  assert.equal((mapboxQuery.match(/臺北市中正區/g) || []).length <= 1, true, "Mapbox query must deduplicate address segments");
  process.env.MAPBOX_TOKEN = "test-token";
  const queries = [];
  global.fetch = async (url) => {
    queries.push(decodeURIComponent(new URL(String(url)).pathname));
    return queries.length === 1 ? { ok: false, status: 422, text: async () => "Query too long" } : { ok: true, status: 200, json: async () => ({ features: [] }) };
  };
  await refresh.geocodeLocationWithMapbox({ address: longAddress, city: "Taipei" }, { city: "Taipei" }, Date.now());
  delete process.env.MAPBOX_TOKEN;
  assert.equal(queries.length, 2);
  assert.notEqual(queries[0], queries[1], "422 fallback must not repeat the same Mapbox query");
  assert(queries[1].length < queries[0].length, "422 fallback query must be shorter");

  const req = { url: "/api/cron?mode=traffic", headers: { host: "example.test" }, body: {} };
  Object.defineProperty(req, "query", { get() { throw new Error("legacy req.query getter was read"); } });
  assert.equal(cron.getMode(req), "traffic");
  assert.equal(cron.getMode({ url: "/api/cron?mode=news", headers: { host: "example.test" }, body: {} }), "news");
  // `all` is deliberately invalid: the handler receives news, so no traffic
  // collector can be reached through the public cron endpoint.
  assert.equal(cron.getMode({ url: "/api/cron?mode=all", headers: { host: "example.test" }, body: {} }), "news");
  assert.equal(cron.getMode({ url: "/api/cron?mode=unexpected", headers: { host: "example.test" }, body: {} }), "news");
  assert.equal(cron.getMode({ url: "/api/cron", headers: { host: "example.test" }, body: {} }), "news");

  // Cold start: no iCulture in-memory cache, upstream failure, but the
  // canonical store merge still retains the existing official activity.
  const existingCulture = { id: "iCulture_cold", title: "cached culture", source: "iCulture", sourceName: "iCulture", category: "activity", city: "Taipei", lat: 25.04, lng: 121.52, expiresAt: Date.now() + 86400000 };
  const coldResult = await refresh.runEventRefresh({ write: false, existingEvents: [existingCulture], sourceData: { cultureActivityEvents: [], activityEvents: [] } });
  assert.equal(coldResult.events.some((event) => event.id === "iCulture_cold"), true, "cold-start timeout path must retain official iCulture data");

  const originalInfo = console.info;
  const officialFallbackLogs = [];
  console.info = (...args) => officialFallbackLogs.push(args);
  await refresh.runEventRefresh({ runId: "official-fallback-log", write: false, existingEvents: [
    { id: "tdx-official", source: "TDX CMS", category: "traffic", title: "retained", city: "Taipei", lat: 25.04, lng: 121.52, expiresAt: Date.now() + 86400000 },
    { id: "kktix-official", source: "KKTIX", category: "activity", title: "retained activity", city: "Taipei", lat: 25.04, lng: 121.52, expiresAt: Date.now() + 86400000 },
  ], sourceData: {}, sourceFailures: { tdxTraffic: "TDX authorization_failed", kktix: "KKTIX provider_blocked" } });
  console.info = originalInfo;
  assert(officialFallbackLogs.some((args) => args[0] === "[cron] source fallback" && args[1]?.fallbackType === "existing_official_events" && args[1]?.retainedCount === 1 && args[1]?.failureCode === "authorization_failed" && args[1]?.runId === "official-fallback-log"));
  assert(officialFallbackLogs.some((args) => args[0] === "[cron] source fallback" && args[1]?.source === "kktix" && args[1]?.fallbackType === "existing_official_events" && args[1]?.retainedCount === 1 && args[1]?.failureCode === "provider_blocked"));
  assert(officialFallbackLogs.some((args) => args[0] === "[cron] source summary" && args[1]?.source === "tdxTraffic" && args[1]?.persistentCacheCount === 0 && args[1]?.retainedExistingCount === 1 && args[1]?.finalMergedCount === 1));
  assert(officialFallbackLogs.some((args) => args[0] === "[cron] source summary" && args[1]?.source === "kktix" && args[1]?.retainedExistingCount === 1 && args[1]?.finalMergedCount === 1 && args[1]?.failureCode === "provider_blocked"));

  const alert = refresh.buildSourceFailureAlert({ tdxTraffic: "TDX quota_exhausted", iculture: "timeout", kktix: "provider_blocked" });
  assert.match(alert, /quota_exhausted/);
  assert.match(alert, /已保留既有資料/);
  assert.match(alert, /次要來源降級/);

  const large = "x".repeat(11 * 1024 * 1024);
  const compact = store.compactCandidate({ candidateId: "large", status: "pending", rawSourceData: { large }, event: { title: "small", images: [large], tourismEvent: { large } } });
  assert(Buffer.byteLength(JSON.stringify([compact])) < store.MAX_CANDIDATE_PAYLOAD_BYTES, "candidate payload must be below KV limit");
  assert.equal(store.KV_CANDIDATE_STATUSES.has("pending_admin"), true);
  const [pendingAdmin] = await store.createEventCandidates([{
    candidateId: "pending-admin", source: "user_submission", status: "pending_admin",
    rawSourceData: { privateEvidence: "kept by submission store" },
    event: { title: "待審投稿", content: "必要內容", address: "臺北市中正區測試路", city: "Taipei", district: "中正區", lat: 25.04, lng: 121.52 },
  }]);
  assert.equal(pendingAdmin.status, "pending_admin");
  assert.equal((await store.getEventCandidates()).find((candidate) => candidate.candidateId === pendingAdmin.candidateId).event.address, "臺北市中正區測試路");
  await assert.rejects(
    () => store.saveEventCandidates([{ candidateId: "kv-failure", status: "pending_admin", event: { title: "review" } }], { kvConfigured: true, setKvValue: async () => false }),
    (error) => error.code === "KV_WRITE_FAILED",
    "a failed configured KV write must not be reported as saved"
  );

  const priorDisable = process.env.DISABLE_LOCAL_EVENT_CACHE;
  process.env.DISABLE_LOCAL_EVENT_CACHE = "1";
  await assert.rejects(() => store.saveEventCandidates([{ candidateId: "cannot-save", status: "pending", event: {} }]), /Candidate persistence failed/);
  if (priorDisable === undefined) delete process.env.DISABLE_LOCAL_EVENT_CACHE; else process.env.DISABLE_LOCAL_EVENT_CACHE = priorDisable;

  global.fetch = originalFetch;
  if (originalId === undefined) delete process.env.TDX_CLIENT_ID; else process.env.TDX_CLIENT_ID = originalId;
  if (originalSecret === undefined) delete process.env.TDX_CLIENT_SECRET; else process.env.TDX_CLIENT_SECRET = originalSecret;
  console.log("production cron regression tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
