require("dotenv").config();

const { runEventRefresh } = require("../event-refresh");
const { acquireCronLock, releaseCronLock, appendRefreshLog } = require("../event-store");

function sendJson(res, status, payload) {
  return res.status(status).json(payload);
}

function getAuthHeader(req) {
  return String(req.headers?.authorization || req.headers?.Authorization || "").trim();
}

function isAuthorized(req) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  return getAuthHeader(req) === `Bearer ${secret}`;
}

function getMode(req) {
  const mode = String(req.query?.mode || req.body?.mode || "all").trim();
  return ["news", "traffic", "all"].includes(mode) ? mode : "all";
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }
  if (!isAuthorized(req)) {
    console.warn("[cron] Unauthorized trigger attempt");
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const startedAt = Date.now();
  const runId = `cron-${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const mode = getMode(req);
  const lockResult = await acquireCronLock({ owner: runId });

  if (!lockResult.acquired) {
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAt;
    await appendRefreshLog({ runId, trigger: "scheduled", mode, status: "skipped", skippedReason: "cron_lock", startedAt: new Date(startedAt).toISOString(), completedAt, durationMs });
    return sendJson(res, 200, {
      success: true,
      skippedByLock: true,
      runId,
      durationMs,
      sourceCounts: {},
      geocodingHits: 0,
      lock: lockResult.lock,
    });
  }

  try {
    const result = await runEventRefresh({ runId, mode, startedAt, trigger: "scheduled" });
    const { events, ...summary } = result;
    return sendJson(res, 200, {
      ...summary,
      skippedByLock: false,
    });
  } catch (error) {
    console.error("[cron] Handler failed:", error.message);
    return sendJson(res, 500, {
      success: false,
      skippedByLock: false,
      runId,
      durationMs: Date.now() - startedAt,
      error: "Cron execution failed",
    });
  } finally {
    await releaseCronLock(runId);
  }
};

module.exports.isAuthorized = isAuthorized;
