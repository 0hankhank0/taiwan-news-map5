"use strict";
const crypto = require("node:crypto");
const { fetchPbsRoadEvents } = require("./pbs-road-client");
const { normalizePbsRoadRecords } = require("./pbs-road-normalizer");
const { replacePbsSnapshot } = require("./supabase-pbs-repository");
function limit(name, fallback) { const value = Number(process.env[name] || fallback); return Number.isFinite(value) ? value : fallback; }
function previousCountRatio(value = process.env.PBS_MIN_PREVIOUS_COUNT_RATIO) { const ratio = Number(value); return Number.isFinite(ratio) && ratio > 0 && ratio <= 1 ? ratio : 0.25; }
function syncError(message, stage, details = {}) { const error = new Error(message); error.stage = stage; Object.assign(error, details); return error; }
async function syncPbsToSupabase(options = {}) {
  const fetchRoadEvents = options.fetchPbsRoadEvents || fetchPbsRoadEvents;
  const normalizeRecords = options.normalizePbsRoadRecords || normalizePbsRoadRecords;
  const repository = options.repository || require("./supabase-pbs-repository");
  const { records, report } = await fetchRoadEvents(options);
  const min = limit("PBS_MIN_EVENT_COUNT", 50), max = limit("PBS_MAX_EVENT_COUNT", 5000);
  if (records.length < min || records.length > max) throw syncError(`PBS raw count ${records.length} is outside ${min}-${max}`, "records", { rawCount: records.length });
  const events = normalizeRecords(records);
  const ratio = events.length / records.length;
  if (ratio < limit("PBS_MIN_NORMALIZE_RATIO", 0.8)) throw syncError(`PBS normalization ratio ${ratio.toFixed(3)} is too low`, "normalization", { rawCount: records.length, normalizedCount: events.length, ratio });
  const previous = await repository.getPbsSyncState();
  const previousCount = Math.max(0, Number(previous?.eventCount) || 0);
  const minPreviousRatio = previousCountRatio(options.previousCountRatio);
  const minimumAllowedCount = Math.ceil(previousCount * minPreviousRatio);
  if (!options.allowLargeDrop && previousCount > 0 && events.length < minimumAllowedCount) throw syncError("PBS normalized count dropped below the safe previous-count threshold", "count_drop", { previousCount, normalizedCount: events.length, minimumAllowedCount, ratio: minPreviousRatio });
  const snapshotId = crypto.createHash("sha256").update(JSON.stringify(records)).digest("hex");
  const fetchedAt = new Date().toISOString();
  const result = await repository.replacePbsSnapshot(events, snapshotId, { rawCount: records.length, fetchedAt });
  if (!result?.lastSuccessfulFetch) throw syncError("PBS snapshot RPC returned no last successful fetch time", "rpc");
  return { report, rawCount: records.length, normalizedCount: events.length, previousCount, snapshotId, lastSuccessfulFetch: result.lastSuccessfulFetch, result };
}
module.exports = { previousCountRatio, syncPbsToSupabase };
