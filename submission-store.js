const { getCachedValue, setCachedValue } = require("./event-store");

const SUBMISSIONS_KEY = "submissions:all";
const AUDIT_LOG_KEY = "submissions:audit-log";
const SUBMISSION_REPORTS_KEY = "submissions:reports";
const MAX_ITEMS = 1000;
const SUBMISSION_STATUSES = new Set(["pending_ai", "pending_admin", "needs_revision", "approved", "rejected", "expired"]);

function id(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
function safeList(value) { return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : []; }
async function readAll() { return safeList(await getCachedValue(SUBMISSIONS_KEY)); }
async function writeAll(items) {
  const next = safeList(items).sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "")).slice(0, MAX_ITEMS);
  await setCachedValue(SUBMISSIONS_KEY, next);
  return next;
}
async function createSubmission(input) {
  const now = new Date().toISOString();
  const submission = { ...input, submissionId: id("sub"), status: "pending_ai", approvalMethod: null, riskLevel: "medium", aiReviewResult: null, createdAt: now, updatedAt: now, publishedAt: null };
  await writeAll([submission, ...(await readAll())]);
  return submission;
}
async function listSubmissions({ status, publicOnly = false, limit = 100 } = {}) {
  let items = await readAll();
  const now = Date.now();
  let changed = false;
  const expired = [];
  items = items.map((item) => {
    if (item.status === "approved" && item.expirationTime && Date.parse(item.expirationTime) <= now) {
      changed = true;
      expired.push(item);
      return { ...item, status: "expired", updatedAt: new Date(now).toISOString() };
    }
    return item;
  });
  if (changed) {
    await writeAll(items);
    const logs = safeList(await getCachedValue(AUDIT_LOG_KEY));
    const entries = expired.map((item) => ({
      auditId: id("audit"), actorId: "system", actorRole: "system", action: "auto_expire",
      submissionId: item.submissionId, actionTime: new Date(now).toISOString(), previousStatus: "approved",
      newStatus: "expired", changedFields: ["status"], reviewNote: "", requestId: "",
    }));
    await setCachedValue(AUDIT_LOG_KEY, [...entries, ...logs].slice(0, MAX_ITEMS));
  }
  if (publicOnly) items = items.filter((item) => item.status === "approved");
  if (status) items = items.filter((item) => item.status === status);
  return items.slice(0, Math.max(1, Math.min(MAX_ITEMS, Number(limit) || 100)));
}
function hasValidTaiwanCoordinates(lat, lng) {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
    && Number(lat) >= 21.5 && Number(lat) <= 26.5 && Number(lng) >= 118 && Number(lng) <= 122.5;
}
async function getPublicMapSubmissionEvents() {
  const submissions = await listSubmissions({ publicOnly: true, limit: MAX_ITEMS });
  const seenSubmissionIds = new Set();
  return submissions
    .filter((submission) => {
      if (!submission?.submissionId || seenSubmissionIds.has(submission.submissionId)) return false;
      seenSubmissionIds.add(submission.submissionId);
      return !submission.hiddenByReports && hasValidTaiwanCoordinates(submission.latitude, submission.longitude);
    })
    .map((submission) => ({
      id: `submission:${submission.submissionId}`,
      submissionId: submission.submissionId,
      title: submission.title,
      content: submission.description,
      summary: submission.description,
      category: submission.category,
      address: submission.address,
      lat: Number(submission.latitude),
      lng: Number(submission.longitude),
      source: "user_submission",
      sourceName: "User submission",
      sourceUrl: submission.sourceUrl || "",
      url: submission.sourceUrl || "",
      startsAt: submission.eventStartTime || null,
      endsAt: submission.eventEndTime || null,
      expiresAt: submission.expirationTime || null,
      status: "approved",
      approvalMethod: submission.approvalMethod,
      riskLevel: submission.riskLevel,
      publicationNotice: submission.publicationNotice || "\u4f7f\u7528\u8005\u6295\u7a3f\uff5c\u5c1a\u672a\u7d93\u5b98\u65b9\u8b49\u5be6",
      publishedAt: submission.publishedAt || submission.createdAt,
      updatedAt: submission.updatedAt,
      createdAt: submission.createdAt,
      locationPrecision: "exact",
      locationQuality: "high",
      locationDisplayMode: "point",
      locationConfidence: 1,
    }));
}
async function readSubmissionReports() { return safeList(await getCachedValue(SUBMISSION_REPORTS_KEY)); }
async function getSubmissionReportSummary(submissionId) {
  const reports = (await readSubmissionReports()).filter((report) => report.submissionId === submissionId);
  return {
    count: reports.length,
    reporterCount: new Set(reports.map((report) => report.reporterHash)).size,
    reasons: [...new Set(reports.map((report) => report.reason))],
    reportedAt: reports.map((report) => report.createdAt),
  };
}
async function addSubmissionReport(report) {
  const reports = await readSubmissionReports();
  reports.unshift(report);
  await setCachedValue(SUBMISSION_REPORTS_KEY, reports.slice(0, MAX_ITEMS));
  return report;
}
async function getAuditLog() { return safeList(await getCachedValue(AUDIT_LOG_KEY)); }
async function updateSubmission(submissionId, patch, actor = {}) {
  const items = await readAll();
  const index = items.findIndex((item) => item.submissionId === submissionId);
  if (index < 0) return null;
  const previous = items[index];
  const next = { ...previous, ...patch, updatedAt: new Date().toISOString() };
  if (next.status === "approved" && !next.publishedAt) next.publishedAt = next.updatedAt;
  items[index] = next;
  await writeAll(items);
  const logs = safeList(await getCachedValue(AUDIT_LOG_KEY));
  await setCachedValue(AUDIT_LOG_KEY, [{ auditId: id("audit"), actorId: actor.id || "system", actorRole: actor.role || "system", action: actor.action || "update", submissionId, actionTime: next.updatedAt, previousStatus: previous.status, newStatus: next.status, changedFields: Object.keys(patch), reviewNote: String(patch.reviewNote || ""), requestId: actor.requestId || "" }, ...logs].slice(0, MAX_ITEMS));
  return next;
}

module.exports = {
  SUBMISSION_STATUSES, createSubmission, listSubmissions, updateSubmission,
  getPublicMapSubmissionEvents, getSubmissionReportSummary, addSubmissionReport, getAuditLog,
  hasValidTaiwanCoordinates,
};
