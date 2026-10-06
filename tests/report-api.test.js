const assert = require("node:assert/strict"), os = require("node:os"), path = require("node:path");
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `report-api-${process.pid}.sqlite`);
process.env.EVENT_STORE_MODE = "local";
for (const key of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_DEPLOYMENT", "AZURE_OPENAI_DEPLOYMENT_NAME", "DISCORD_WEBHOOK_URL"]) delete process.env[key];
const store = require("../event-store"), handler = require("../api/report"), reports = require("../report-store");
async function call(body, ip = "reporter") { const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; await handler({ method: "POST", headers: { "x-forwarded-for": ip }, body }, res); return res; }
(async () => {
  const fetch = global.fetch;
  global.fetch = async () => { throw new Error("offline test must not contact providers"); };
  await store.setOfficialEvents([{ id: "event", title: "官方事件", category: "traffic", lat: 25, lng: 121 }]);
  const body = { eventId: "event", title: "事件", errorType: "wrong_location", message: "位置錯誤", eventSnapshot: { title: "偽造", id: "fake" } };
  assert.equal((await call({ ...body, eventId: "missing" }, "missing-reporter")).statusCode, 404);
  assert.equal((await call(body)).statusCode, 200);
  assert.equal((await reports.getReports())[0].eventSnapshot.title, "官方事件");
  assert.equal((await call(body)).statusCode, 409);
  for (let index = 0; index < 4; index++) assert.equal((await call({ ...body, message: `其他資訊 ${index}` })).statusCode, 200);
  assert.equal((await call({ ...body, message: "超出限制" })).statusCode, 429);
  assert.equal((await reports.getReports()).length, 5);
  global.fetch = fetch;
  console.log("report API tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
