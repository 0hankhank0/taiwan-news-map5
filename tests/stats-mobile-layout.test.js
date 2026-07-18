const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "assets", "index", "index.css"), "utf8");
const source = fs.readFileSync(path.join(root, "assets", "index", "main.mjs"), "utf8");

assert.match(css, /body\.stats-mode #news-sidebar\s*\{\s*display:\s*none !important;/, "statistics mode removes the mobile drawer");
assert.match(css, /body\.stats-mode \.mobile-row1[\s\S]*?display:\s*none !important;/, "statistics mode hides the search row");
assert.match(css, /body\.stats-mode \.mobile-row2\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto 40px;/, "statistics topbar is one city/mode/settings row");
assert.match(css, /body\.stats-mode #stats-view\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/, "statistics view is the single mobile scroll surface");
assert.match(css, /body\.stats-mode \.stats-kpi-grid,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/, "statistics cards collapse to one column on mobile");
assert.match(source, /if \(window\.innerWidth >= 768 \|\| document\.body\.classList\.contains\('stats-mode'\)\) return;/, "drawer gestures ignore statistics mode");
assert.match(source, /statsEl\.scrollTop = 0;/, "entering statistics mode resets its scroll position");
assert.match(source, /if\(window\.innerWidth<768 && !document\.body\.classList\.contains\('stats-mode'\)\)/, "drawer toggle does not run in statistics mode");

console.log("mobile statistics layout tests passed");
