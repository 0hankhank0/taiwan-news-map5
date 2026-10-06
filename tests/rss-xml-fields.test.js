const assert = require("node:assert/strict");
const Parser = require("rss-parser");
process.env.EVENT_STORE_MODE = "local";
const refresh = require("../event-refresh");

(async () => {
  const xml = '<rss version="2.0"><channel><title>Feed</title><item><title>台北市道路事故</title><link>https://example.test/a</link><description>台北市道路事故</description><guid isPermaLink="false"/></item><item><title>台北市道路封閉</title><link>https://example.test/b</link><guid isPermaLink="false">article-b</guid></item></channel></rss>';
  const feed = await new Parser().parseString(xml);
  assert.equal(Object.getPrototypeOf(feed.items[0].guid), null);
  assert.throws(() => String(feed.items[0].guid), /Cannot convert object to primitive value/);
  const rules = refresh.extractRuleBasedEvents(feed.items);
  assert.equal(rules.length, 2, "an empty XML guid must not drop valid news");
  assert.equal(rules.diagnostics.rssRecords[0].sourceId, "https://example.test/a");
  assert.equal(rules.diagnostics.rssRecords[1].sourceId, "article-b");
  const blankNode = Object.assign(Object.create(null), { $: { type: "text" } });
  const textNode = Object.assign(Object.create(null), { _: "台北市道路事故", $: { type: "text" } });
  const candidates = refresh.selectAiNewsCandidates([{ title: textNode, source: blankNode, guid: blankNode }]);
  assert.equal(candidates[0].title, "台北市道路事故");
  assert.equal(candidates[0].source, "");
  assert.equal(refresh.extractRuleBasedEvents([{ title: blankNode, guid: blankNode }]).length, 0);

  const originalFetch = global.fetch;
  try {
    global.fetch = async () => new Response(xml);
    const items = await refresh.fetchRssFeeds(Date.now(), ["https://example.test/rss"]);
    assert.equal(items.collector.status, "success");
    assert.equal(items[0].guid, "");
    assert.equal(items[1].guid, "article-b");
    const result = await refresh.runEventRefresh({
      write: false, sourceData: { rssItems: items, ruleBasedEvents: refresh.extractRuleBasedEvents(items) },
      existingEvents: [], skipExternalGeocoding: true,
    });
    assert.equal(result.success, true);
    assert.equal(result.count, 2);
  } finally { global.fetch = originalFetch; }
  console.log("RSS XML field regression tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
