"use strict";
const assert = require("node:assert/strict");
const { syncFailurePayload } = require("../pbs-cli-diagnostics");
const error = new Error("Authorization: Bearer secret-value");
error.report = { durationMs: 12345, attempts: [{}, {}, {}], error: { stage: "network", name: "TypeError", causeCode: "ECONNRESET", causeErrno: -4077, causeSyscall: "read", causeHostname: "rtr.pbs.gov.tw" } };
const output = syncFailurePayload(error);
assert.equal(output.stage, "network"); assert.equal(output.causeCode, "ECONNRESET"); assert.equal(output.attempts, 3); assert.equal(output.durationMs, 12345);
assert.equal(JSON.stringify(output).includes("secret-value"), false);
console.log("PBS CLI diagnostic tests passed");
