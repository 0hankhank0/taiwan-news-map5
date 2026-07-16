const crypto = require("crypto");
const { isAuthorized } = require("../admin-auth");
const { SUBMISSION_STATUSES, createSubmission, listSubmissions, updateSubmission, addSubmissionReport, getSubmissionReportSummary, getAuditLog } = require("../submission-store");
const { getCachedValue, setCachedValue, getCachedEvents } = require("../event-store");

const CATEGORIES = new Set(["activity", "traffic", "construction", "public_facility", "disaster", "police", "social", "life", "other"]);
const RATE_WINDOW_SECONDS = 60 * 60;
const RATE_LIMIT = 3;
const REPORT_RATE_LIMIT = Number(process.env.SUBMISSION_REPORT_RATE_LIMIT || 6);
const REPORT_HIDE_THRESHOLD = Math.max(2, Number(process.env.SUBMISSION_REPORT_HIDE_THRESHOLD || 2));
const REPORT_REASONS = new Set(["information_incorrect", "expired", "duplicate", "spam", "inappropriate", "wrong_location", "other"]);
const text = (value, max) => String(value || "").trim().slice(0, max);
const validUrl = (value) => { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; } };
function clientKey(req) { return crypto.createHash("sha256").update(String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")).digest("hex").slice(0, 24); }
async function checkRate(req) {
  const key = `submission:rate:${clientKey(req)}`;
  const count = Number(await getCachedValue(key) || 0);
  if (count >= RATE_LIMIT) return false;
  await setCachedValue(key, count + 1, { ex: RATE_WINDOW_SECONDS });
  return true;
}
async function checkReportRate(req) {
  const key = `submission-report:rate:${clientKey(req)}`;
  const count = Number(await getCachedValue(key) || 0);
  if (count >= REPORT_RATE_LIMIT) return false;
  await setCachedValue(key, count + 1, { ex: RATE_WINDOW_SECONDS });
  return true;
}
function normalizeInput(body) {
  const title = text(body.title, 160), description = text(body.description, 2000), category = text(body.category, 40);
  const latitude = body.latitude === "" || body.latitude === undefined ? null : Number(body.latitude);
  const longitude = body.longitude === "" || body.longitude === undefined ? null : Number(body.longitude);
  const sourceUrl = text(body.sourceUrl, 500);
  const evidenceUrls = Array.isArray(body.evidenceUrls) ? body.evidenceUrls.map((url) => text(url, 500)).filter(validUrl).slice(0, 3) : [];
  if (title.length < 4 || description.length < 10 || !CATEGORIES.has(category)) throw new Error("Invalid title, description, or category");
  if ((latitude !== null || longitude !== null) && (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < 20 || latitude > 27 || longitude < 118 || longitude > 123)) throw new Error("Coordinates must be in Taiwan");
  if (sourceUrl && !validUrl(sourceUrl)) throw new Error("Invalid source URL");
  return { title, description, category, eventStartTime: text(body.eventStartTime, 40) || null, eventEndTime: text(body.eventEndTime, 40) || null, address: text(body.address, 240), latitude, longitude, sourceUrl, contactInfo: text(body.contactInfo, 200), evidenceUrls };
}
function automaticExpiration(submission) {
  const created = Date.parse(submission.createdAt) || Date.now();
  const startsAt = Date.parse(submission.eventStartTime || "");
  const endsAt = Date.parse(submission.eventEndTime || "");
  if (Number.isFinite(endsAt)) return new Date(endsAt + 2 * 60 * 60 * 1000).toISOString();
  if (submission.category === "traffic") return new Date(created + 24 * 60 * 60 * 1000).toISOString();
  if (["construction", "public_facility"].includes(submission.category)) return new Date(created + 72 * 60 * 60 * 1000).toISOString();
  if (submission.category === "activity") return new Date((Number.isFinite(startsAt) ? startsAt : created) + 24 * 60 * 60 * 1000).toISOString();
  return null;
}
function comparableTitle(value) { return text(value, 160).toLowerCase().replace(/\s+/g, "").slice(0, 24); }
async function findPossibleDuplicate(submission) {
  const key = comparableTitle(submission.title);
  if (!key) return false;
  const [events, submissions] = await Promise.all([getCachedEvents(), listSubmissions({ limit: 1000 })]);
  return [...events, ...submissions].some((item) => item.submissionId !== submission.submissionId && comparableTitle(item.title) === key && (!submission.address || !item.address || text(item.address, 240) === submission.address));
}
function decidePublication(submission, analysis, isDuplicate) {
  const missing = Array.isArray(analysis.missing_information) ? analysis.missing_information.length > 0 : true;
  const safe = analysis.risk_level === "low" && analysis.location_valid === true && !analysis.possible_duplicate && !isDuplicate && Number(analysis.spam_probability) < 0.1 && Number(analysis.credibility_score) >= 0.8 && Number(analysis.evidence_score) >= 0.6 && !missing && (!Array.isArray(analysis.safety_flags) || analysis.safety_flags.length === 0);
  return safe
    ? { status: "approved", approvalMethod: "auto", riskLevel: "low", publicationNotice: "\u4f7f\u7528\u8005\u6295\u7a3f\uff5c\u5c1a\u672a\u7d93\u5b98\u65b9\u8b49\u5be6" }
    : { status: "pending_admin", approvalMethod: null, riskLevel: ["low", "medium", "high"].includes(analysis.risk_level) ? analysis.risk_level : "medium", publicationNotice: null };
}
function publicSubmission(submission) {
  const { contactInfo, aiReviewResult, reviewNote, reportSummary, previousStatus, hiddenByReports, reportHiddenAt, ...safe } = submission;
  return safe;
}
function isSubmissionReportRoute(req) {
  return req.query?.submissionReports === "1" || String(req.url || "").includes("/api/submission-reports");
}
function isSubmissionAuditLogRoute(req) {
  return req.query?.auditLog === "1" || String(req.url || "").includes("/api/submission-audit-log");
}
const AUDIT_LOG_MAX_LIMIT = 200;
const AUDIT_LOG_DEFAULT_LIMIT = 50;
function auditInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`Invalid ${name}`);
  return Number(value);
}
function auditDate(value, name, endOfDay = false) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/.test(raw)) throw new Error(`Invalid ${name}`);
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid ${name}`);
  return endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? timestamp + 86400000 - 1 : timestamp;
}
function publicAuditLogEntry(entry) {
  return {
    auditId: text(entry.auditId, 100), actionTime: text(entry.actionTime, 40), action: text(entry.action, 80),
    actorRole: text(entry.actorRole, 40), submissionId: text(entry.submissionId, 100),
    previousStatus: text(entry.previousStatus, 40), newStatus: text(entry.newStatus, 40),
    changedFields: Array.isArray(entry.changedFields) ? entry.changedFields.map((field) => text(field, 80)).filter(Boolean).slice(0, 30) : [],
    reviewNote: text(entry.reviewNote, 1000), requestId: text(entry.requestId, 120),
  };
}
async function handleSubmissionAuditLog(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const auth = isAuthorized(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  try {
    const limit = Math.min(AUDIT_LOG_MAX_LIMIT, Math.max(1, auditInteger(req.query?.limit, AUDIT_LOG_DEFAULT_LIMIT, "limit")));
    const offset = auditInteger(req.query?.offset, 0, "offset");
    const action = text(req.query?.action, 80), submissionId = text(req.query?.submissionId, 100), actorRole = text(req.query?.actorRole, 40);
    const dateFrom = auditDate(req.query?.dateFrom, "dateFrom"), dateTo = auditDate(req.query?.dateTo, "dateTo", true);
    if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) throw new Error("Invalid date range");
    const logs = (await getAuditLog()).map(publicAuditLogEntry).filter((entry) => {
      const time = Date.parse(entry.actionTime);
      return (!action || entry.action === action) && (!submissionId || entry.submissionId === submissionId)
        && (!actorRole || entry.actorRole === actorRole) && (dateFrom === null || (Number.isFinite(time) && time >= dateFrom))
        && (dateTo === null || (Number.isFinite(time) && time <= dateTo));
    }).sort((a, b) => Date.parse(b.actionTime) - Date.parse(a.actionTime));
    return res.status(200).json({ logs: logs.slice(offset, offset + limit), total: logs.length, limit, offset });
  } catch (error) { return res.status(400).json({ error: error.message || "Invalid query" }); }
}
async function handleSubmissionReport(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await checkReportRate(req))) return res.status(429).json({ error: "Too many reports; try again later" });
  const submissionId = text(req.body?.submissionId, 80);
  const reason = text(req.body?.reason, 40);
  const note = text(req.body?.note, 500);
  if (!submissionId || !REPORT_REASONS.has(reason)) return res.status(400).json({ error: "Invalid submissionId or reason" });
  const submissions = await listSubmissions({ limit: 1000 });
  const submission = submissions.find((item) => item.submissionId === submissionId);
  if (!submission) return res.status(404).json({ error: "Submission not found" });
  if (submission.status !== "approved" || submission.hiddenByReports) return res.status(409).json({ error: "Submission is not reportable" });
  const reporterHash = clientKey(req);
  const duplicateKey = `submission-report:duplicate:${submissionId}:${reporterHash}`;
  if (await getCachedValue(duplicateKey)) return res.status(409).json({ error: "You already reported this submission" });
  await setCachedValue(duplicateKey, true, { ex: 60 * 60 * 24 * 30 });
  await addSubmissionReport({ reportId: `srep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, submissionId, reporterHash, reason, note, createdAt: new Date().toISOString() });
  const summary = await getSubmissionReportSummary(submissionId);
  let hidden = false;
  if (!submission.hiddenByReports && submission.status === "approved" && summary.reporterCount >= REPORT_HIDE_THRESHOLD) {
    await updateSubmission(submissionId, {
      status: "pending_admin", previousStatus: submission.status, hiddenByReports: true,
      reportHiddenAt: new Date().toISOString(), reportSummary: summary,
    }, { action: "report_auto_hide", role: "system" });
    hidden = true;
  }
  return res.status(201).json({ success: true, hidden, reportCount: summary.count });
}
function fallbackReview(submission) {
  const hasLocation = Number.isFinite(submission.latitude) && Number.isFinite(submission.longitude) || Boolean(submission.address);
  const suspicious = /(免費送彩金|line\s*id|賭博|色情)/i.test(`${submission.title} ${submission.description}`);
  return { suggested_title: submission.title, suggested_summary: submission.description.slice(0, 300), suggested_category: submission.category, location_valid: hasLocation, possible_duplicate: false, duplicate_event_ids: [], spam_probability: suspicious ? 0.9 : 0.05, safety_flags: [], credibility_score: hasLocation ? 0.65 : 0.4, missing_information: hasLocation ? [] : ["location"], recommendation: suspicious ? "reject" : "needs_human_review", moderation_reason: suspicious ? "spam-pattern" : "AI provider unavailable; requires human review", risk_level: suspicious ? "high" : "medium", evidence_score: submission.evidenceUrls.length ? 0.7 : 0.3, auto_publish_eligible: false, suggested_expiration_time: submission.expirationTime || null };
}
function hasValidAnalysisSchema(value) {
  return value && typeof value === "object"
    && ["low", "medium", "high"].includes(value.risk_level)
    && typeof value.location_valid === "boolean"
    && typeof value.possible_duplicate === "boolean"
    && Array.isArray(value.missing_information)
    && Array.isArray(value.safety_flags)
    && Number.isFinite(Number(value.spam_probability))
    && Number.isFinite(Number(value.credibility_score))
    && Number.isFinite(Number(value.evidence_score));
}
async function moderate(submission) {
  const fallback = fallbackReview(submission);
  const key = text(process.env.OPENAI_API_KEY, 300);
  if (!key) return fallback;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.SUBMISSION_AI_MODEL || "gpt-4o-mini", temperature: 0, response_format: { type: "json_object" }, messages: [
        { role: "system", content: "You analyse Taiwan public event submissions. Return JSON only with: suggested_title, suggested_summary, suggested_category, location_valid, possible_duplicate, duplicate_event_ids, spam_probability (0-1), safety_flags, credibility_score (0-1), missing_information, moderation_reason, risk_level (low|medium|high), evidence_score (0-1), suggested_expiration_time. Never decide publication status or approval method. Never invent facts." },
        { role: "user", content: JSON.stringify(submission) },
      ] }),
    });
    if (!response.ok) throw new Error(`AI HTTP ${response.status}`);
    const content = (await response.json())?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);
    if (!hasValidAnalysisSchema(parsed)) throw new Error("AI returned invalid moderation schema");
    return { ...fallback, ...parsed, risk_level: ["low", "medium", "high"].includes(parsed.risk_level) ? parsed.risk_level : fallback.risk_level, spam_probability: Math.max(0, Math.min(1, Number(parsed.spam_probability) || 0)), credibility_score: Math.max(0, Math.min(1, Number(parsed.credibility_score) || 0)), evidence_score: Math.max(0, Math.min(1, Number(parsed.evidence_score) || 0)) };
  } catch (error) {
    console.warn("[submission] AI moderation unavailable:", error.name === "AbortError" ? "timeout" : error.message);
    return fallback;
  } finally { clearTimeout(timer); }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization"); res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (isSubmissionAuditLogRoute(req)) return handleSubmissionAuditLog(req, res);
  if (isSubmissionReportRoute(req)) return handleSubmissionReport(req, res);
  const admin = isAuthorized(req).ok;
  if (req.method === "GET") {
    const status = text(req.query?.status, 30);
    if (status && !SUBMISSION_STATUSES.has(status)) return res.status(400).json({ error: "Invalid status" });
    const submissions = await listSubmissions({ status: admin ? status : "approved", publicOnly: !admin, limit: req.query?.limit });
    if (admin) await Promise.all(submissions.map(async (submission) => {
      submission.reportSummary = await getSubmissionReportSummary(submission.submissionId);
    }));
    return res.status(200).json({ submissions: admin ? submissions : submissions.map(publicSubmission), total: submissions.length });
  }
  if (req.method === "POST") {
    if (!(await checkRate(req))) return res.status(429).json({ error: "Too many submissions; try again later" });
    try {
      const submission = await createSubmission(normalizeInput(req.body || {}));
      const aiReviewResult = await moderate(submission);
      const publication = decidePublication(submission, aiReviewResult, await findPossibleDuplicate(submission));
      const updated = await updateSubmission(submission.submissionId, { aiReviewResult, ...publication, expirationTime: automaticExpiration(submission) }, { action: publication.status === "approved" ? "auto_approve" : "rules_engine" });
      return res.status(201).json({ success: true, submissionId: updated.submissionId, status: updated.status });
    } catch (error) { return res.status(400).json({ error: error.message || "Invalid submission" }); }
  }
  if (req.method === "PATCH") {
    const auth = isAuthorized(req); if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const id = text(req.query?.submissionId || req.body?.submissionId, 80), status = text(req.body?.status, 30);
    if (!id || !SUBMISSION_STATUSES.has(status)) return res.status(400).json({ error: "Missing submissionId or invalid status" });
    const existing = (await listSubmissions({ limit: 1000 })).find((item) => item.submissionId === id);
    const restoring = status === "approved" && Boolean(existing?.hiddenByReports);
    const patch = { status, reviewNote: text(req.body.reviewNote, 1000), approvalMethod: status === "approved" ? "admin" : null };
    if (restoring) Object.assign(patch, { hiddenByReports: false, reportHiddenAt: null, previousStatus: null });
    const action = status === "approved" ? (restoring ? "admin_restore_publish" : "admin_approve") : status === "rejected" ? "admin_reject" : "admin_update";
    const submission = await updateSubmission(id, patch, { id: "admin", role: "admin", action });
    return submission ? res.status(200).json({ success: true, submission }) : res.status(404).json({ error: "Submission not found" });
  }
  return res.status(405).json({ error: "Method not allowed" });
};

module.exports.decidePublication = decidePublication;
module.exports.automaticExpiration = automaticExpiration;
module.exports.REPORT_REASONS = REPORT_REASONS;
