const assert = require("node:assert/strict");
const path = require("node:path"), os = require("node:os");
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `durable-redis-${process.pid}.sqlite`);
process.env.NODE_ENV = "production";
const store = require("../event-store");
const values = new Map();
let expireLease = false, failWrite = false, failRead = false;
store.__test.setKvClient({
  async get(key) { if (failRead) throw new Error("offline"); return values.get(key) ?? null; },
  async set(key, value, options) { if (options?.nx && values.has(key)) return null; values.set(key, value); return "OK"; },
  async eval(script, keys, args) {
    const owner = values.get(keys[0]);
    if (keys.length === 2) {
      if (failWrite) throw new Error("offline");
      if (expireLease) values.set(keys[0], { ownerToken: "new-writer" });
      if (values.get(keys[0])?.ownerToken !== args[0]) return 0;
      values.set(keys[1], JSON.parse(args[1])); return 1;
    }
    if (owner?.ownerToken !== args[0]) return 0;
    values.delete(keys[0]); return 1;
  },
});
(async () => {
  await Promise.all(Array.from({ length: 20 }, () => store.mutateDurableValue("counter", current => (current || 0) + 1)));
  assert.equal(await store.getDurableValue("counter"), 20);
  failWrite = true;
  await assert.rejects(() => store.mutateDurableValue("counter", () => 999), { code: "STORAGE_UNAVAILABLE" });
  failWrite = false;
  assert.equal(await store.getDurableValue("counter"), 20);
  failRead = true;
  await assert.rejects(() => store.mutateDurableValue("counter", () => 999), { code: "STORAGE_UNAVAILABLE" });
  failRead = false;
  expireLease = true;
  await assert.rejects(() => store.mutateDurableValue("counter", () => 999), { code: "STORAGE_UNAVAILABLE" });
  assert.equal(await store.getDurableValue("counter"), 20);
  assert.equal(values.get("write-lock:counter").ownerToken, "new-writer", "old writer cannot delete the new lease");
  console.log("durable Redis storage tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
