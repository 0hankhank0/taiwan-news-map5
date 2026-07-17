const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "admin-refresh-log.html"), "utf8");
const twMatch = source.match(/const tw=v=>(\{.*?\});const sec=/);
assert.ok(twMatch, "admin refresh log must define tw()");
const tw = vm.runInNewContext(`(v=>${twMatch[1]})`, { Date, Intl });

for (const value of ["", null, undefined, "not-a-date"]) {
  assert.equal(tw(value), "—", `tw(${String(value)}) must return an em dash`);
}
assert.doesNotThrow(() => tw("2026-07-17T10:59:23.705Z"));
assert.notEqual(tw("2026-07-17T10:59:23.705Z"), "—");

const loadDetailCatch = source.match(/async function loadDetail\(\).*?catch\(e\)\{(.*?)\}\n/s);
assert.ok(loadDetailCatch, "loadDetail() must retain a catch block");
assert.match(loadDetailCatch[1], /console\.error\('Failed to load refresh detail:', e\);/);
assert.doesNotMatch(loadDetailCatch[1], /console\.[^(]*\([^)]*(?:token|authorization)/i);

console.log("admin refresh log UI tests passed");
