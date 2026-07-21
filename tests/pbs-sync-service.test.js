"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { previousCountRatio, syncPbsToSupabase } = require("../pbs-sync-service");

const records = (count) => Array.from({ length: count }, (_, index) => ({ number: String(index + 1) }));
const fetchRecords = (count) => async () => ({ records: records(count), report: { formDataCount: count } });
const normalized = (count) => records(count).map((record) => ({ id: `pbs:${record.number}`, source: "pbs" }));
function repository(previous = null, result = { snapshotId: "snapshot-ok", eventCount: 100, lastSuccessfulFetch: "2026-07-21T12:00:00.000Z" }) {
  let replaceCalls = 0;
  return {
    get replaceCalls() { return replaceCalls; },
    async getPbsSyncState() { return previous; },
    async replacePbsSnapshot(events, snapshotId, metadata) { replaceCalls += 1; return { ...result, snapshotId, eventCount: events.length, metadata }; },
  };
}
async function rejected(work, stage) { await assert.rejects(work, (error) => error.stage === stage); }

(async () => {
  assert.equal(previousCountRatio("invalid"), 0.25);
  assert.equal(previousCountRatio(0), 0.25);
  assert.equal(previousCountRatio(2), 0.25);
  assert.equal(previousCountRatio(0.5), 0.5);

  for (const [raw, eventCount, stage] of [[0, 0, "records"], [49, 49, "records"], [50, 0, "normalization"], [50, 39, "normalization"]]) {
    const repo = repository();
    await rejected(() => syncPbsToSupabase({ fetchPbsRoadEvents: fetchRecords(raw), normalizePbsRoadRecords: () => normalized(eventCount), repository: repo }), stage);
    assert.equal(repo.replaceCalls, 0);
  }

  const dropRepo = repository({ eventCount: 351, lastSuccessfulFetch: "2026-07-20T00:00:00.000Z", lastSnapshotId: "old", consecutiveFailures: 0, lastStatus: "success" });
  await assert.rejects(() => syncPbsToSupabase({ fetchPbsRoadEvents: fetchRecords(100), normalizePbsRoadRecords: () => normalized(87), repository: dropRepo }), (error) => error.stage === "count_drop" && error.previousCount === 351 && error.normalizedCount === 87 && error.minimumAllowedCount === 88 && error.ratio === 0.25);
  assert.equal(dropRepo.replaceCalls, 0);

  const boundaryRepo = repository({ eventCount: 351 });
  const boundary = await syncPbsToSupabase({ fetchPbsRoadEvents: fetchRecords(100), normalizePbsRoadRecords: () => normalized(88), repository: boundaryRepo });
  assert.equal(boundaryRepo.replaceCalls, 1);
  assert.equal(boundary.previousCount, 351);
  assert.equal(boundary.lastSuccessfulFetch, "2026-07-21T12:00:00.000Z");

  const noPreviousRepo = repository(null);
  await syncPbsToSupabase({ fetchPbsRoadEvents: fetchRecords(100), normalizePbsRoadRecords: () => normalized(80), repository: noPreviousRepo });
  assert.equal(noPreviousRepo.replaceCalls, 1);

  const overrideRepo = repository({ eventCount: 351 });
  await syncPbsToSupabase({ fetchPbsRoadEvents: fetchRecords(100), normalizePbsRoadRecords: () => normalized(80), repository: overrideRepo, allowLargeDrop: true });
  assert.equal(overrideRepo.replaceCalls, 1);

  const failedRpcRepo = repository(null, { snapshotId: "snapshot-failed", eventCount: 100, lastSuccessfulFetch: null });
  await rejected(() => syncPbsToSupabase({ fetchPbsRoadEvents: fetchRecords(100), normalizePbsRoadRecords: () => normalized(100), repository: failedRpcRepo }), "rpc");
  assert.equal(failedRpcRepo.replaceCalls, 1);

  const throwingRpcRepo = repository();
  throwingRpcRepo.replacePbsSnapshot = async () => { throw new Error("safe RPC failure"); };
  await assert.rejects(() => syncPbsToSupabase({ fetchPbsRoadEvents: fetchRecords(100), normalizePbsRoadRecords: () => normalized(100), repository: throwingRpcRepo }), /safe RPC failure/);

  const migration = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "20260721_pbs_road_cache.sql"), "utf8");
  const emptyGuard = migration.indexOf("PBS snapshot must contain at least one event");
  const inactiveUpdate = migration.indexOf("update public.pbs_road_events set is_active=false");
  assert.ok(emptyGuard >= 0 && emptyGuard < inactiveUpdate);
  assert.ok(migration.includes("p_events is null"));
  console.log("PBS sync service tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
