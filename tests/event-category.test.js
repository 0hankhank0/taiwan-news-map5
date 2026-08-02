const assert = require("assert");
const categories = require("../shared/event-categories");
const { normalizeEvent } = require("../event-normalizer");

assert.equal(categories.normalizeEventCategory("criminal"), "crime");
assert.equal(categories.normalizeEventCategory("weather"), "disaster");
assert.equal(categories.normalizeEventCategory("unknown-value"), "other");
assert.equal(categories.normalizeEventCategory("fire", { title: "豪雨引發火災" }), "disaster");
assert.equal(categories.normalizeEventCategory("fire", { title: "縱火案" }), "crime");
assert.equal(categories.inferEventKind({ source: "TDX CMS" }), "traffic_data");
assert.deepEqual(categories.normalizeSecondaryTags(["酒駕", "酒駕", "a".repeat(30)]), ["酒駕"]);
const stableBase = { title: "測試道路事故", content: "原始摘要", source: "RSS", sourceUrl: "https://example.test/stable", publishedAt: "2026-08-01T00:00:00.000Z", city: "Taipei", lat: 25.03, lng: 121.56, category: "traffic" };
const stableId = normalizeEvent(stableBase).id;
for (const variant of [
  { category: "crime" },
  { categoryReason: "人工修正理由" },
  { secondaryTags: ["酒駕"] },
  { categoryConfidence: 0.2 },
  { summary: "微調過的摘要" },
  { categorySource: "manual" },
]) assert.equal(normalizeEvent({ ...stableBase, ...variant }).id, stableId);
console.log("event category tests passed");
