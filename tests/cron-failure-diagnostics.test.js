const assert = require("node:assert/strict");

process.env.EVENT_STORE_MODE = "local";
process.env.CRON_SECRET = "diagnostics-test-secret";
const store = require("../event-store");
let failStage;
let rootError;
let released = 0;
store.acquireCronLock = async () => ({ acquired: true });
store.releaseCronLock = async () => { released++; };
store.getOfficialEvents = async () => {
  if (failStage === "read_existing_events") throw rootError;
  return [];
};
store.setOfficialEvents = async () => {
  if (failStage === "persist_events") throw rootError;
};
store.writeEventBuckets = async () => {
  if (failStage === "write_buckets") throw rootError;
  return {};
};
store.setRefreshStatus = store.appendRefreshLog = store.saveRefreshRunDetail = async () => {};
require("../refresh-alerts").notifyRefreshAlert = async () => {};
const refresh = require("../event-refresh");
const originalRefresh = refresh.runEventRefresh;
refresh.runEventRefresh = (options) => originalRefresh({
  ...options,
  skipExternalGeocoding: true,
  fetchSources: async () => {
    if (failStage === "collect_sources") throw rootError;
    return {};
  },
});
const cron = require("../api/cron");

(async () => {
  for (const [stage, error, expectedCode] of [
    ["collect_sources", new TypeError("private provider response"), "TYPE_ERROR"],
    ["read_existing_events", new Error("Authorization: Bearer private-token"), "REFRESH_FAILED"],
    ["persist_events", Object.assign(new Error("private database details"), { code: "CANONICAL_PERSISTENCE_FAILED" }), "CANONICAL_PERSISTENCE_FAILED"],
    ["write_buckets", Object.assign(new Error("private request URL"), { code: "secret-code-value" }), "REFRESH_FAILED"],
  ]) {
    failStage = stage;
    rootError = error;
    const res = {
      setHeader() {}, status(value) { this.statusCode = value; return this; },
      json(value) { this.payload = value; return this; },
    };
    await cron({ method: "POST", url: "/api/cron?mode=news", headers: { authorization: "Bearer diagnostics-test-secret" } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.payload.stage, stage);
    assert.equal(res.payload.errorCode, expectedCode);
    assert.match(res.payload.runId, /^cron-/);
    assert.equal(res.payload.success, false);
    assert.equal(res.payload.skippedByLock, false);
    assert(!JSON.stringify(res.payload).includes(error.message));
    assert(!JSON.stringify(res.payload).includes("secret-code-value"));
  }
  assert.equal(released, 4, "every failed refresh releases its lock");
  await assert.rejects(() => originalRefresh({ fetchSources: async () => { throw rootError; }, write: false }), (error) => error === rootError);
  console.log("cron failure diagnostics tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
