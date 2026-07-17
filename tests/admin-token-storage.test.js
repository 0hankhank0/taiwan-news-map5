const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const adminPages = [
  "admin-events.html",
  "admin-reports.html",
  "admin-health.html",
  "admin-refresh-log.html",
  "admin-submissions.html",
  "admin-action-log.html"
];

for (const file of adminPages) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  assert.ok(source.includes("sessionStorage"), `${file} must use sessionStorage`);
  assert.doesNotMatch(source, /localStorage\.report_admin_token/);
  assert.doesNotMatch(source, /localStorage\.getItem\(\s*["']report_admin_token["']/);
  assert.doesNotMatch(source, /localStorage\.setItem\(\s*["']report_admin_token["']/);
  assert.doesNotMatch(source, /[?&]token=/i);
  assert.doesNotMatch(source, /URLSearchParams\s*\(\s*\{[^}]*\btoken\b/i);
  assert.doesNotMatch(source, /\.set\(\s*["']token["']/i);
  assert.match(source, /Authorization\s*:/, `${file} must send admin credentials by Authorization header`);
}

console.log("admin token storage tests passed");
