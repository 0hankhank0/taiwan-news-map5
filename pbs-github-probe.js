"use strict";

const { parsePbsRoadPayload } = require("./pbs-road-parser");

const ROAD_ALL_URL = "https://rtr.pbs.gov.tw/pbsmgt/RoadAllServlet?ajaxAction=roadAllCache";

class PbsProbeError extends Error {
  constructor(message, report) {
    super(message);
    this.name = "PbsProbeError";
    this.report = report;
  }
}

function recordSummary(records) {
  return records.slice(0, 2).map(({ number, name, region, area_sn, highway, roadtype, comment, lastmodified }) => ({
    number, name, region, area_sn, highway, roadtype,
    comment: String(comment || "").slice(0, 160), lastmodified,
  }));
}

function baseReport(timeoutMs) {
  return {
    runnerOs: process.env.RUNNER_OS || process.platform,
    nodeVersion: process.version,
    endpoint: ROAD_ALL_URL,
    timeoutMs,
    status: null,
    durationMs: null,
    contentType: null,
    bodyBytes: null,
    parserSuccess: false,
    formDataCount: null,
    sampleRecords: [],
    error: null,
  };
}

async function runPbsGitHubProbe({ fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  const started = Date.now();
  const report = baseReport(timeoutMs);
  let rawBody = null;
  try {
    const response = await fetchImpl(ROAD_ALL_URL, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
    rawBody = Buffer.from(await response.arrayBuffer());
    report.status = response.status;
    report.contentType = response.headers.get("content-type");
    report.bodyBytes = rawBody.length;
    report.durationMs = Date.now() - started;

    if (!response.ok) {
      report.error = { stage: "http", message: `PBS HTTP ${response.status}` };
      throw new PbsProbeError(report.error.message, report);
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch (error) {
      report.error = { stage: "json", name: error.name, message: error.message };
      throw new PbsProbeError("PBS response is not valid JSON", report);
    }

    const parsed = parsePbsRoadPayload(payload);
    report.parserSuccess = parsed.ok;
    report.formDataCount = parsed.records.length;
    report.sampleRecords = recordSummary(parsed.records);
    if (!parsed.ok) {
      report.error = { stage: "schema", message: parsed.error };
      throw new PbsProbeError("PBS response schema is invalid", report);
    }
    if (parsed.records.length === 0) {
      report.error = { stage: "records", message: "PBS formData is empty" };
      throw new PbsProbeError("PBS response contains no road records", report);
    }
    return { report, rawBody };
  } catch (error) {
    if (report.durationMs === null) report.durationMs = Date.now() - started;
    if (!report.error) {
      report.error = {
        stage: error.name === "TimeoutError" || error.name === "AbortError" ? "timeout" : "network",
        name: error.name || "Error",
        message: error.message || String(error),
        causeCode: error.cause?.code || null,
      };
    }
    if (error instanceof PbsProbeError) throw error;
    throw new PbsProbeError("PBS request failed", report);
  }
}

module.exports = { ROAD_ALL_URL, PbsProbeError, recordSummary, runPbsGitHubProbe };
