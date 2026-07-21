"use strict";
const { safeMessage } = require("./pbs-github-probe");
function syncFailurePayload(error = {}) {
  const report = error.report || {};
  const detail = report.error || {};
  return {
    error: safeMessage(error.message || "PBS request failed"), stage: error.stage || detail.stage || "unknown",
    name: detail.name || error.name || null, causeCode: detail.causeCode || null, causeErrno: detail.causeErrno || null,
    causeSyscall: detail.causeSyscall || null, causeHostname: detail.causeHostname || null,
    attempts: Array.isArray(report.attempts) ? report.attempts.length : null,
    attemptDetails: Array.isArray(report.attempts) ? report.attempts.map((attempt) => ({ attempt: Number(attempt.attempt) || null, stage: attempt.stage || null, status: attempt.status === null || attempt.status === undefined ? null : (Number.isFinite(Number(attempt.status)) ? Number(attempt.status) : null), durationMs: Number.isFinite(Number(attempt.durationMs)) ? Number(attempt.durationMs) : null, causeCode: attempt.causeCode || null })) : [],
    durationMs: Number.isFinite(Number(report.durationMs)) ? Number(report.durationMs) : null,
  };
}
module.exports = { syncFailurePayload };
