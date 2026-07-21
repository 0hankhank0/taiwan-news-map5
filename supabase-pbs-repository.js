"use strict";

const { createClient } = require("@supabase/supabase-js");
function client() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { const error = new Error("PBS Supabase configuration is missing"); error.code = "CONFIG"; throw error; }
  return createClient(url, key, { auth: { persistSession: false } });
}
function fail(error) { throw new Error(error?.message || "PBS Supabase request failed"); }
async function replacePbsSnapshot(events, snapshotId, metadata = {}) {
  const { data, error } = await client().rpc("replace_pbs_road_snapshot", { p_events: events, p_snapshot_id: snapshotId, p_raw_count: metadata.rawCount ?? events.length, p_normalized_count: events.length, p_fetched_at: metadata.fetchedAt });
  if (error) fail(error);
  const row = data?.[0] || data || {};
  return { snapshotId: row.snapshot_id ?? row.snapshotId ?? snapshotId, eventCount: Number(row.event_count ?? row.eventCount ?? events.length), lastSuccessfulFetch: row.last_successful_fetch ?? row.lastSuccessfulFetch ?? null };
}
async function getActivePbsEvents() { const { data, error } = await client().from("pbs_road_events").select("normalized_payload").eq("is_active", true); if (error) fail(error); return (data || []).map((row) => row.normalized_payload); }
async function getPbsSyncState() { const { data, error } = await client().from("pbs_sync_state").select("*").eq("source", "pbs").maybeSingle(); if (error) fail(error); if (!data) return null; return { lastSuccessfulFetch: data.last_successful_fetch || null, eventCount: Number(data.event_count) || 0, lastSnapshotId: data.last_snapshot_id || null, consecutiveFailures: Number(data.consecutive_failures) || 0, lastStatus: data.last_status || null }; }
module.exports = { replacePbsSnapshot, getActivePbsEvents, getPbsSyncState };
