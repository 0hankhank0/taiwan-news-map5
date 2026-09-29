const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.EVENT_STORE_MODE = "local";
const store = require("../event-store");
const { eventFingerprint } = require("../assets/index/modules/event-data-manager.mjs");
const { getEventTimestamp } = require("../event-query");
const display = require("../event-display");
const normalizer = require("../event-normalizer");
const { getRequestQuery } = require("../request-query");

function response() {
  return { statusCode: 200, payload: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
    end() { return this; } };
}
async function call(handler, req) {
  const res = response();
  await handler({ method: "POST", headers: {}, body: {}, url: "/api/cron", ...req }, res);
  return res;
}

(async () => {
  process.env.CRON_SECRET = "pipeline-test";
  const originalStore = {
    acquire: store.acquireCronLock, release: store.releaseCronLock,
    append: store.appendRefreshLog, detail: store.saveRefreshRunDetail,
  };
  const refresh = require("../event-refresh");
  const originalRefresh = refresh.runEventRefresh;

  store.acquireCronLock = async () => ({ acquired: false, reason: "locked", lock: { locked: true, ownerRunId: "other" } });
  store.appendRefreshLog = async () => { throw Object.assign(new Error("secret token"), { code: "KV_WRITE_FAILED" }); };
  store.saveRefreshRunDetail = async () => { throw new Error("telemetry down"); };
  delete require.cache[require.resolve("../api/cron")];
  const cronSkipped = require("../api/cron");
  const skipped = await call(cronSkipped, { headers: { authorization: "Bearer pipeline-test" } });
  assert.equal(skipped.statusCode, 200);
  assert.equal(skipped.payload.skippedByLock, true);

  store.acquireCronLock = async () => ({ acquired: true, lock: { locked: true, ownerRunId: "run" } });
  store.releaseCronLock = async () => { throw new Error("release failed"); };
  refresh.runEventRefresh = async (options) => ({ success: true, status: "success", runId: options.runId, mode: options.mode, events: [], count: 0 });
  delete require.cache[require.resolve("../api/cron")];
  const cronRelease = require("../api/cron");
  const released = await call(cronRelease, { headers: { authorization: "Bearer pipeline-test" } });
  assert.equal(released.statusCode, 200);
  assert.equal(released.payload.skippedByLock, false);

  store.setRefreshStatus = async () => { throw new Error("status sink down"); };
  store.appendRefreshLog = async () => { throw new Error("log sink down"); };
  store.saveRefreshRunDetail = async () => { throw new Error("detail sink down"); };
  delete require.cache[require.resolve("../event-refresh")];
  const refreshWithBrokenTelemetry = require("../event-refresh");
  const rootError = new Error("root refresh failure");
  await assert.rejects(
    () => refreshWithBrokenTelemetry.runEventRefresh({ fetchSources: async () => { throw rootError; } }),
    (error) => error === rootError
  );

  const migration = fs.readFileSync(path.join(__dirname, "..", "supabase/migrations/20260929_official_events_snapshot.sql"), "utf8");
  assert.match(migration, /replace_official_events_snapshot/);
  assert.match(migration, /delete from public\.official_events/);
  assert.match(migration, /source_candidate_id is null/);
  assert.match(migration, /categorySource/);
  assert.match(migration, /not exists/);

  const undated = normalizer.normalizeEvent({
    id: "undated-news", title: "台北道路事故", content: "台北市現場處理中",
    category: "traffic", eventKind: "news", source: "RSS", city: "台北市", lat: 25.03, lng: 121.56,
    fetchedAt: "2026-09-29T00:00:00.000Z",
  });
  assert.equal(undated.publishedAt, null);
  assert.notEqual(undated.publishedAt, undated.createdAt);

  assert.equal(getEventTimestamp({ eventKind: "activity", startsAt: "2026-09-30T10:00:00Z", updatedAt: "2026-09-29T12:00:00Z" }), Date.parse("2026-09-30T10:00:00Z"));
  assert.equal(getEventTimestamp({ eventKind: "news", publishedAt: "2026-09-28T10:00:00Z", updatedAt: "2026-09-29T12:00:00Z" }), Date.parse("2026-09-28T10:00:00Z"));
  assert.equal(getEventTimestamp({ category: "traffic", occurredAt: "2026-09-28T10:00:00Z", updatedAt: "2026-09-29T12:00:00Z" }), Date.parse("2026-09-28T10:00:00Z"));

  const base = { id: "fp", title: "title", category: "news", groupCategory: "other", status: "active", lat: 25, lng: 121, locationQuality: "high", locationPrecision: "exact", publishedAt: "2026-09-28", updatedAt: "2026-09-28", sourceUrl: "https://example.test/a", summary: "s", content: "c" };
  assert.equal(eventFingerprint([base]), eventFingerprint([{ ...base }]));
  for (const change of [{ category: "traffic" }, { lat: 24 }, { publishedAt: "2026-09-29" }, { content: "changed" }, { status: "resolved" }]) {
    assert.notEqual(eventFingerprint([base]), eventFingerprint([{ ...base, ...change }]));
  }

  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  store.__test.setKvClient({ async set() { throw Object.assign(new Error("kv down"), { code: "KV_DOWN" }); } });
  await assert.rejects(() => store.setOfficialEvents([{ id: "durable-test" }]), (error) => error.code === "CANONICAL_PERSISTENCE_FAILED");
  store.__test.resetKvClient();
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;

  const queryReq = { url: "/api/events?category=traffic", headers: { host: "example.test" } };
  Object.defineProperty(queryReq, "query", { get() { throw new Error("legacy query getter used"); } });
  assert.equal(getRequestQuery(queryReq).category, "traffic");

  Object.assign(store, originalStore);
  refresh.runEventRefresh = originalRefresh;
  console.log("pipeline integrity tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
