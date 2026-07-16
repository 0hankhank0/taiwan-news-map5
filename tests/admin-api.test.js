const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.REPORT_ADMIN_TOKEN = "test-token";
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `taiwan-news-admin-test-${Date.now()}.sqlite`);
process.env.DISABLE_LOCAL_EVENT_CACHE = "0";

const { setCachedEvents, getCachedEvents } = require("../event-store");
const admin = require("../api/admin");

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
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  const rewrites = Object.fromEntries(vercel.rewrites.map((entry) => [entry.source, entry.destination]));
  assert.equal(rewrites["/api/admin-events"], "/api/admin.js?adminRoute=events");
  assert.equal(rewrites["/api/health"], "/api/admin.js?adminRoute=health");
  assert.equal(rewrites["/api/reports"], "/api/admin.js?adminRoute=reports");
  assert.equal(rewrites["/api/submission-audit-log"], "/api/submission.js?auditLog=1");
  assert.equal(Object.values(rewrites).some((destination) => /admin-events\.js|health\.js|reports\.js|submission-audit-log\.js/.test(destination)), false);

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

  const denied = await call(admin, { method: "GET", url: "/api/health" });
  assert.equal(denied.statusCode, 401);

  const okHealth = await call(admin, { method: "GET", url: "/api/health", query: { token: "test-token" } });
  assert.equal(okHealth.statusCode, 200);
  assert.equal(okHealth.payload.beta, true);
  assert.equal(okHealth.payload.events.total, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(okHealth.payload.integrations, "mapboxPublicToken"), true);

  const reportsList = await call(admin, { method: "GET", url: "/api/reports", query: { token: "test-token" } });
  assert.equal(reportsList.statusCode, 200);
  assert.equal(Array.isArray(reportsList.payload.reports), true);
  const reportPatch = await call(admin, { method: "PATCH", url: "/api/reports/report_missing", params: { reportId: "report_missing" }, query: { token: "test-token" }, body: { status: "resolved" } });
  assert.equal(reportPatch.statusCode, 404);

  const patch = await call(admin, {
    method: "PATCH",
    url: "/api/admin-events",
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
  assert.equal(events[0].locationQuality, "high");
  assert.equal(events[0].locationDisplayMode, "point");
  assert.equal(events[0].locationConfidence, 1);
  assert.equal(events[0].adminReview.adminNote, "manual test");

  console.log("admin API tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
