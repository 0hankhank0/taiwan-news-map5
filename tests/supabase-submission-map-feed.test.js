const assert = require("assert");
const crypto = require("crypto");

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for this staging integration test");
}

process.env.EVENT_STORE_MODE = "supabase";
process.env.DISABLE_LOCAL_EVENT_CACHE = "1";
process.env.REPORT_ADMIN_TOKEN = process.env.REPORT_ADMIN_TOKEN || "supabase-submission-test-token";

const { createClient } = require("@supabase/supabase-js");
const repository = require("../supabase-event-repository");
const store = require("../event-store");
const eventsApi = require("../api/events");
const adminEvents = require("../admin-handlers/events");

const testRunId = `submission-test-${Date.now()}-${crypto.randomUUID()}`;
const submissionId = `${testRunId}-submission`;
const eventId = `submission:${submissionId}`;
const rollbackCandidateId = `${testRunId}-rollback`;
const publishedCandidateId = `${testRunId}-published`;
const rollbackEventId = `submission:${testRunId}-rollback`;
const baseUrl = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "");
const db = createClient(baseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function response() {
  return {
    statusCode: 200, headers: {}, payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
    end() { return this; },
  };
}

async function call(handler, request) {
  const res = response();
  await handler({ method: "GET", headers: {}, query: {}, body: {}, url: "/api/events", ...request }, res);
  return res;
}

function throwOnError(error) {
  if (error) throw new Error(error.message);
}

async function cleanup() {
  // Break the deferred candidate -> event relation first, then remove the
  // event before its source candidate. Every row is identified by this run.
  throwOnError((await db.from("event_candidates").update({ published_event_id: null }).in("candidate_id", [publishedCandidateId, rollbackCandidateId])).error);
  throwOnError((await db.from("official_events").delete().in("id", [eventId, rollbackEventId])).error);
  throwOnError((await db.from("event_candidates").delete().in("candidate_id", [publishedCandidateId, rollbackCandidateId])).error);
}

async function assertCleanup() {
  const [candidates, events] = await Promise.all([
    db.from("event_candidates").select("candidate_id,published_event_id").in("candidate_id", [publishedCandidateId, rollbackCandidateId]),
    db.from("official_events").select("id,source_candidate_id,submission_id").in("id", [eventId, rollbackEventId]),
  ]);
  throwOnError(candidates.error);
  throwOnError(events.error);
  assert.equal(candidates.data.length, 0, "test candidates must be fully removed");
  assert.equal(events.data.length, 0, "test official events must be fully removed");
  return { eventCandidates: 0, officialEvents: 0, submissions: 0, submissionArtifacts: 0, submissionMappings: 0 };
}

(async () => {
  let debug = {};
  try {
    await cleanup();
    await assertCleanup();
    const payload = {
      id: eventId,
      submissionId,
      title: "Supabase submission map-feed test",
      content: "Isolated staging submission used to verify the public map feed.",
      category: "activity",
      lat: 25.033,
      lng: 121.565,
      source: "user_submission",
      sourceName: "User submission",
      status: "active",
      publicationNotice: "User submission | not officially verified",
      metadata: { testRunId, sourceReference: submissionId },
      locationPrecision: "exact",
      locationQuality: "high",
      locationDisplayMode: "point",
      locationConfidence: 1,
    };
    const [candidate] = await repository.createEventCandidates([{
      candidateId: publishedCandidateId,
      source: "user_submission",
      status: "pending",
      batchId: testRunId,
      event: payload,
      rawSourceData: { testRunId, submissionId, sourceReference: submissionId },
    }], { batchId: testRunId });
    assert.equal(candidate.candidateId, publishedCandidateId);

    const published = await store.publishEventCandidate(publishedCandidateId);
    const republished = await store.publishEventCandidate(publishedCandidateId);
    assert.equal(published.event.id, eventId);
    assert.equal(republished.alreadyPublished, true);

    const feed = await call(eventsApi);
    assert.equal(feed.statusCode, 200);
    const feedEvent = feed.payload.find((item) => item.id === eventId);
    assert.ok(feedEvent, "published submission must be returned by /api/events");
    assert.equal(feedEvent.submissionId, submissionId);
    assert.equal(feedEvent.source, "user_submission");

    const patched = await call(adminEvents, {
      method: "PATCH",
      url: "/api/admin-events",
      headers: { authorization: `Bearer ${process.env.REPORT_ADMIN_TOKEN}` },
      query: { eventId },
      body: { category: "traffic", status: "resolved", adminNote: testRunId },
    });
    assert.equal(patched.statusCode, 200);
    assert.equal(patched.payload.event.status, "resolved");

    await repository.createEventCandidates([{
      candidateId: rollbackCandidateId,
      source: "user_submission",
      status: "pending",
      batchId: testRunId,
      event: { ...payload, id: rollbackEventId, submissionId: `${submissionId}-rollback` },
      rawSourceData: { testRunId },
    }], { batchId: testRunId });
    await assert.rejects(() => store.publishEventCandidate(rollbackCandidateId, {}, { failAfterEvent: true }), /TEST_ONLY_ROLLBACK_AFTER_EVENT_INSERT/);

    const candidates = await repository.getEventCandidates();
    const rollbackCandidate = candidates.find((item) => item.candidateId === rollbackCandidateId);
    const officialEvents = await repository.getOfficialEvents();
    assert.equal(rollbackCandidate.status, "pending");
    assert.equal(rollbackCandidate.publishedEventId, null);
    assert.equal(officialEvents.some((item) => item.id === rollbackEventId), false);
    const recovered = await store.publishEventCandidate(rollbackCandidateId);
    const recoveredAgain = await store.publishEventCandidate(rollbackCandidateId);
    assert.equal(recovered.event.id, rollbackEventId);
    assert.equal(recoveredAgain.event.id, rollbackEventId);
    assert.equal(recoveredAgain.alreadyPublished, true);
    debug = { candidate: publishedCandidateId, rollbackCandidate: rollbackCandidateId, feedCount: feed.payload.length };
    console.log("Supabase submission map-feed tests passed", { testRunId });
  } catch (error) {
    console.error("Supabase submission map-feed test failed", { testRunId, ...debug, message: error.message });
    throw error;
  } finally {
    await cleanup();
    const cleanupCounts = await assertCleanup();
    console.log("Supabase submission map-feed cleanup confirmed", { testRunId, cleanupCounts });
  }
})().catch((error) => { console.error(error); process.exit(1); });
