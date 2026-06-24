const assert = require("assert");
const os = require("os");
const path = require("path");

process.env.KV_REST_API_URL = "";
process.env.KV_REST_API_TOKEN = "";
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `taiwan-news-reaction-test-${Date.now()}.sqlite`);
process.env.DISABLE_LOCAL_EVENT_CACHE = "0";

const reactionApi = require("../api/reaction");

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { return this; },
  };
}

async function call(req) {
  const res = createRes();
  await reactionApi({
    headers: {},
    query: {},
    body: {},
    ...req,
  }, res);
  return res;
}

(async () => {
  const missing = await call({ method: "GET" });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.payload.error, "Missing eventId");

  const initial = await call({ method: "GET", query: { eventId: "event-a" } });
  assert.equal(initial.statusCode, 200);
  assert.deepEqual(initial.payload, { muyu: 0, candle: 0 });

  const invalid = await call({
    method: "POST",
    body: { eventId: "event-a", type: "other" },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.payload.error, "Invalid reaction type");

  const postMuyu = await call({
    method: "POST",
    body: { eventId: "event-a", type: "muyu" },
  });
  assert.equal(postMuyu.statusCode, 200);
  assert.deepEqual(postMuyu.payload, { muyu: 1, candle: 0 });

  const postCandle = await call({
    method: "POST",
    body: { eventId: "event-b", type: "candle" },
  });
  assert.equal(postCandle.statusCode, 200);
  assert.deepEqual(postCandle.payload, { muyu: 0, candle: 1 });

  const batch = await call({
    method: "GET",
    query: { eventIds: "event-a,event-b,,event-a" },
  });
  assert.equal(batch.statusCode, 200);
  assert.deepEqual(batch.payload, {
    reactions: {
      "event-a": { muyu: 1, candle: 0 },
      "event-b": { muyu: 0, candle: 1 },
    },
  });

  const manyIds = Array.from({ length: 105 }, (_, index) => `batch-${index + 1}`).join(",");
  const limited = await call({
    method: "GET",
    query: { eventIds: manyIds },
  });
  assert.equal(limited.statusCode, 200);
  assert.equal(Object.keys(limited.payload.reactions).length, 100);

  const method = await call({ method: "PUT", body: { eventId: "event-a" } });
  assert.equal(method.statusCode, 405);

  console.log("reaction API tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
