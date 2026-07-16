const { isAuthorized } = require("../admin-auth");
const { getRefreshLog, getRefreshRunDetail } = require("../event-store");

function sendJson(res, status, payload) { return res.status(status).json(payload); }
function getQuery(req, key) { return String(req.query?.[key] || "").trim(); }
function parseLimit(value) { return Math.min(200, Math.max(1, Number.parseInt(value, 10) || 50)); }
function parseOffset(value) { return Math.max(0, Number.parseInt(value, 10) || 0); }
function validDate(value) { const ms = Date.parse(value); return Number.isFinite(ms) ? ms : null; }

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  if (!/^Bearer\s+\S+$/i.test(String(req.headers?.authorization || req.headers?.Authorization || ""))) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const auth = isAuthorized(req);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
  const status = getQuery(req, "status");
  const mode = getQuery(req, "mode");
  const runId = getQuery(req, "runId");
  if (getQuery(req, "detail") === "1") {
    const run = (await getRefreshLog()).find((entry) => entry.runId === runId);
    if (!run) return sendJson(res, 404, { error: "Refresh run not found" });
    return sendJson(res, 200, { run, details: await getRefreshRunDetail(runId) });
  }
  const dateFrom = validDate(getQuery(req, "dateFrom"));
  const dateTo = validDate(getQuery(req, "dateTo"));
  const filtered = (await getRefreshLog()).filter((entry) => {
    const startedAt = Date.parse(entry.startedAt);
    return (!status || entry.status === status)
      && (!mode || entry.mode === mode)
      && (!runId || entry.runId.includes(runId))
      && (dateFrom === null || startedAt >= dateFrom)
      && (dateTo === null || startedAt <= dateTo + (getQuery(req, "dateTo").length === 10 ? 86399999 : 0));
  });
  const limit = parseLimit(getQuery(req, "limit"));
  const offset = parseOffset(getQuery(req, "offset"));
  return sendJson(res, 200, { logs: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset });
};
