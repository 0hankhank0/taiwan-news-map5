const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.REPORT_ADMIN_TOKEN = "submission-test-token";
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `taiwan-news-submission-test-${Date.now()}.sqlite`);
process.env.OPENAI_API_KEY = "";
const submission = require("../api/submission");
const events = require("../api/events");
const { createSubmission, updateSubmission, getPublicMapSubmissionEvents, getAuditLog, listSubmissions } = require("../submission-store");
const { setCachedValue } = require("../event-store");

function res() { return { statusCode: 200, headers: {}, payload: null, setHeader(k,v){this.headers[k]=v}, status(n){this.statusCode=n;return this}, json(v){this.payload=v;return this}, end(){return this} }; }
async function call(req) { const response = res(); await submission({ method: "GET", headers: {}, query: {}, body: {}, ...req }, response); return response; }
async function callEvents(req = {}) { const response = res(); await events({ method: "GET", headers: {}, query: {}, url: "/api/events", ...req }, response); return response; }
function validInput(title = "台北市低風險活動") { return { title, description: "在台北市大安區公園舉辦的公開活動，提供完整時間與地點。", category: "activity", address: "台北市大安區公園", latitude: 25.033, longitude: 121.565, evidenceUrls: ["https://example.test/evidence"] }; }

(async () => {
  const safeAnalysis = {
    risk_level: "low", location_valid: true, possible_duplicate: false,
    spam_probability: 0.01, credibility_score: 0.9, evidence_score: 0.8,
    missing_information: [], safety_flags: [],
  };
  const auto = submission.decidePublication({ title: "低風險活動", latitude: 25.033, longitude: 121.565 }, safeAnalysis, false);
  assert.deepEqual(auto, {
    status: "approved", approvalMethod: "auto", riskLevel: "low",
    publicationNotice: "使用者投稿｜尚未經官方證實",
  });
  assert.equal(submission.decidePublication({}, { ...safeAnalysis, possible_duplicate: true }, false).status, "pending_admin");
  assert.equal(submission.decidePublication({}, { ...safeAnalysis, risk_level: "high" }, false).status, "pending_admin");
  assert.equal(submission.decidePublication({ latitude: null, longitude: null }, safeAnalysis, false).status, "pending_admin");
  assert.equal(submission.decidePublication({ latitude: 35, longitude: 121.565 }, safeAnalysis, false).status, "pending_admin");
  assert.ok(Date.parse(submission.automaticExpiration({ category: "traffic", createdAt: "2026-07-16T00:00:00.000Z" })) > Date.parse("2026-07-16T00:00:00.000Z"));

  const created = await call({ method: "POST", headers: { "x-forwarded-for": "test-client" }, body: { title: "台北市週末市集", description: "週末在大安森林公園舉辦市集，歡迎民眾參加。", category: "activity", address: "台北市大安森林公園", sourceUrl: "https://example.test/event" } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.payload.status, "pending_admin");
  const privateList = await call({ method: "GET", headers: { authorization: "Bearer submission-test-token" }, query: { status: "pending_admin" } });
  assert.equal(privateList.statusCode, 200);
  assert.equal(privateList.payload.total, 1);
  const id = privateList.payload.submissions[0].submissionId;
  const approved = await call({ method: "PATCH", headers: { authorization: "Bearer submission-test-token" }, query: { submissionId: id }, body: { status: "approved", reviewNote: "verified" } });
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.payload.submission.approvalMethod, "admin");
  const publicList = await call({ method: "GET" });
  assert.equal(publicList.statusCode, 200);
  assert.equal(publicList.payload.total, 1);
  assert.equal(Object.hasOwn(publicList.payload.submissions[0], "contactInfo"), false);
  assert.equal(Object.hasOwn(publicList.payload.submissions[0], "aiReviewResult"), false);
  assert.equal(Object.hasOwn(publicList.payload.submissions[0], "reviewNote"), false);

  // Approved, public submission enters the same /api/events map feed and keeps the public notice.
  const mapSubmission = await createSubmission(validInput("地圖公開投稿"));
  await updateSubmission(mapSubmission.submissionId, { status: "approved", approvalMethod: "auto", riskLevel: "low", publicationNotice: "使用者投稿｜尚未經官方證實" }, { action: "rules_engine" });
  const mapEvents = await getPublicMapSubmissionEvents();
  assert.equal(mapEvents.some((item) => item.submissionId === mapSubmission.submissionId), true);
  const publicMapEvent = mapEvents.find((item) => item.submissionId === mapSubmission.submissionId);
  assert.equal(publicMapEvent.publicationNotice, "使用者投稿｜尚未經官方證實");
  assert.equal(Object.hasOwn(publicMapEvent, "contactInfo"), false);
  assert.equal(Object.hasOwn(publicMapEvent, "aiReviewResult"), false);
  const submissionsBeforeDuplicateCheck = await listSubmissions({ limit: 1000 });
  await setCachedValue("submissions:all", [...submissionsBeforeDuplicateCheck, { ...mapSubmission, status: "approved" }]);
  assert.equal((await getPublicMapSubmissionEvents()).filter((item) => item.submissionId === mapSubmission.submissionId).length, 1);
  await setCachedValue("submissions:all", submissionsBeforeDuplicateCheck);
  const combinedMapFeed = await callEvents();
  assert.equal(combinedMapFeed.statusCode, 200);
  assert.equal(combinedMapFeed.payload.some((item) => item.submissionId === mapSubmission.submissionId && item.source === "user_submission"), true);
  assert.equal(combinedMapFeed.headers["X-Event-Count"], String(combinedMapFeed.payload.length));
  const mapUiSource = fs.readFileSync(path.join(__dirname, "..", "assets", "index", "main.mjs"), "utf8");
  assert.equal(mapUiSource.includes("publicationNotice"), true);
  assert.equal(mapUiSource.includes("report-submission"), true);
  assert.equal(mapUiSource.includes("/api/submissions?limit=500"), false);
  assert.equal(mapUiSource.includes("focusRequestedSubmission"), true);
  await updateSubmission(mapSubmission.submissionId, { status: "pending_admin" }, { action: "test" });
  assert.equal((await getPublicMapSubmissionEvents()).some((item) => item.submissionId === mapSubmission.submissionId), false);
  await updateSubmission(mapSubmission.submissionId, { status: "rejected" }, { action: "test" });
  assert.equal((await getPublicMapSubmissionEvents()).some((item) => item.submissionId === mapSubmission.submissionId), false);
  const noCoordinateSubmission = await createSubmission({ ...validInput("缺少座標投稿"), latitude: null, longitude: null });
  await updateSubmission(noCoordinateSubmission.submissionId, { status: "approved" }, { action: "test" });
  assert.equal((await getPublicMapSubmissionEvents()).some((item) => item.submissionId === noCoordinateSubmission.submissionId), false);

  // Submission reports: distinct reporters are required before an automatic temporary hide.
  await updateSubmission(mapSubmission.submissionId, { status: "approved", hiddenByReports: false }, { action: "test" });
  const firstReport = await call({ method: "POST", url: "/api/submission-reports", headers: { "x-forwarded-for": "reporter-one" }, body: { submissionId: mapSubmission.submissionId, reason: "information_incorrect", note: "資料疑似有誤" } });
  assert.equal(firstReport.statusCode, 201); assert.equal(firstReport.payload.hidden, false);
  const duplicateReport = await call({ method: "POST", url: "/api/submission-reports", headers: { "x-forwarded-for": "reporter-one" }, body: { submissionId: mapSubmission.submissionId, reason: "information_incorrect" } });
  assert.equal(duplicateReport.statusCode, 409);
  const secondReport = await call({ method: "POST", url: "/api/submission-reports", headers: { "x-forwarded-for": "reporter-two" }, body: { submissionId: mapSubmission.submissionId, reason: "duplicate" } });
  assert.equal(secondReport.statusCode, 201); assert.equal(secondReport.payload.hidden, true);
  const hiddenSubmission = (await listSubmissions({ limit: 1000 })).find((item) => item.submissionId === mapSubmission.submissionId);
  assert.equal(hiddenSubmission.status, "pending_admin"); assert.equal(hiddenSubmission.hiddenByReports, true);
  assert.equal((await getPublicMapSubmissionEvents()).some((item) => item.submissionId === mapSubmission.submissionId), false);
  assert.equal((await getAuditLog()).some((entry) => entry.submissionId === mapSubmission.submissionId && entry.action === "report_auto_hide"), true);
  const invalidReport = await call({ method: "POST", url: "/api/submission-reports", headers: { "x-forwarded-for": "reporter-three" }, body: { submissionId: mapSubmission.submissionId, reason: "invalid" } });
  assert.equal(invalidReport.statusCode, 400);

  // AI transport and schema failures always fall back to pending_admin; an AI approval flag never bypasses rules.
  const originalFetch = global.fetch; process.env.OPENAI_API_KEY = "test-key";
  async function postWithAiStub(ip, stub) { global.fetch = stub; return call({ method: "POST", headers: { "x-forwarded-for": ip }, body: validInput(`AI 測試 ${ip}`) }); }
  assert.equal((await postWithAiStub("ai-timeout", async () => { const error = new Error("timeout"); error.name = "AbortError"; throw error; })).payload.status, "pending_admin");
  assert.equal((await postWithAiStub("ai-http-error", async () => ({ ok: false, status: 500, json: async () => ({}) }))).payload.status, "pending_admin");
  assert.equal((await postWithAiStub("ai-non-json", async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "not-json" } }] }) }))).payload.status, "pending_admin");
  assert.equal((await postWithAiStub("ai-bad-schema", async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "{}" } }] }) }))).payload.status, "pending_admin");
  const unsafeAi = { risk_level: "low", location_valid: true, possible_duplicate: false, spam_probability: 0, credibility_score: 1, evidence_score: 1, missing_information: [], safety_flags: ["safety"], auto_publish_eligible: true };
  assert.equal((await postWithAiStub("ai-unsafe", async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(unsafeAi) } }] }) }))).payload.status, "pending_admin");
  const safeAi = { ...unsafeAi, safety_flags: [] };
  const autoApproved = await postWithAiStub("ai-safe", async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(safeAi) } }] }) }));
  assert.equal(autoApproved.payload.status, "approved");
  assert.equal(autoApproved.payload.latitude, 25.033);
  assert.equal(autoApproved.payload.longitude, 121.565);
  assert.equal(autoApproved.payload.publicationNotice, "使用者投稿｜尚未經官方證實");
  assert.equal(Object.hasOwn(autoApproved.payload, "aiReviewResult"), false);
  assert.equal(Object.hasOwn(autoApproved.payload, "contactInfo"), false);
  assert.equal(Object.hasOwn(autoApproved.payload, "reviewNote"), false);
  global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(safeAi) } }] }) });
  const aiClaimsLocationWithoutCoordinates = await call({ method: "POST", headers: { "x-forwarded-for": "ai-no-coordinates" }, body: { ...validInput("AI 聲稱位置有效但沒有座標"), latitude: null, longitude: null } });
  assert.equal(aiClaimsLocationWithoutCoordinates.statusCode, 201);
  assert.equal(aiClaimsLocationWithoutCoordinates.payload.status, "pending_admin");
  const outOfTaiwan = await call({ method: "POST", headers: { "x-forwarded-for": "coordinates-outside" }, body: { ...validInput("範圍外座標"), latitude: 35, longitude: 121.565 } });
  assert.equal(outOfTaiwan.statusCode, 400);
  global.fetch = originalFetch; process.env.OPENAI_API_KEY = "";
  assert.equal((await getAuditLog()).some((entry) => entry.action === "auto_approve"), true);
  assert.equal((await getAuditLog()).some((entry) => entry.action === "admin_approve"), true);

  const expiring = await createSubmission(validInput("即將失效投稿"));
  await updateSubmission(expiring.submissionId, { status: "approved", expirationTime: "2000-01-01T00:00:00.000Z" }, { action: "test" });
  await listSubmissions({ limit: 1000 });
  assert.equal((await listSubmissions({ limit: 1000 })).find((item) => item.submissionId === expiring.submissionId).status, "expired");
  assert.equal((await getPublicMapSubmissionEvents()).some((item) => item.submissionId === expiring.submissionId), false);
  assert.equal((await getAuditLog()).some((entry) => entry.submissionId === expiring.submissionId && entry.action === "auto_expire"), true);

  // Submission and report rate limits are independent and never disclose an IP value.
  for (let i = 0; i < 3; i += 1) assert.equal((await call({ method: "POST", headers: { "x-forwarded-for": "rate-submission" }, body: validInput(`限流投稿 ${i}`) })).statusCode, 201);
  const rateLimited = await call({ method: "POST", headers: { "x-forwarded-for": "rate-submission" }, body: validInput("限流投稿超額") });
  assert.equal(rateLimited.statusCode, 429); assert.equal(JSON.stringify(rateLimited.payload).includes("rate-submission"), false);
  for (let i = 0; i < 6; i += 1) await call({ method: "POST", url: "/api/submission-reports", headers: { "x-forwarded-for": "report-rate" }, body: { submissionId: mapSubmission.submissionId, reason: "other" } });
  const reportRateLimited = await call({ method: "POST", url: "/api/submission-reports", headers: { "x-forwarded-for": "report-rate" }, body: { submissionId: mapSubmission.submissionId, reason: "other" } });
  assert.equal(reportRateLimited.statusCode, 429);
  console.log("submission API tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
