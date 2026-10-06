const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

process.env.EVENT_STORE_MODE = "local";
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `rss-collector-${process.pid}-${Date.now()}.sqlite`);
const refresh = require("../event-refresh");

(async () => {
  const originalFetch = global.fetch;
  const urls = ["https://example.test/good", "https://example.test/bad"];
  const xml = '<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title><link>https://example.test</link><description>Test</description><item><title>台北道路事故</title><link>https://example.test/article</link></item></channel></rss>';
  try {
    global.fetch = async (url) => new Response(String(url).endsWith("/bad") ? "Unavailable" : xml, { status: String(url).endsWith("/bad") ? 503 : 200 });
    const partial = await refresh.fetchRssFeeds(Date.now(), urls);
    assert.equal(partial.length, 1, "a failed feed does not discard successful feeds");
    assert.equal(partial.collector.status, "warning");
    assert.equal(partial.collector.failedSubrequestCount, 1);
    assert.equal(partial.collector.successfulSubrequestCount, 1);
    assert.match(partial.collector.subrequests[1].reason, /503/);

    global.fetch = async () => { throw new Error("network unavailable"); };
    const failed = await refresh.fetchRssFeeds(Date.now(), urls);
    assert.equal(failed.collector.status, "failed", "all feed failures are never reported as success");

    // Exercise the real collector wiring while mocking every upstream request.
    const sources = await refresh.fetchDefaultSources("news", Date.now(), { skipAi: true });
    assert.equal(sources.__collectorResults.rss.status, "failed");
    assert.match(sources.__sourceFailures.rss, /3\/3 feeds failed/);
    const now = Date.now();
    const result = await refresh.runEventRefresh({ mode: "news", write: false, sourceData: sources, skipExternalGeocoding: true, existingEvents: [{
      id: "retained-rss", title: "台北道路事故", source: "RSS", eventKind: "news", category: "traffic",
      city: "台北市", lat: 25.04, lng: 121.56, publishedAt: new Date(now).toISOString(), createdAt: now, expiresAt: now + 86400000,
    }] });
    assert.equal(result.status, "partial_success");
    assert.ok(result.events.some((event) => event.id === "retained-rss"), "failed collection retains existing fresh news");

    global.fetch = async () => new Response(xml);
    assert.equal((await refresh.fetchRssFeeds(Date.now(), urls)).collector.status, "success");
    global.fetch = async () => new Response(xml.replace(/<item>.*<\/item>/, ""));
    const empty = await refresh.fetchRssFeeds(Date.now(), urls);
    assert.equal(empty.length, 0);
    assert.equal(empty.collector.status, "success", "a valid empty feed differs from a fetch failure");
    console.log("RSS collector tests passed");
  } finally { global.fetch = originalFetch; }
})().catch((error) => { console.error(error); process.exitCode = 1; });
