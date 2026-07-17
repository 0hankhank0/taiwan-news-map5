const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.REPORT_ADMIN_TOKEN = "test-token";
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `taiwan-news-admin-test-${Date.now()}.sqlite`);
process.env.DISABLE_LOCAL_EVENT_CACHE = "0";

const { setCachedEvents, getCachedEvents, appendRefreshLog, getRefreshLog, saveRefreshRunDetail } = require("../event-store");
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
  assert.equal(rewrites["/api/refresh-log"], "/api/admin.js?adminRoute=refresh-log");
  assert.equal(rewrites["/api/reports"], "/api/admin.js?adminRoute=reports");
  assert.equal(rewrites["/api/submission-audit-log"], "/api/submission.js?auditLog=1");
  assert.equal(Object.values(rewrites).some((destination) => /admin-events\.js|health\.js|reports\.js|submission-audit-log\.js/.test(destination)), false);

  const refreshBase = Date.parse("2026-07-16T12:00:00.000Z");
  for (let index = 0; index < 205; index += 1) {
    await appendRefreshLog({
      runId: `run-${index}`, trigger: "scheduled", mode: index % 2 ? "traffic" : "news", status: index % 3 ? "success" : "error",
      startedAt: new Date(refreshBase + index * 1000).toISOString(), completedAt: new Date(refreshBase + index * 1000 + 50).toISOString(),
      error: index === 204 ? "Authorization: Bearer never-expose" : null,
    });
  }
  const refreshLog = await getRefreshLog();
  assert.equal(refreshLog.length, 200);
  assert.ok(Date.parse(refreshLog[0].startedAt) >= Date.parse(refreshLog[1].startedAt));
  const refreshDenied = await call(admin, { method: "GET", url: "/api/refresh-log" });
  assert.equal(refreshDenied.statusCode, 401);
  const refreshForbidden = await call(admin, { method: "GET", url: "/api/refresh-log", headers: { authorization: "Bearer wrong" } });
  assert.equal(refreshForbidden.statusCode, 403);
  const refreshOk = await call(admin, { method: "GET", url: "/api/refresh-log", headers: { authorization: "Bearer test-token" }, query: { limit: "999" } });
  assert.equal(refreshOk.statusCode, 200);
  assert.equal(refreshOk.payload.limit, 200);
  assert.equal(refreshOk.payload.total, 200);
  assert.equal(JSON.stringify(refreshOk.payload).includes("never-expose"), false);
  const statusFilter = await call(admin, { method: "GET", url: "/api/refresh-log", headers: { authorization: "Bearer test-token" }, query: { status: "error" } });
  assert.ok(statusFilter.payload.logs.every((entry) => entry.status === "error"));
  const modeFilter = await call(admin, { method: "GET", url: "/api/refresh-log", headers: { authorization: "Bearer test-token" }, query: { mode: "traffic" } });
  assert.ok(modeFilter.payload.logs.every((entry) => entry.mode === "traffic"));
  const runIdFilter = await call(admin, { method: "GET", url: "/api/refresh-log", headers: { authorization: "Bearer test-token" }, query: { runId: "run-204" } });
  assert.equal(runIdFilter.payload.total, 1);
  const dateFilter = await call(admin, { method: "GET", url: "/api/refresh-log", headers: { authorization: "Bearer test-token" }, query: { dateFrom: "2026-07-16T12:03:20.000Z" } });
  assert.ok(dateFilter.payload.logs.every((entry) => Date.parse(entry.startedAt) >= Date.parse("2026-07-16T12:03:20.000Z")));
  await saveRefreshRunDetail({ runId: "run-204", startedAt: "2026-07-16T12:03:24.000Z", completedAt: "2026-07-16T12:03:25.000Z", status: "success", mode: "news", sources: { rss: { count: 1, items: [{ title: "safe item", processingResult: "accepted", eventId: "event-1" }] } }, pipeline: { rawCount: 1, finalCount: 1 }, finalEvents: [] });
  const detailDenied = await call(admin, { method: "GET", url: "/api/refresh-log", query: { runId: "run-204", detail: "1" } });
  assert.equal(detailDenied.statusCode, 401);
  const detailOk = await call(admin, { method: "GET", url: "/api/refresh-log", headers: { authorization: "Bearer test-token" }, query: { runId: "run-204", detail: "1" } });
  assert.equal(detailOk.statusCode, 200);
  assert.equal(detailOk.payload.run.runId, "run-204");
  assert.equal(detailOk.payload.details.sources.rss.items[0].processingResult, "accepted");

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

  const queryTokenDenied = await call(admin, { method: "GET", url: "/api/health", query: { token: "test-token" } });
  assert.equal(queryTokenDenied.statusCode, 401);
  const okHealth = await call(admin, { method: "GET", url: "/api/health", headers: { authorization: "Bearer test-token" } });
  assert.equal(okHealth.statusCode, 200);
  assert.equal(okHealth.payload.beta, true);
  assert.equal(okHealth.payload.events.total, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(okHealth.payload.integrations, "mapboxPublicToken"), true);

  const reportsList = await call(admin, { method: "GET", url: "/api/reports", headers: { authorization: "Bearer test-token" } });
  assert.equal(reportsList.statusCode, 200);
  assert.equal(Array.isArray(reportsList.payload.reports), true);
  const reportPatch = await call(admin, { method: "PATCH", url: "/api/reports/report_missing", params: { reportId: "report_missing" }, headers: { authorization: "Bearer test-token" }, body: { status: "resolved" } });
  assert.equal(reportPatch.statusCode, 404);

  const patch = await call(admin, {
    method: "PATCH",
    url: "/api/admin-events",
    query: { eventId: "event_admin_test" },
    headers: { authorization: "Bearer test-token" },
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
