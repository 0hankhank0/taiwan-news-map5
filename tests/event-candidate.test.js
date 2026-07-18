const assert = require("assert");
const os = require("os"); const path = require("path");
process.env.EVENT_STORE_MODE = "local";
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `taiwan-news-candidate-${Date.now()}.sqlite`);
const { createEventCandidates, publishEventCandidate, getOfficialEvents, getEventCandidates } = require("../event-store");
(async () => {
  const [candidate] = await createEventCandidates([{ source: "TDX", batchId: "run-1", rawSourceData: { raw: true }, event: { title: "施工", lat: 25.03, lng: 121.56 } }], { batchId: "run-1" });
  const result = await publishEventCandidate(candidate.candidateId);
  assert.equal(result.candidate.status, "published"); assert.equal(result.candidate.publishedEventId, result.event.id);
  assert.equal((await getOfficialEvents()).some((event) => event.id === result.event.id), true);
  assert.equal((await getEventCandidates()).find((item) => item.candidateId === candidate.candidateId).publishedEventId, result.event.id);
  const [failing] = await createEventCandidates([{ source: "test", event: { title: "rollback", lat: 25, lng: 121 } }]);
  await assert.rejects(() => publishEventCandidate(failing.candidateId, {}, { failAfterEvent: true }));
  assert.equal((await getEventCandidates()).find((item) => item.candidateId === failing.candidateId).status, "pending");
  console.log("event candidate tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
