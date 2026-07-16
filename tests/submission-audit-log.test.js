const assert = require("assert");
const os = require("os");
const path = require("path");

process.env.REPORT_ADMIN_TOKEN = "audit-test-token";
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `taiwan-news-audit-test-${Date.now()}.sqlite`);

const submission = require("../api/submission");
const { setCachedValue } = require("../event-store");

function response() { return { statusCode: 200, headers: {}, payload: null, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(v) { this.payload = v; return this; }, end() { return this; } }; }
async function call(handler, req = {}) { const res = response(); await handler({ method: "GET", headers: {}, query: {}, body: {}, ...req }, res); return res; }

(async () => {
  const logs = [
    { auditId: "audit-old", actionTime: "2026-07-14T02:00:00.000Z", action: "admin_reject", actorId: "admin", actorRole: "admin", submissionId: "sub-alpha", previousStatus: "pending_admin", newStatus: "rejected", changedFields: ["status"], reviewNote: "old note", requestId: "req-old", ipHash: "must-not-leak", aiReviewResult: { secret: true }, token: "must-not-leak" },
    { auditId: "audit-middle", actionTime: "2026-07-15T02:00:00.000Z", action: "rules_engine", actorId: "system", actorRole: "system", submissionId: "sub-beta", previousStatus: "pending_ai", newStatus: "pending_admin", changedFields: ["status", "aiReviewResult"], reviewNote: "", requestId: "req-middle", environment: "must-not-leak" },
    { auditId: "audit-new", actionTime: "2026-07-16T02:00:00.000Z", action: "admin_approve", actorId: "admin", actorRole: "admin", submissionId: "sub-alpha", previousStatus: "pending_admin", newStatus: "approved", changedFields: ["status", "reviewNote"], reviewNote: "approved", requestId: "req-new", fullAiResult: "must-not-leak" },
  ];
  await setCachedValue("submissions:audit-log", logs);

  const auditRequest = { url: "/api/submission-audit-log" };
  const missing = await call(submission, auditRequest);
  assert.equal(missing.statusCode, 401);
  const forbidden = await call(submission, { ...auditRequest, headers: { authorization: "Bearer wrong" } });
  assert.equal(forbidden.statusCode, 403);

  const auth = { authorization: "Bearer audit-test-token" };
  const all = await call(submission, { ...auditRequest, headers: auth });
  assert.equal(all.statusCode, 200);
  assert.equal(all.payload.total, 3);
  assert.deepEqual(all.payload.logs.map((entry) => entry.auditId), ["audit-new", "audit-middle", "audit-old"]);
  assert.equal(JSON.stringify(all.payload).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(all.payload).includes("actorId"), false);

  const capped = await call(submission, { ...auditRequest, headers: auth, query: { limit: "999" } });
  assert.equal(capped.payload.limit, 200);
  const paged = await call(submission, { ...auditRequest, headers: auth, query: { limit: "1", offset: "1" } });
  assert.equal(paged.payload.logs.length, 1);
  assert.equal(paged.payload.logs[0].auditId, "audit-middle");
  const byAction = await call(submission, { ...auditRequest, headers: auth, query: { action: "admin_approve" } });
  assert.deepEqual(byAction.payload.logs.map((entry) => entry.auditId), ["audit-new"]);
  const bySubmission = await call(submission, { ...auditRequest, headers: auth, query: { submissionId: "sub-alpha" } });
  assert.deepEqual(bySubmission.payload.logs.map((entry) => entry.auditId), ["audit-new", "audit-old"]);
  const byRole = await call(submission, { ...auditRequest, headers: auth, query: { actorRole: "system" } });
  assert.deepEqual(byRole.payload.logs.map((entry) => entry.auditId), ["audit-middle"]);
  const byDate = await call(submission, { ...auditRequest, headers: auth, query: { dateFrom: "2026-07-15", dateTo: "2026-07-15" } });
  assert.deepEqual(byDate.payload.logs.map((entry) => entry.auditId), ["audit-middle"]);

  await setCachedValue("submissions:audit-log", []);
  const empty = await call(submission, { ...auditRequest, headers: auth });
  assert.equal(empty.payload.total, 0);
  assert.deepEqual(empty.payload.logs, []);

  const publicSubmissions = await call(submission);
  assert.equal(publicSubmissions.statusCode, 200);
  assert.equal(JSON.stringify(publicSubmissions.payload).includes("audit"), false);
  console.log("submission audit log API tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
