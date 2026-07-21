"use strict";
const assert = require("node:assert/strict");
const { PbsProbeError } = require("../pbs-github-probe");
const { fetchPbsRoadEvents } = require("../pbs-road-client");
const payload = Buffer.from(JSON.stringify({ formData: [{ number: "1" }] }));
const success = () => ({ report: { status: 200, durationMs: 4, error: null }, rawBody: payload });
const failure = (stage, status = null, causeCode = null) => new PbsProbeError("attempt failed", { status, durationMs: 3, error: { stage, name: "FetchError", message: "safe failure", causeCode } });
async function expectAttempts(sequence, count) {
  let calls = 0; const waits = [];
  const probe = async () => { const step = sequence[calls++]; if (step instanceof Error) throw step; return step; };
  const result = await fetchPbsRoadEvents({ runPbsGitHubProbe: probe, wait: async (ms) => { waits.push(ms); } });
  assert.equal(calls, count); return { result, waits };
}
(async () => {
  let retry = await expectAttempts([failure("network", null, "ECONNRESET"), success()], 2);
  assert.equal(retry.result.report.attempts.length, 2); assert.deepEqual(retry.waits, [2000]);
  retry = await expectAttempts([failure("timeout", null, "ETIMEDOUT"), failure("timeout", null, "UND_ERR_CONNECT_TIMEOUT"), success()], 3);
  assert.deepEqual(retry.waits, [2000, 5000]);
  retry = await expectAttempts([failure("http", 503), success()], 2); assert.equal(retry.result.records.length, 1);
  retry = await expectAttempts([failure("http", 429), success()], 2); assert.equal(retry.result.records.length, 1);
  for (const stage of ["json", "schema", "records"]) {
    let calls = 0;
    await assert.rejects(() => fetchPbsRoadEvents({ runPbsGitHubProbe: async () => { calls += 1; throw failure(stage); }, wait: async () => {} }), (error) => error.report.attempts.length === 1);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(() => fetchPbsRoadEvents({ runPbsGitHubProbe: async () => { calls += 1; throw failure("http", 400); }, wait: async () => {} }), (error) => error.report.attempts.length === 1);
  assert.equal(calls, 1);
  await assert.rejects(() => fetchPbsRoadEvents({ runPbsGitHubProbe: async () => { throw failure("network", null, "ECONNRESET"); }, wait: async () => {} }), (error) => error instanceof PbsProbeError && error.report.attempts.length === 3 && error.report.attempts.every((attempt) => attempt.causeCode === "ECONNRESET"));
  console.log("PBS road client retry tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
