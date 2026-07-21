"use strict";
const { safeMessage } = require("./pbs-github-probe");
function syncFailurePayload(error = {}) {
  const report = error.report || {};
  const detail = report.error || {};
  return {
    error: safeMessage(error.message || "PBS request failed"), stage: error.stage || detail.stage || "unknown",
    name: detail.name || error.name || null, causeCode: detail.causeCode || null, causeErrno: detail.causeErrno || null,
    causeSyscall: detail.causeSyscall || null, causeHostname: detail.causeHostname || null,
    attempts: Array.isArray(report.attempts) ? report.attempts.length : null, durationMs: Number.isFinite(Number(report.durationMs)) ? Number(report.durationMs) : null,
  };
}
module.exports = { syncFailurePayload };
