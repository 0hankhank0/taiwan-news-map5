const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `taiwan-news-tdx-guard-${Date.now()}.sqlite`);
process.env.DISABLE_LOCAL_EVENT_CACHE = "0";
process.env.EVENT_COORDINATION_BACKEND = "sqlite";

const store = require("../event-store");
const refresh = require("../event-refresh");

(async () => {
  assert.equal(refresh.getTaipeiTdxBudgetKey(Date.UTC(2026, 6, 30, 15, 59)), "tdx:request-budget:2026-07-30");
  assert.equal(refresh.getTaipeiTdxBudgetKey(Date.UTC(2026, 6, 30, 16, 0)), "tdx:request-budget:2026-07-31");
  assert.ok(refresh.secondsUntilTaipeiBudgetExpiry(Date.UTC(2026, 6, 30, 15, 59)) > 3600);

  const counterKey = `tdx:test-counter:${Date.now()}`;
  assert.equal(await store.incrementCachedCounter(counterKey, 1, { ex: 60 }), 1);
  assert.equal(await store.incrementCachedCounter(counterKey, 2, { ex: 60 }), 3);
  assert.equal(await store.getCachedCounter(counterKey), 3);
  await store.setCachedValue(counterKey, 219, { ex: 60 });
  const reservations = await Promise.all([store.reserveCachedCounter(counterKey, 1, { budget: 220, ex: 60 }), store.reserveCachedCounter(counterKey, 1, { budget: 220, ex: 60 })]);
  assert.equal(reservations.filter((item) => item.allowed).length, 1);
  assert.equal(await store.getCachedCounter(counterKey), 220);
  assert.deepEqual(await store.reserveCachedCounter(counterKey, 2, { budget: 220, ex: 60 }), { allowed: false, used: 220 });
  assert.equal(await store.getCachedCounter(counterKey), 220, "rejected reservations never increment the counter");
  assert.equal(store.canUseLocalCoordinationFallback(), true, "tests explicitly select the SQLite coordination backend");

  const locks = refresh.TDX_FETCH_LOCK_KEYS;
  assert.notEqual(locks.live, locks.static);
  assert.notEqual(locks.static, locks.construction);
  await Promise.all(Object.values(locks).map((key) => store.deleteCachedValue(key)));
  const concurrent = await Promise.all(Array.from({ length: 2 }, (_, i) => store.trySetCachedValue(locks.live, { owner: i }, { ex: 60 })));
  assert.equal(concurrent.filter(Boolean).length, 1, "only one concurrent caller obtains the live lock");
  assert.equal(await store.trySetCachedValue(locks.static, { owner: "static" }, { ex: 60 }), true);
  assert.equal(await store.trySetCachedValue(locks.construction, { owner: "construction" }, { ex: 60 }), true);

  const ownerKey = `tdx:test-owner:${Date.now()}`;
  assert.equal(await store.trySetCachedValue(ownerKey, { ownerToken: "instance-a" }, { ex: 1 }), true);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  // Expiry is removed lazily by the local store before B's atomic insert.
  await store.getCachedValue(ownerKey);
  assert.equal(await store.trySetCachedValue(ownerKey, { ownerToken: "instance-b" }, { ex: 60 }), true);
  assert.equal(await store.deleteCachedValueIfOwner(ownerKey, "instance-a"), false);
  assert.deepEqual(await store.getCachedValue(ownerKey), { ownerToken: "instance-b" });

  // Redis is entirely mocked: EVAL performs the same one-round-trip atomic
  // operations and records the supplied Lua so the test rejects a JS GET/SET
  // implementation or a non-atomic script.
  const redisValues = new Map(); const evalCalls = []; const expiries = [];
  store.__test.setKvClient({
    async eval(script, keys, args) {
      evalCalls.push({ script, keys, args }); const key = keys[0];
      if (script.includes("current+requested>budget")) {
        const current = Number(redisValues.get(key) || 0); const requested = Number(args[0]); const budget = Number(args[1]);
        if (current + requested > budget) return [0, current];
        redisValues.set(key, current + requested); if (current === 0 && Number(args[2]) > 0) expiries.push(key);
        return [1, current + requested];
      }
      const stored = redisValues.get(key);
      if (stored && JSON.parse(stored).ownerToken === args[0]) { redisValues.delete(key); return 1; }
      return 0;
    },
    async get(key) { return redisValues.has(key) ? redisValues.get(key) : null; },
  });
  const redisBudgetKey = `tdx:redis-budget:${Date.now()}`;
  redisValues.set(redisBudgetKey, 219);
  assert.deepEqual(await store.reserveCachedCounter(redisBudgetKey, 1, { budget: 220, ex: 60 }), { allowed: true, used: 220 });
  assert.deepEqual(await store.reserveCachedCounter(redisBudgetKey, 1, { budget: 220, ex: 60 }), { allowed: false, used: 220 });
  assert.deepEqual(await store.reserveCachedCounter(redisBudgetKey, 2, { budget: 220, ex: 60 }), { allowed: false, used: 220 });
  assert.equal(redisValues.get(redisBudgetKey), 220);
  assert.ok(evalCalls[0].script.includes("current+requested>budget"));
  const newRedisKey = `${redisBudgetKey}:new`;
  await store.reserveCachedCounter(newRedisKey, 1, { budget: 220, ex: 60 });
  await store.reserveCachedCounter(newRedisKey, 1, { budget: 220, ex: 60 });
  assert.deepEqual(expiries, [newRedisKey], "TTL is only set when Redis creates the counter");
  const redisLock = `${redisBudgetKey}:lock`;
  redisValues.set(redisLock, JSON.stringify({ ownerToken: "instance-b" }));
  assert.equal(await store.deleteCachedValueIfOwner(redisLock, "instance-a"), false);
  assert.equal(redisValues.has(redisLock), true);
  assert.equal(await store.deleteCachedValueIfOwner(redisLock, "instance-b"), true);
  assert.equal(redisValues.has(redisLock), false);
  assert.ok(evalCalls.at(-1).script.includes("data.ownerToken==ARGV[1]"));
  store.__test.resetKvClient();

  // A second run sees the durable lock and retains the durable cache instead
  // of issuing a request.  This tests the lock primitive used by all groups.
  await store.setCachedValue("tdx:live_cms_events", { events: [{ id: "retained" }] }, { ex: 60 });
  assert.equal(await store.trySetCachedValue(locks.live, { owner: "second" }, { ex: 60 }), false);
  assert.deepEqual((await store.getCachedValue("tdx:live_cms_events")).events, [{ id: "retained" }]);

  // A full source fetch with no available daily quota must be stopped before
  // fetch() is called and must not produce an empty replacement snapshot.
  await Promise.all(["tdx:live_cms_events", "tdx:static_cms", ...Object.values(locks)].map((key) => store.deleteCachedValue(key)));
  const originalBudget = process.env.TDX_DAILY_REQUEST_BUDGET;
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  process.env.TDX_DAILY_REQUEST_BUDGET = "0";
  global.fetch = async () => { fetchCalls += 1; throw new Error("fetch must be quota-blocked"); };
  await assert.rejects(() => refresh.fetchTDXTrafficEvents(Date.now()), /quota_guard/);
  assert.equal(fetchCalls, 0);
  assert.equal(await store.getCachedValue("tdx:live_cms_events"), undefined);
  global.fetch = originalFetch;

  // Production must fail closed: Redis coordination errors cannot fall back
  // to instance-local SQLite or issue a token/data request. Durable TDX cache
  // remains usable, while existing official/non-TDX events remain untouched.
  await store.setCachedValue("tdx:live_cms_events", { events: [{ id: "prod-live", source: "TDX CMS", category: "traffic", title: "cached", city: "Taipei", lat: 25.03, lng: 121.56, expiresAt: Date.now() + 60000 }] }, { ex: 60 });
  await store.setCachedValue("tdx:construction_events", { events: [{ id: "prod-construction", source: "TDX CMS", category: "construction", title: "cached work", city: "Taipei", lat: 25.03, lng: 121.56, expiresAt: Date.now() + 60000 }] }, { ex: 60 });
  const savedNodeEnv = process.env.NODE_ENV; const savedVercel = process.env.VERCEL; const savedBackend = process.env.EVENT_COORDINATION_BACKEND;
  const savedProductionClientId = process.env.TDX_CLIENT_ID; const savedProductionClientSecret = process.env.TDX_CLIENT_SECRET;
  process.env.NODE_ENV = "production"; process.env.VERCEL = "1"; process.env.EVENT_COORDINATION_BACKEND = "redis";
  store.__test.setKvClient({ async get() { throw new Error("redis://secret@example unavailable"); }, async set() { throw new Error("redis unavailable"); }, async eval() { throw new Error("redis unavailable"); } });
  assert.equal(store.canUseLocalCoordinationFallback(), false);
  const productionReservation = await store.reserveCachedCounter(`tdx:production:${Date.now()}`, 1, { budget: 220, ex: 60 });
  assert.deepEqual(productionReservation, { allowed: false, used: 0, reason: "coordination_unavailable", backend: "redis" });
  process.env.TDX_CLIENT_ID = "test-client"; process.env.TDX_CLIENT_SECRET = "test-secret";
  let productionFetches = 0;
  global.fetch = async () => { productionFetches += 1; throw new Error("TDX must not be called"); };
  await assert.rejects(() => refresh.fetchTDXAccessToken(Date.now()), /coordination_unavailable/);
  const productionSources = await refresh.fetchDefaultSources("traffic", Date.now(), { tdxDelayMs: 0 });
  assert.equal(productionFetches, 0, "production coordination outage issues zero TDX requests");
  assert.equal(productionSources.__collectorResults.tdxTraffic.reason, "TDX coordination_unavailable: token service unavailable");
  assert.equal(productionSources.__collectorResults.tdxTraffic.retainedSource, "persistent_cache");
  assert.equal(productionSources.tdxEvents[0].id, "prod-live");
  const productionRefresh = await refresh.runEventRefresh({ mode: "traffic", write: false, existingEvents: [{ id: "official-live", source: "TDX CMS", category: "traffic", title: "official", city: "Taipei", lat: 25.04, lng: 121.52, expiresAt: Date.now() + 60000 }, { id: "manual", source: "manual", category: "other", title: "manual", city: "Taipei", lat: 25.04, lng: 121.52, expiresAt: Date.now() + 60000 }], sourceData: productionSources, skipExternalGeocoding: true });
  assert.equal(productionRefresh.events.some((event) => event.id === "official-live"), true, "coordination failure retains official TDX events");
  assert.equal(productionRefresh.events.some((event) => event.id === "manual"), true, "coordination failure retains non-TDX events");
  assert.equal(productionRefresh.tdxBudget.available, false);
  assert.equal(productionRefresh.tdxLayers.live.outcome, "coordination_unavailable");
  assert.equal(JSON.stringify(productionRefresh).includes("redis://secret"), false, "Redis connection details are not exposed");
  const trafficWorkflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "refresh-traffic.yml"), "utf8");
  assert.match(trafficWorkflow, /payload\.status === "partial_success" && count >= 0/, "traffic workflow accepts retained partial success");
  global.fetch = originalFetch;
  store.__test.resetKvClient();
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
  if (savedVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = savedVercel;
  if (savedBackend === undefined) delete process.env.EVENT_COORDINATION_BACKEND; else process.env.EVENT_COORDINATION_BACKEND = savedBackend;
  if (savedProductionClientId === undefined) delete process.env.TDX_CLIENT_ID; else process.env.TDX_CLIENT_ID = savedProductionClientId;
  if (savedProductionClientSecret === undefined) delete process.env.TDX_CLIENT_SECRET; else process.env.TDX_CLIENT_SECRET = savedProductionClientSecret;

  await store.setCachedValue(refresh.getTaipeiTdxBudgetKey(), 204, { ex: 60 });
  const nearLimit = await refresh.runEventRefresh({ mode: "traffic", write: false, sourceData: {}, existingEvents: [] });
  assert.equal(nearLimit.tdxBudget.warning, "budget_near_limit");
  if (originalBudget === undefined) delete process.env.TDX_DAILY_REQUEST_BUDGET;
  else process.env.TDX_DAILY_REQUEST_BUDGET = originalBudget;

  // Every TDX data request that actually reaches fetch() is charged, even
  // when the provider responds with a retryable or authorization failure.
  const dailyKey = refresh.getTaipeiTdxBudgetKey();
  await store.deleteCachedValue(dailyKey);
  process.env.TDX_DAILY_REQUEST_BUDGET = "20";
  const statuses = [408, 401, 403, 429, 500]; let sent = 0;
  global.fetch = async () => ({ ok: false, status: statuses[sent++], text: async () => "mock provider failure" });
  for (const status of statuses) await assert.rejects(() => refresh.fetchTdxJson("https://tdx.mock/data", {}, Date.now()), new RegExp(`HTTP ${status}`));
  assert.equal(sent, statuses.length);
  assert.equal(await store.getCachedCounter(dailyKey), statuses.length);
  global.fetch = originalFetch;
  if (originalBudget === undefined) delete process.env.TDX_DAILY_REQUEST_BUDGET;
  else process.env.TDX_DAILY_REQUEST_BUDGET = originalBudget;

  // Token issuance is also a real TDX HTTP request and consumes the same
  // daily reservation before its request is sent.
  await store.deleteCachedValue(dailyKey);
  process.env.TDX_DAILY_REQUEST_BUDGET = "1";
  const priorClientId = process.env.TDX_CLIENT_ID;
  const priorClientSecret = process.env.TDX_CLIENT_SECRET;
  process.env.TDX_CLIENT_ID = "test-client";
  process.env.TDX_CLIENT_SECRET = "test-secret";
  let tokenCalls = 0;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => { tokenCalls += 1; return { access_token: "test-token" }; } });
  assert.equal(await refresh.fetchTDXAccessToken(Date.now()), "test-token");
  assert.equal(tokenCalls, 1);
  assert.equal(await store.getCachedCounter(dailyKey), 1);
  global.fetch = originalFetch;
  if (priorClientId === undefined) delete process.env.TDX_CLIENT_ID; else process.env.TDX_CLIENT_ID = priorClientId;
  if (priorClientSecret === undefined) delete process.env.TDX_CLIENT_SECRET; else process.env.TDX_CLIENT_SECRET = priorClientSecret;
  if (originalBudget === undefined) delete process.env.TDX_DAILY_REQUEST_BUDGET;
  else process.env.TDX_DAILY_REQUEST_BUDGET = originalBudget;

  // Traffic mode stays isolated from RSS, AI and activity collectors. With
  // no TDX credentials or cache it has no external request to make at all.
  const originalClientId = process.env.TDX_CLIENT_ID;
  const originalClientSecret = process.env.TDX_CLIENT_SECRET;
  delete process.env.TDX_CLIENT_ID;
  delete process.env.TDX_CLIENT_SECRET;
  await store.deleteCachedValue("tdx_access_token");
  let trafficModeFetches = 0;
  global.fetch = async () => { trafficModeFetches += 1; throw new Error("traffic mode must not fetch news providers"); };
  const trafficOnly = await refresh.fetchDefaultSources("traffic", Date.now(), { tdxDelayMs: 0 });
  assert.equal(trafficModeFetches, 0, "traffic mode must not call RSS, AI, iCulture or KKTIX");
  assert.deepEqual(trafficOnly.rssItems, []);
  if (originalClientId === undefined) delete process.env.TDX_CLIENT_ID; else process.env.TDX_CLIENT_ID = originalClientId;
  if (originalClientSecret === undefined) delete process.env.TDX_CLIENT_SECRET; else process.env.TDX_CLIENT_SECRET = originalClientSecret;
  global.fetch = originalFetch;

  // Mock-only failure paths: neither group may retain its long fetch lock
  // after every endpoint times out; both switch to the 15-minute backoff.
  await Promise.all(["tdx:static_cms", "tdx:construction_events", locks.static, locks.construction].map((key) => store.deleteCachedValue(key)));
  refresh.setBackoffUntil("staticCms", 0);
  refresh.setBackoffUntil("construction", 0);
  process.env.TDX_DAILY_REQUEST_BUDGET = "100";
  global.fetch = async () => { throw new Error("mock timeout"); };
  await assert.rejects(() => refresh.loadStaticCmsCache("", Date.now()), /All TDX static CMS subrequests failed/);
  assert.equal(await store.getCachedValue(locks.static), undefined, "static long lock is released after total timeout");
  assert.ok(refresh.getBackoffUntil("staticCms") - Date.now() > 14 * 60 * 1000, "static receives short backoff");
  await assert.rejects(() => refresh.fetchTDXConstructionEvents("", Date.now()), /All TDX construction subrequests failed/);
  assert.equal(await store.getCachedValue(locks.construction), undefined, "construction long lock is released after total failure");
  assert.ok(refresh.getBackoffUntil("construction") - Date.now() > 14 * 60 * 1000, "construction receives short backoff");
  global.fetch = originalFetch;
  if (originalBudget === undefined) delete process.env.TDX_DAILY_REQUEST_BUDGET;
  else process.env.TDX_DAILY_REQUEST_BUDGET = originalBudget;
  console.log("tdx quota guard tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
