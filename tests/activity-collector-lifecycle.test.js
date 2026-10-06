const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
process.env.EVENT_STORE_MODE = "local";
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `activity-lifecycle-${process.pid}-${Date.now()}.sqlite`);
const refresh = require("../event-refresh");

(async () => {
  const originalFetch = global.fetch;
  const now = Date.now();
  const hour = 3600000;
  const iso = offset => new Date(now + offset * hour).toISOString();
  const show = (start, end) => ({ time: start, endTime: end, location: "臺北市中正區測試路", latitude: "25.0478", longitude: "121.5170" });
  const culture = (uid, info) => ({ UID: uid, title: `測試展覽 ${uid}`, showInfo: [info] });
  try {
    global.fetch = async () => new Response(JSON.stringify([
      culture("recent", show(iso(-3), iso(-1))),
      culture("start-only", show(iso(-1), undefined)),
      culture("old", show(iso(-10), iso(-7))),
      culture("invalid", show(iso(3), iso(2))),
      culture("local-time", show(new Date(now + 9 * hour).toISOString().replace(/Z$/, ""), undefined)),
    ]));
    const events = await refresh.fetchCultureActivityEvents(now);
    assert.equal(events.length, 3);
    const recent = events.find(event => event.id.includes("recent"));
    assert.equal(recent.status, "active", "recently ended activities remain visible during the grace period");
    assert.equal(recent.expiresAt, Date.parse(recent.endsAt) + 6 * hour);
    const startOnly = events.find(event => event.id.includes("start-only"));
    assert.equal(Date.parse(startOnly.endsAt) - Date.parse(startOnly.startsAt), 24 * hour);
    const local = events.find(event => event.id.includes("local-time"));
    assert.ok(Math.abs(Date.parse(local.startsAt) - (now + hour)) < 1000, "ISO local time preserves the Taipei hour");
    assert.ok(refresh.mergeRefreshEvents([], events, now).some(event => event.id === recent.id));
    assert.ok(!refresh.mergeRefreshEvents([], events, now + 6 * hour).some(event => event.id === recent.id));

    const tourismBase = { EventID: "tourism", EventName: "測試展覽", PositionLat: 25.0478, PositionLon: 121.517, PostalAddress: "臺北市中正區測試路", EventStatus: "Open" };
    const tourism = refresh.normalizeTourismEvent({ ...tourismBase, StartDateTime: iso(-3), EndDateTime: iso(-1) }, now);
    assert.equal(tourism.status, "active");
    assert.equal(tourism.expiresAt, Date.parse(iso(-1)) + 6 * hour);
    assert.equal(refresh.normalizeTourismEvent({ ...tourismBase, StartDateTime: iso(-10), EndDateTime: iso(-7) }, now), null);
    assert.equal(refresh.normalizeTourismEvent({ ...tourismBase, StartDateTime: iso(3), EndDateTime: iso(2) }, now), null);
    assert.equal(refresh.normalizeTourismEvent({ ...tourismBase, StartDateTime: iso(31 * 24) }, now), null);
    const tourismDefault = refresh.normalizeTourismEvent({ ...tourismBase, StartDateTime: iso(1) }, now);
    assert.equal(Date.parse(tourismDefault.endsAt) - Date.parse(tourismDefault.startsAt), 24 * hour);
    const meta = refresh.parseKktixMeta({ content: "Time: 2026/10/06 12:00\nLocation: 臺北市" });
    assert.equal(meta.endAt - meta.startAt, 24 * hour);
    console.log("activity collector lifecycle tests passed");
  } finally { global.fetch = originalFetch; }
})().catch(error => { console.error(error); process.exitCode = 1; });
