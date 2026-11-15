const assert = require("assert");
const categories = require("../shared/event-categories");
const { normalizeEvent } = require("../event-normalizer");
const { normalizeFinalEvents } = require("../event-refresh");
const { resolveGroupCategory } = require("../event-display");
const { applyEventQueryFilters } = require("../event-query");
const { classifyNewsCategory } = require("../shared/news-category-rules");

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

const accuracyCases = [
  ["台北市颱風天兩車追撞", "警方初判駕駛分心。", "accident"],
  ["台北市颱風天兩車追撞", "豪雨造成路樹倒塌，兩車為閃避樹幹而追撞。", "disaster"],
  ["台北市路樹倒塌封閉兩車道", "外側車道暫停通行。", "traffic"],
  ["台北市颱風引發坍方封路", "", "disaster"],
  ["台北市校園地震演習", "演練包含模擬火警及人員撤離。", "other"],
  ["台北市校園地震演習中學生不慎受傷", "校方安排學生就醫。", "accident"],
  ["警方辦防詐講座 解析網購詐騙手法", "向民眾宣導如何查證。", "other"],
  ["警方逮捕網購詐騙集團", "被害者已報案。", "crime"],
  ["法律分析：性侵案件的證據如何判斷", "法院審理既有案件。", "crime"],
  ["台北市演唱會場外傳出狀況", "散場時有兩車在場外追撞。", "accident"],
  ["台北市演唱會周邊交通管制", "場館公布交通疏導措施。", "traffic"],
  ["台北市傳巨響 消防局證實並未發生氣爆", "目前正在確認聲音來源。", "other"],
  ["車禍十週年回顧 出版紀錄片", "", "other"],
  ["名人私生活惹議 又被影射是共諜", "", "other"],
  ["檢方偵辦共諜案並約談三人", "", "crime"],
];
for (const [title, content, category] of accuracyCases) {
  assert.equal(classifyNewsCategory({ title, content }).category, category, title);
  assert.equal(normalizeEvent({ ...rss, title, content }).category, category, title);
}

for (const sourceCategory of ["traffic", "disaster", "crime", "accident"]) {
  assert.equal(classifyNewsCategory({ title: "地方專訪", sourceCategory }).category, "other");
}

const floodClosure = normalizeEvent({
  ...rss, title: "豪雨造成台北市道路封閉", content: "道路淹水，雙向封閉。"
});
assert.equal(floodClosure.category, "disaster");
assert.deepEqual(floodClosure.relatedCategories, ["traffic"]);
for (const category of ["traffic", "disaster", "all"]) {
  assert.deepEqual(applyEventQueryFilters([floodClosure], { category }).map(({ id }) => id), [floodClosure.id]);
}
assert.deepEqual(applyEventQueryFilters([floodClosure], { category: "crime" }), []);

const overlappingCases = [
  ["台北市住宅火警 周邊道路交通管制", "外側車道封閉。", "accident", ["traffic"]],
  ["台北市住宅火警 消防局說明未封路", "無須封路。", "accident", []],
  ["颱風天台北市兩車追撞", "警方初判駕駛分心。", "accident", []],
  ["豪雨倒樹釀台北市兩車追撞", "主線車道封閉。", "disaster", ["traffic", "accident"]],
  ["台北市地震演習 模擬道路封閉", "", "other", []],
];
for (const [title, content, category, related] of overlappingCases) {
  const result = normalizeEvent({ ...rss, title, content });
  assert.equal(result.category, category, title);
  assert.deepEqual(result.relatedCategories, related, title);
}

assert.deepEqual(normalizeEvent({
  ...rss, category: "crime", categorySource: "manual", title: "台北市槍擊案 周邊道路封閉"
}).relatedCategories, []);
assert.deepEqual(normalizeEvent({
  ...rss, source: "PBS", eventKind: "traffic_data", title: "台北市淹水道路封閉"
}).relatedCategories, ["disaster"]);
assert.deepEqual(normalizeEvent({
  ...rss, source: "iCulture", eventKind: "activity", category: "activity",
  title: "台北市年節活動", content: "周邊道路交通管制。"
}).relatedCategories, ["traffic"]);
assert.deepEqual(normalizeEvent({
  ...rss, title: "台北市住宅火警", content: "另一篇新聞：國道車道封閉。",
  sourceUrl: "https://news.google.com/rss/articles/example"
}).relatedCategories, []);

console.log("event category tests passed");
