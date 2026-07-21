"use strict";

const assert = require("node:assert/strict");
const { PbsProbeError, runPbsGitHubProbe } = require("../pbs-github-probe");

const payload = { formData: Array.from({ length: 351 }, (_, index) => ({
  number: String(index + 1), name: "測試路段", region: "N", roadtype: "事故", comment: "測試訊息",
})) };
const response = (status, body, contentType = "application/json") => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (name) => name === "content-type" ? contentType : null },
  arrayBuffer: async () => Buffer.from(body),
});

(async () => {
  const success = await runPbsGitHubProbe({ fetchImpl: async () => response(200, JSON.stringify(payload)) });
  assert.equal(success.report.parserSuccess, true);
  assert.equal(success.report.formDataCount, 351);
  assert.equal(success.report.sampleRecords.length, 2);

  const timeout = new Error("timeout");
  timeout.name = "TimeoutError";
  await assert.rejects(() => runPbsGitHubProbe({ fetchImpl: async () => { throw timeout; } }), (error) => error instanceof PbsProbeError && error.report.error.stage === "timeout");

  await assert.rejects(() => runPbsGitHubProbe({ fetchImpl: async () => response(503, "unavailable", "text/plain") }), (error) => error.report.error.stage === "http");
  await assert.rejects(() => runPbsGitHubProbe({ fetchImpl: async () => response(200, "not-json") }), (error) => error.report.error.stage === "json");
  await assert.rejects(() => runPbsGitHubProbe({ fetchImpl: async () => response(200, JSON.stringify({})) }), (error) => error.report.error.stage === "schema");
  await assert.rejects(() => runPbsGitHubProbe({ fetchImpl: async () => response(200, JSON.stringify({ formData: [] })) }), (error) => error.report.error.stage === "records");

  console.log("PBS GitHub probe tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
