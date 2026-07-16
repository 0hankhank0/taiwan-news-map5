const adminEvents = require("../admin-handlers/events");
const health = require("../admin-handlers/health");
const reports = require("../admin-handlers/reports");
const refreshLog = require("../admin-handlers/refresh-log");

function routeType(req) {
  const route = String(req.query?.adminRoute || "").trim();
  if (route) return route;
  const pathname = String(req.path || req.url || "").split("?")[0];
  if (pathname.endsWith("/admin-events")) return "events";
  if (pathname.endsWith("/health")) return "health";
  if (pathname.endsWith("/refresh-log")) return "refresh-log";
  if (pathname.startsWith("/api/reports")) return "reports";
  return "";
}

module.exports = async (req, res) => {
  const type = routeType(req);
  if (type === "events") return adminEvents(req, res);
  if (type === "health") return health(req, res);
  if (type === "refresh-log") return refreshLog(req, res);
  if (type === "reports") return reports(req, res);
  return res.status(404).json({ error: "Admin route not found" });
};
