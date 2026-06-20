const { getCachedValue, setCachedValue } = require("./event-store");

const REPORTS_ALL_KEY = "reports:all";
const REPORTS_MAX_ITEMS = Number(process.env.REPORTS_MAX_ITEMS || 1000);
const TRACKED_PUBLIC_STATUSES = new Set(["new", "ai_reviewed", "accepted", "resolved"]);
const REPORT_STATUSES = new Set(["new", "ai_reviewed", "accepted", "rejected", "resolved"]);

function getReportsByEventKey(eventId) {
  return `reports:by-event:${String(eventId || "").trim()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeReportList(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

async function readAllReports() {
  return normalizeReportList(await getCachedValue(REPORTS_ALL_KEY));
}

async function writeAllReports(reports) {
  const nextReports = normalizeReportList(reports)
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))
    .slice(0, REPORTS_MAX_ITEMS);
  await setCachedValue(REPORTS_ALL_KEY, nextReports);
  return nextReports;
}

async function readEventReportIds(eventId) {
  if (!eventId) return [];
  const value = await getCachedValue(getReportsByEventKey(eventId));
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

async function writeEventReportIds(eventId, reportIds) {
  if (!eventId) return;
  const uniqueIds = [...new Set((reportIds || []).map(String).filter(Boolean))].slice(0, REPORTS_MAX_ITEMS);
  await setCachedValue(getReportsByEventKey(eventId), uniqueIds);
}

function createReportId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `rpt_${Date.now().toString(36)}_${random}`;
}

function sortReportsForReview(reports) {
  const statusPriority = { new: 0, ai_reviewed: 1, accepted: 2, resolved: 3, rejected: 4 };
  return [...reports].sort((a, b) => {
    const aValidReports = Number(a.validReportCount || 0);
    const bValidReports = Number(b.validReportCount || 0);
    if (aValidReports !== bValidReports) return bValidReports - aValidReports;
    const aPriority = statusPriority[a.status] ?? 9;
    const bPriority = statusPriority[b.status] ?? 9;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "");
  });
}

async function addEventReportCounts(reports) {
  const validCounts = await getPublicReportSummary();
  return reports.map((report) => ({
    ...report,
    validReportCount: validCounts.byEvent[String(report.eventId)] || 0,
  }));
}

async function createReport(input) {
  const timestamp = nowIso();
  const report = {
    reportId: input.reportId || createReportId(),
    eventId: String(input.eventId || "").trim(),
    title: String(input.title || "").trim(),
    eventSnapshot: input.eventSnapshot || null,
    errorType: String(input.errorType || "").trim(),
    message: String(input.message || "").trim(),
    aiReview: input.aiReview || {
      status: "unclear",
      summary: "AI review not available.",
      suggestedAction: "needs_human_review",
      confidence: 0,
    },
    status: REPORT_STATUSES.has(input.status) ? input.status : "new",
    adminNote: input.adminNote || "",
    createdAt: input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp,
    resolvedAt: input.resolvedAt || null,
  };

  const reports = await readAllReports();
  reports.unshift(report);
  await writeAllReports(reports);

  const eventReportIds = await readEventReportIds(report.eventId);
  await writeEventReportIds(report.eventId, [report.reportId, ...eventReportIds]);

  return report;
}

async function getReports(filters = {}) {
  let reports = await readAllReports();
  if (filters.status) reports = reports.filter((report) => report.status === filters.status);
  if (filters.eventId) reports = reports.filter((report) => String(report.eventId) === String(filters.eventId));
  reports = await addEventReportCounts(reports);
  return sortReportsForReview(reports);
}

async function getReport(reportId) {
  const reports = await readAllReports();
  return reports.find((report) => String(report.reportId) === String(reportId)) || null;
}

async function updateReport(reportId, patch = {}) {
  const reports = await readAllReports();
  const index = reports.findIndex((report) => String(report.reportId) === String(reportId));
  if (index < 0) return null;

  const current = reports[index];
  const nextStatus = patch.status && REPORT_STATUSES.has(patch.status) ? patch.status : current.status;
  const shouldStampResolved = ["accepted", "rejected", "resolved"].includes(nextStatus);
  const next = {
    ...current,
    status: nextStatus,
    adminNote: typeof patch.adminNote === "string" ? patch.adminNote : current.adminNote,
    updatedAt: nowIso(),
    resolvedAt: shouldStampResolved ? (current.resolvedAt || nowIso()) : null,
  };

  reports[index] = next;
  await writeAllReports(reports);
  return next;
}

async function getPublicReportSummary() {
  const reports = await readAllReports();
  const byEvent = {};
  for (const report of reports) {
    if (!report.eventId || !TRACKED_PUBLIC_STATUSES.has(report.status)) continue;
    const eventId = String(report.eventId);
    byEvent[eventId] = (byEvent[eventId] || 0) + 1;
  }
  return { byEvent, total: reports.length };
}

module.exports = {
  REPORTS_ALL_KEY,
  REPORT_STATUSES,
  createReport,
  getReport,
  getReports,
  getPublicReportSummary,
  getReportsByEventKey,
  updateReport,
};
