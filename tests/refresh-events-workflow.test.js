const assert = require("node:assert/strict");
const fs = require("node:fs");

const workflow = fs.readFileSync(".github/workflows/refresh-events.yml", "utf8");

assert.match(workflow, /-o \"\$response_file\" -w \"%\{http_code\}\"/);
assert.match(workflow, /Safe response body:/);
assert.match(workflow, /redacted-secret/);
assert.doesNotMatch(workflow, /curl -fsS/);
assert.match(workflow, /exit 22/);

console.log("refresh events workflow diagnostics tests passed");
