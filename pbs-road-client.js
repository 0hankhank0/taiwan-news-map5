"use strict";

const { ROAD_ALL_URL, PbsProbeError, runPbsGitHubProbe } = require("./pbs-github-probe");

const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504]);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function shouldRetry(report = {}) { return ["network", "timeout"].includes(report.error?.stage) || RETRYABLE_HTTP_STATUS.has(Number(report.status)); }
function attemptSummary(report, attempt) { return { attempt, stage: report?.error?.stage || null, status: Number(report?.status) || null, durationMs: Number(report?.durationMs) || 0, causeCode: report?.error?.causeCode || null }; }

async function fetchPbsRoadEvents(options = {}) {
  const probe = options.runPbsGitHubProbe || runPbsGitHubProbe;
  const wait = options.wait || delay;
  const plan = [{ timeoutMs: 20_000, waitMs: 0 }, { timeoutMs: 20_000, waitMs: 2_000 }, { timeoutMs: 30_000, waitMs: 5_000 }];
  const startedAt = Date.now();
  const attempts = [];
  let lastError;
  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index];
    if (step.waitMs) await wait(step.waitMs);
    try {
      const { report, rawBody } = await probe({ ...options, timeoutMs: step.timeoutMs });
      attempts.push(attemptSummary(report, index + 1));
      return { records: JSON.parse(rawBody.toString("utf8")).formData, report: { ...report, attempts, durationMs: Date.now() - startedAt }, rawBody };
    } catch (error) {
      const report = error instanceof PbsProbeError ? error.report : { endpoint: ROAD_ALL_URL, error: { stage: "network", name: error?.name || "Error", message: String(error?.message || "PBS request failed"), causeCode: error?.code || null } };
      attempts.push(attemptSummary(report, index + 1));
      lastError = error;
      if (!shouldRetry(report) || index === plan.length - 1) {
        throw new PbsProbeError("PBS request failed", { ...report, attempts, durationMs: Date.now() - startedAt });
      }
    }
  }
  throw lastError;
}

module.exports = { RETRYABLE_HTTP_STATUS, attemptSummary, fetchPbsRoadEvents, ROAD_ALL_URL, shouldRetry };
