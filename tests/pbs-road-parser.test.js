"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parsePbsRoadPayload } = require("../pbs-road-parser");

const fixturePath = path.join(__dirname, "fixtures", "pbs-road-payload.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

const parsed = parsePbsRoadPayload(fixture);
assert.equal(parsed.ok, true);
assert.equal(parsed.formDataPresent, true);
assert.equal(parsed.records.length, 1);
assert.equal(parsed.records[0].number, "11507210287");

for (const malformed of [null, [], {}, { formData: {} }, { formData: [null] }]) {
  const invalid = parsePbsRoadPayload(malformed);
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.records, []);
  assert.ok(invalid.error);
}

console.log("pbs road parser tests passed");
