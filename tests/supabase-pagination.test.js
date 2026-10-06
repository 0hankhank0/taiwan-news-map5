const assert = require("node:assert/strict");
process.env.SUPABASE_URL = "https://example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
const official = require("../supabase-event-repository");
const pbs = require("../supabase-pbs-repository");
(async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async url => {
    calls++;
    const parsed = new URL(url);
    const offset = Number(parsed.searchParams.get("offset") || 0), limit = Number(parsed.searchParams.get("limit"));
    assert.equal(limit, 500);
    assert.ok(parsed.searchParams.get("order"), "pagination must have stable ordering");
    const end = Math.min(1201, offset + limit);
    const data = Array.from({ length: end - offset }, (_, index) => ({ public_payload: { id: index + offset }, normalized_payload: { id: index + offset }, candidate_id: String(index + offset) }));
    return new Response(JSON.stringify(data), { headers: { "content-type": "application/json", "content-range": `${offset}-${end - 1}/1201` } });
  };
  assert.equal((await official.getOfficialEvents()).length, 1201);
  assert.equal((await official.getEventCandidates()).length, 1201);
  assert.equal((await pbs.getActivePbsEvents()).length, 1201);
  assert.equal(calls, 9);
  global.fetch = async () => new Response("[]", { headers: { "content-type": "application/json", "content-range": "*/1201" } });
  await assert.rejects(() => official.getOfficialEvents(), /Incomplete/);
  global.fetch = originalFetch;
  console.log("Supabase repository pagination tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
