const assert = require("assert");
const categories = require("../shared/event-categories");
const { normalizeEvent } = require("../event-normalizer");
const { normalizeFinalEvents } = require("../event-refresh");
const { resolveGroupCategory } = require("../event-display");

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

const rss = { ...stableBase, eventKind: "news", categorySource: "rule", reviewState: "reviewed" };
const regressionCases = [
  ["快評》沈伯洋蔣萬安 兩個意外", "台北市長選舉出現兩位引起討論的候選人。", "accident", "politics"],
  ["分析基泰大直案法律疑點", "建管處回應三年前鄰損事故及施工圖爭議。", "traffic", "politics"],
  ["奇萊山友摔傷、高山症昏迷 黑鷹直升機吊掛救援", "兩名山友在奇萊山受傷或不適。", "other", "accident"],
  ["選前雙週日高虹安掃市場、竹風漁市", "候選人掃街途中來到市集。", "activity", "politics"],
  ["消防署繩索救援賽前進劍湖山", "選手模擬火災逃生與吊掛救援。", "other", "culture"],
  ["男子遭訴性侵 檢方回應認定依據", "檢方說明案件。", "other", "crime"],
  ["美光勞資爭議延燒 桃園工會控公司兩面手法", "", "other", "economy"],
  ["健康網》看圖片測試眼部健康", "眼科醫師說明測試方式。", "other", "medical"],
  ["天王大啖台灣滷肉飯 1親民舉動暖翻粉絲", "前兩天曾舉辦演唱會。", "activity", "culture"],
  ["台北市學校附近兩車追撞", "警方到場疏導。", "traffic", "accident"],
  ["颱風引發道路坍方 封路搶修", "道路封閉，警察到場。", "traffic", "disaster"],
  ["台北市住宅火警 市長到場", "附近道路暫時管制。", "traffic", "accident"],
  ["台北市住宅遭縱火引發火警", "嫌犯遭逮捕。", "accident", "crime"],
  ["台北市道路施工封閉外側車道", "請利用替代道路。", "other", "traffic"],
  ["一句話讓民眾意外", "消息有待釐清。", "accident", "other"],
];

for (const [title, content, oldCategory, expected] of regressionCases) {
  const event = { ...rss, title, content, category: oldCategory };
  const refreshed = normalizeFinalEvents([event])[0];
  const fromCache = normalizeEvent(event);
  assert.equal(refreshed?.category, expected, title);
  assert.equal(fromCache.category, expected, title);
  assert.equal(fromCache.eventKind, "news", title);
  assert.equal(fromCache.reviewState, "unreviewed", title);
  assert.equal(resolveGroupCategory(fromCache), expected, title);
  assert.equal(normalizeEvent(fromCache).category, expected, title);
  assert.equal(fromCache.id, normalizeEvent({ ...event, categorySource: "manual" }).id, title);
}

const aggregated = normalizeEvent({
  ...rss, title: "一句話讓民眾意外", content: "台北市音樂節開唱、其他新聞：國道追撞車禍",
  sourceUrl: "https://news.google.com/rss/articles/example",
});
assert.equal(aggregated.category, "other");
assert.equal(resolveGroupCategory(aggregated), "other");

const manual = { ...rss, title: "台北市火警", category: "other", categorySource: "manual" };
assert.equal(normalizeEvent(manual).category, "other");
assert.equal(normalizeFinalEvents([manual])[0].categorySource, "manual");

const ai = { ...rss, category: "education", categorySource: "ai", categoryConfidence: 0.91, categoryReason: "校務消息" };
assert.equal(normalizeFinalEvents([ai])[0].category, "education");
assert.equal(normalizeFinalEvents([{ ...ai, categoryConfidence: 0.55 }]).length, 0);
assert.equal(normalizeFinalEvents([{ ...ai, categoryConfidence: null }]).length, 0);

assert.equal(normalizeEvent({ ...rss, category: "activity", eventKind: undefined }).eventKind, "news");
assert.equal(normalizeFinalEvents([{ ...rss, category: "activity", eventKind: undefined }])[0].eventKind, "news");
assert.equal(normalizeEvent({ ...rss, source: "iCulture", eventKind: "activity", category: "activity" }).category, "activity");

console.log("event category tests passed");
