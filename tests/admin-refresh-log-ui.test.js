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

function extractFunction(sourceText, signature) {
  const start = sourceText.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = sourceText.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${signature} must have a body`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = bodyStart; index < sourceText.length; index += 1) {
    const character = sourceText[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return sourceText.slice(start, index + 1);
    }
  }
  throw new Error(`${signature} must have a closing brace`);
}

const loadDetail = extractFunction(source, "async function loadDetail()");
assert.match(loadDetail, /catch\(e\)\{/);
assert.match(loadDetail, /console\.error\('Failed to load refresh detail:', e\);/);
assert.doesNotMatch(loadDetail, /console\.[^(]*\([^)]*(?:token|authorization)/i);

console.log("admin refresh log UI tests passed");
