const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "assets", "index", "main.mjs"), "utf8");

assert.match(html, /看見今天的新聞發生在哪裡/);
assert.match(html, /id="time-range"/);
assert.match(html, /id="search-map-area-btn"/);
assert.match(html, /id="map-help-card"/);
assert.doesNotMatch(html, /applicationCategory": "TravelApplication"/);
assert.match(source, /map_help_dismissed/);
assert.match(source, /isWithinTimeRange/);
assert.match(source, /isEventInBounds/);

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert.deepEqual([...new Set(duplicates)], []);
console.log("homepage news focus tests passed");
