const assert = require("assert");
const os = require("os");
const path = require("path");

process.env.REPORT_ADMIN_TOKEN = "test-token";
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `taiwan-news-admin-test-${Date.now()}.sqlite`);
process.env.DISABLE_LOCAL_EVENT_CACHE = "0";

const { setCachedEvents, getCachedEvents } = require("../event-store");
const adminEvents = require("../api/admin-events");
const health = require("../api/health");

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
    headers: {},
    query: {},
    body: {},
    params: {},
    ...req,
  }, res);
  return res;
}

(async () => {
  await setCachedEvents([{
    id: "event_admin_test",
    title: "測試事件",
    content: "台北市大安區測試事件",
    category: "activity",
    city: "台北市",
    lat: 25.033,
    lng: 121.5654,
    source: "test",
    sourceName: "test",
    updatedAt: new Date().toISOString(),
  }]);

  const denied = await call(health, { method: "GET" });
  assert.equal(denied.statusCode, 401);

  const okHealth = await call(health, { method: "GET", query: { token: "test-token" } });
  assert.equal(okHealth.statusCode, 200);
  assert.equal(okHealth.payload.beta, true);
  assert.equal(okHealth.payload.events.total, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(okHealth.payload.integrations, "mapboxPublicToken"), true);

  const patch = await call(adminEvents, {
    method: "PATCH",
    query: { token: "test-token", eventId: "event_admin_test" },
    body: {
      lat: 25.0217,
      lng: 121.5358,
      category: "traffic",
      status: "resolved",
      verifiedStatus: "resolved",
      reviewState: "reviewed",
      adminNote: "manual test",
    },
  });
  assert.equal(patch.statusCode, 200);
  assert.equal(patch.payload.success, true);
  assert.equal(patch.payload.event.statusSource, "manual");

  const events = await getCachedEvents();
  assert.equal(events[0].category, "traffic");
  assert.equal(events[0].status, "resolved");
  assert.equal(events[0].reviewState, "reviewed");
  assert.equal(events[0].adminReview.adminNote, "manual test");

  console.log("admin API tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
