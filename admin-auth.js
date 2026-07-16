function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function getQueryToken(req) {
  return String(req.query?.token || "").trim();
}

function isAuthorized(req) {
  const expected = String(process.env.REPORT_ADMIN_TOKEN || "").trim();
  if (!expected) return { ok: false, status: 503, error: "REPORT_ADMIN_TOKEN is not configured" };
  const supplied = getBearerToken(req) || getQueryToken(req);
  if (!supplied) return { ok: false, status: 401, error: "Unauthorized" };
  if (supplied !== expected) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
}

module.exports = {
  isAuthorized,
};
