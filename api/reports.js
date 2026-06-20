const { REPORT_STATUSES, getReports, updateReport } = require("../report-store");

function sendJson(res, status, payload) {
  return res.status(status).json(payload);
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function getQueryToken(req) {
  return String(req.query?.token || "").trim();
}

function isAuthorized(req) {
  const expected = process.env.REPORT_ADMIN_TOKEN;
  if (!expected) return { ok: false, status: 503, error: "REPORT_ADMIN_TOKEN is not configured" };
  const supplied = getBearerToken(req) || getQueryToken(req);
  if (supplied !== expected) return { ok: false, status: 401, error: "Unauthorized" };
  return { ok: true };
}

function getBody(req) {
  return req.body && typeof req.body === "object" ? req.body : {};
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();

  const auth = isAuthorized(req);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });

  if (req.method === "GET") {
    const status = String(req.query?.status || "").trim();
    const eventId = String(req.query?.eventId || "").trim();
    const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 100)));
    if (status && !REPORT_STATUSES.has(status)) {
      return sendJson(res, 400, { error: "Invalid status" });
    }
    const reports = await getReports({ status: status || undefined, eventId: eventId || undefined });
    return sendJson(res, 200, { reports: reports.slice(0, limit), total: reports.length });
  }

  if (req.method === "PATCH") {
    const body = getBody(req);
    const reportId = String(req.query?.reportId || req.params?.reportId || body.reportId || "").trim();
    if (!reportId) return sendJson(res, 400, { error: "Missing reportId" });

    const status = body.status ? String(body.status).trim() : undefined;
    if (status && !REPORT_STATUSES.has(status)) {
      return sendJson(res, 400, { error: "Invalid status" });
    }

    const report = await updateReport(reportId, {
      status,
      adminNote: typeof body.adminNote === "string" ? body.adminNote : undefined,
    });

    if (!report) return sendJson(res, 404, { error: "Report not found" });
    return sendJson(res, 200, { success: true, report });
  }

  return sendJson(res, 405, { error: "Method not allowed" });
};
