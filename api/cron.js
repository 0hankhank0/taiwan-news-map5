process.on("warning", (warning) => {
  if (warning?.code === "DEP0169") {
    console.error("[DEP0169 diagnostic]", {
      name: warning.name,
      code: warning.code,
      message: warning.message,
      stack: warning.stack,
    });
  }
});

if (!process.env.VERCEL) {
  require("dotenv").config({ quiet: true });
}

const { runEventRefresh } = require("../event-refresh");
const { acquireCronLock, releaseCronLock, appendRefreshLog, saveRefreshRunDetail } = require("../event-store");

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
  // Avoid req.query's legacy getter, which can invoke url.parse (DEP0169).
  const base = `https://${req.headers?.host || "localhost"}`;
  const queryMode = new URL(req.url || "/", base).searchParams.get("mode");
  // Test/local adapters may provide a plain data property. Reading its
  // descriptor is safe; it deliberately refuses an accessor getter.
  const queryValue = Object.getOwnPropertyDescriptor(req, "query")?.value;
  const mode = String(queryMode || queryValue?.mode || req.body?.mode || "news").trim();
  // Unknown/manual values use the safe news-only compatibility default.
  return ["news", "traffic"].includes(mode) ? mode : "news";
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
  let lockResult;
  try {
    lockResult = await acquireCronLock({ owner: runId });
  } catch (error) {
    console.error("[cron] Lock acquisition failed:", error.message);
    return sendJson(res, 503, {
      success: false,
      skippedByLock: false,
      runId,
      durationMs: Date.now() - startedAt,
      error: "Cron lock unavailable",
    });
  }

  if (!lockResult.acquired && lockResult.reason === "coordination_unavailable") {
    return sendJson(res, 503, {
      success: false,
      skippedByLock: false,
      runId,
      durationMs: Date.now() - startedAt,
      error: "Cron lock unavailable",
    });
  }

  if (!lockResult.acquired) {
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAt;
    try {
      await appendRefreshLog({ runId, trigger: "scheduled", mode, status: "skipped", skippedReason: "cron_lock", startedAt: new Date(startedAt).toISOString(), completedAt, durationMs });
    } catch (error) {
      console.warn("[cron] skipped-run log write failed", { code: String(error?.code || "telemetry_error").slice(0, 80) });
    }
    try {
      await saveRefreshRunDetail({ runId, trigger: "scheduled", mode, status: "skipped", startedAt: new Date(startedAt).toISOString(), completedAt, cacheWritten: false, error: "已有排程執行中", sources: {}, pipeline: {}, finalEvents: [] });
    } catch (error) {
      console.warn("[cron] skipped-run detail write failed", { code: String(error?.code || "telemetry_error").slice(0, 80) });
    }
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

  let stage = "collect_sources";
  try {
    const result = await runEventRefresh({ runId, mode, startedAt, trigger: "scheduled", onStage: (value) => { stage = value; } });
    const { events, ...summary } = result;
    return sendJson(res, 200, {
      ...summary,
      skippedByLock: false,
    });
  } catch (error) {
    // Only fixed diagnostic values enter the response: provider errors can
    // contain credentials, request URLs, or private database details.
    const errorCode = ["CANONICAL_PERSISTENCE_FAILED", "STORAGE_UNAVAILABLE", "KV_WRITE_FAILED"].includes(error?.code)
      ? error.code
      : error instanceof TypeError ? "TYPE_ERROR"
      : error instanceof ReferenceError ? "REFERENCE_ERROR" : "REFRESH_FAILED";
    console.error("[cron] Handler failed:", { runId, mode, stage, errorCode });
    return sendJson(res, 500, {
      success: false,
      skippedByLock: false,
      runId,
      durationMs: Date.now() - startedAt,
      error: "Cron execution failed",
      stage,
      errorCode,
    });
  } finally {
    try {
      await releaseCronLock(runId);
    } catch (error) {
      console.warn("[cron] lock release failed", { code: String(error?.code || "lock_release_error").slice(0, 80) });
    }
  }
};

module.exports.isAuthorized = isAuthorized;
module.exports.getMode = getMode;
