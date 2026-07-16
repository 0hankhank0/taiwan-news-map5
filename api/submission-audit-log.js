const { isAuthorized } = require("../admin-auth");
const { getAuditLog } = require("../submission-store");

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const text = (value, max) => String(value || "").trim().slice(0, max);

function integer(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`Invalid ${name}`);
  return Number(value);
}

function parseDate(value, name, endOfDay = false) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/.test(raw)) throw new Error(`Invalid ${name}`);
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid ${name}`);
  return endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? timestamp + 86400000 - 1 : timestamp;
}

function publicLog(entry) {
  return {
    auditId: text(entry.auditId, 100),
    actionTime: text(entry.actionTime, 40),
    action: text(entry.action, 80),
    actorRole: text(entry.actorRole, 40),
    submissionId: text(entry.submissionId, 100),
    previousStatus: text(entry.previousStatus, 40),
    newStatus: text(entry.newStatus, 40),
    changedFields: Array.isArray(entry.changedFields) ? entry.changedFields.map((field) => text(field, 80)).filter(Boolean).slice(0, 30) : [],
    reviewNote: text(entry.reviewNote, 1000),
    requestId: text(entry.requestId, 120),
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const auth = isAuthorized(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    const limit = Math.min(MAX_LIMIT, Math.max(1, integer(req.query?.limit, DEFAULT_LIMIT, "limit")));
    const offset = integer(req.query?.offset, 0, "offset");
    const action = text(req.query?.action, 80);
    const submissionId = text(req.query?.submissionId, 100);
    const actorRole = text(req.query?.actorRole, 40);
    const dateFrom = parseDate(req.query?.dateFrom, "dateFrom");
    const dateTo = parseDate(req.query?.dateTo, "dateTo", true);
    if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) throw new Error("Invalid date range");

    const logs = (await getAuditLog())
      .map(publicLog)
      .filter((entry) => {
        const time = Date.parse(entry.actionTime);
        return (!action || entry.action === action)
          && (!submissionId || entry.submissionId === submissionId)
          && (!actorRole || entry.actorRole === actorRole)
          && (dateFrom === null || (Number.isFinite(time) && time >= dateFrom))
          && (dateTo === null || (Number.isFinite(time) && time <= dateTo));
      })
      .sort((a, b) => Date.parse(b.actionTime) - Date.parse(a.actionTime));
    return res.status(200).json({ logs: logs.slice(offset, offset + limit), total: logs.length, limit, offset });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Invalid query" });
  }
};
