"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
process.env.EVENT_STORE_MODE = "local";
process.env.DISABLE_LOCAL_EVENT_CACHE = "0";
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `pbs-refresh-${Date.now()}.sqlite`);
const { runEventRefresh } = require("../event-refresh");
const { getRefreshRunDetail } = require("../event-store");
const now = Date.now();
const base = { category: "traffic", city: "Taipei", lat: 25.0478, lng: 121.517, locationPrecision: "exact", locationSource: "official", locationConfidence: 1, locationQuality: "high", locationDisplayMode: "point", createdAt: now, expiresAt: now + 3600000 };
const oldPbs = { ...base, id: "pbs:old", eventFingerprint: "pbs:old", source: "pbs", sourceName: "PBS", title: "old PBS", content: "old" };
const newPbs = { ...base, id: "pbs:new", eventFingerprint: "pbs:new", source: "pbs", sourceName: "PBS", title: "new PBS", content: "new" };
const tdx = { ...base, id: "tdx:kept", source: "TDX", title: "TDX remains", content: "tdx" };

(async () => {
  const success = await runEventRefresh({ runId: "pbs-success", now, startedAt: now - 1, skipExternalGeocoding: true, existingEvents: [oldPbs, tdx], sourceData: { pbsEvents: [newPbs], __collectorResults: { pbs: { status: "success", snapshotId: "snapshot-new", lastSuccessfulFetch: "2026-07-21T12:00:00.000Z" } } } });
  assert.deepEqual(success.events.map((event) => event.id).sort(), ["pbs:new", "tdx:kept"]);
  assert.equal(success.sourceCounts.pbs, 1);
  const successDetail = await getRefreshRunDetail("pbs-success");
  assert.equal(successDetail.sources.pbs.status, "success");
  assert.equal(successDetail.sources.pbs.count, 1);
  assert.equal(successDetail.sources.pbs.snapshotId, "snapshot-new");
  assert.equal(successDetail.sources.pbs.lastSuccessfulFetch, "2026-07-21T12:00:00.000Z");

  const failed = await runEventRefresh({ runId: "pbs-failed", now: now + 1, startedAt: now, skipExternalGeocoding: true, existingEvents: [oldPbs, tdx], sourceData: { pbsEvents: [] }, sourceFailures: { pbs: "PBS cache unavailable" } });
  assert.deepEqual(failed.events.map((event) => event.id).sort(), ["pbs:old", "tdx:kept"]);
  const failedDetail = await getRefreshRunDetail("pbs-failed");
  assert.equal(failedDetail.sources.pbs.status, "failed");
  console.log("PBS event refresh tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
