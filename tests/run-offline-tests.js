const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const liveTests = new Set(["supabase-submission-map-feed.test.js"]);
const files = fs.readdirSync(__dirname).filter(name => /\.test\.(js|mjs)$/.test(name) && !liveTests.has(name)).sort();
let failures = 0;
for (const name of files) {
  const result = spawnSync(process.execPath, [path.join(__dirname, name)], { encoding: "utf8", timeout: 120000 });
  if (result.status === 0) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}\n${result.stdout || ""}\n${result.stderr || result.error || ""}`); }
}
console.log(`${files.length - failures}/${files.length} offline test suites passed`);
process.exitCode = failures ? 1 : 0;
