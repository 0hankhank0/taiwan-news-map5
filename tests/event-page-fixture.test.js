const assert = require("assert");
const path = require("path");
const fs = require("fs");
process.env.EVENT_STORE_MODE = "local";
process.env.EVENT_DB_PATH = path.join(__dirname, ".tmp-event-page.sqlite");
try { fs.unlinkSync(process.env.EVENT_DB_PATH); } catch {}
const store = require("../event-store");
const page = require("../event-page");

async function invoke(query) {
  const result = { status: 200, headers: {}, body: "" };
  const res = { status(code) { result.status = code; return this; }, send(body) { result.body = body; return this; }, setHeader(key, value) { result.headers[key] = value; } };
  await page({ query, headers: { host: "localhost:3000" } }, res);
  return result;
}

(async () => {
  const event = { id: "fixture-news-01", title: "台北道路事故", summary: "測試事件摘要", content: "測試事件摘要", category: "traffic", categorySource: "manual", eventKind: "news", city: "Taipei", lat: 25.03, lng: 121.56, sourceUrl: "https://example.test/news", publishedAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T01:00:00.000Z" };
  await store.setOfficialEvents([event]);
  const found = await invoke({ eventId: event.id });
  assert.equal(found.status, 200);
  assert.match(found.body, /台北道路事故/);
  assert.match(found.body, /og:title/);
  assert.match(found.body, /event\/fixture-news-01/);
  assert.match(found.body, /<title>.*｜島嶼脈搏<\/title>/);
  assert.match(found.body, /rel="canonical" href="http:\/\/localhost:3000\/event\/fixture-news-01"/);
  assert.match(found.body, /交通/);
  const missing = await invoke({ eventId: "missing" });
  assert.equal(missing.status, 404);
  const ordinaryId = await invoke({ eventId: "event_d2abtq" });
  assert.equal(ordinaryId.status, 404);
  assert.match(ordinaryId.body, /event\/event_d2abtq/);
  console.log("event page fixture integration tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
