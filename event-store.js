const fs = require("fs");
const os = require("os");
const path = require("path");
const { Redis } = require("@upstash/redis");

const NEWS_CACHE_KEY = "taiwan_news_cache";
const TRAFFIC_CACHE_KEY = "taiwan_traffic_cache";
const EVENT_CACHE_KEY = "taiwan_traffic_events";
const MERGED_EVENT_CACHE_KEY = "events:merged";
const EVENT_BUCKET_KEY_MAP = Object.freeze({
  traffic: "events:traffic",
  news: "events:news",
  activities: "events:activities",
});
const EVENT_BUCKET_KEYS = Object.values(EVENT_BUCKET_KEY_MAP);
const EVENT_REVIEW_LOG_KEY = "events:review-log";
const EVENT_REFRESH_STATUS_KEY = "events:refresh-status";
const EVENT_REFRESH_LOG_KEY = "events:refresh-log";
const MAX_REFRESH_LOG_ENTRIES = 200;
const EVENT_REFRESH_RUN_PREFIX = "events:refresh-run:";
const EVENT_REFRESH_RUN_INDEX_KEY = "events:refresh-run-index";
const OFFICIAL_EVENTS_KEY = "events:official";
const EVENT_CANDIDATES_KEY = "events:candidates";
const publishLocks = new Map();
const MAX_REFRESH_RUN_DETAILS = 50;
const REFRESH_RUN_DETAIL_TTL_SECONDS = 60 * 60 * 24 * 14;
const CRON_LOCK_KEY = "cron:lock";
const DEFAULT_CRON_LOCK_TTL_SECONDS = 120;
const CLEARABLE_EVENT_CACHE_KEYS = [
  NEWS_CACHE_KEY,
  TRAFFIC_CACHE_KEY,
  EVENT_CACHE_KEY,
  MERGED_EVENT_CACHE_KEY,
  ...EVENT_BUCKET_KEYS,
];

function createKvClient() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const kv = createKvClient();
let sqliteDb = null;

function getSqlitePath() {
  if (process.env.EVENT_DB_PATH) return process.env.EVENT_DB_PATH;
  if (process.env.VERCEL) return path.join(os.tmpdir(), "taiwan-news-cache.sqlite");
  return path.join(process.cwd(), "data", "taiwan-news-cache.sqlite");
}

function getSqliteDb() {
  if (sqliteDb) return sqliteDb;

  const dbPath = getSqlitePath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const { DatabaseSync } = require("node:sqlite");
  sqliteDb = new DatabaseSync(dbPath);
  sqliteDb.exec("PRAGMA busy_timeout = 5000");
  sqliteDb.exec("PRAGMA journal_mode = WAL");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS cache_entries (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER
    )
  `);
  return sqliteDb;
}

function shouldSkipLocalCache() {
  return process.env.DISABLE_LOCAL_EVENT_CACHE === "1";
}

function decodeCachedValue(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("[") && !trimmed.startsWith("{"))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

async function getKvValue(key) {
  if (!kv) return undefined;
  try {
    const value = await kv.get(key);
    return value === null ? undefined : decodeCachedValue(value);
  } catch (error) {
    console.warn(`[event-store] KV get failed for ${key}:`, error.message);
    return undefined;
  }
}

async function setKvValue(key, value, options = {}) {
  if (!kv) return false;
  try {
    await kv.set(key, value, options);
    return true;
  } catch (error) {
    console.warn(`[event-store] KV set failed for ${key}:`, error.message);
    return false;
  }
}

async function trySetKvValue(key, value, options = {}) {
  if (!kv) return undefined;
  try {
    const result = await kv.set(key, value, { ...options, nx: true });
    return result === "OK" || result === "ok" || result === true;
  } catch (error) {
    console.warn(`[event-store] KV nx set failed for ${key}:`, error.message);
    return undefined;
  }
}

async function deleteKvValue(key) {
  if (!kv) return false;
  try {
    await kv.del(key);
    return true;
  } catch (error) {
    console.warn(`[event-store] KV delete failed for ${key}:`, error.message);
    return false;
  }
}

function getSqliteValue(key) {
  if (shouldSkipLocalCache()) return undefined;

  try {
    const db = getSqliteDb();
    const row = db
      .prepare("SELECT value, expires_at FROM cache_entries WHERE key = ?")
      .get(key);
    if (!row) return undefined;

    if (row.expires_at && row.expires_at <= Date.now()) {
      db.prepare("DELETE FROM cache_entries WHERE key = ?").run(key);
      return undefined;
    }

    return decodeCachedValue(JSON.parse(row.value));
  } catch (error) {
    console.warn(`[event-store] SQLite get failed for ${key}:`, error.message);
    return undefined;
  }
}

function getSqliteEntryMeta(key) {
  if (shouldSkipLocalCache()) return null;

  try {
    const db = getSqliteDb();
    const row = db
      .prepare("SELECT value, updated_at, expires_at FROM cache_entries WHERE key = ?")
      .get(key);
    if (!row) return null;

    let count = null;
    try {
      const value = decodeCachedValue(JSON.parse(row.value));
      if (Array.isArray(value)) count = value.length;
    } catch {}

    return {
      key,
      count,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    };
  } catch (error) {
    console.warn(`[event-store] SQLite meta failed for ${key}:`, error.message);
    return null;
  }
}

function setSqliteValue(key, value, options = {}) {
  if (shouldSkipLocalCache()) return false;

  try {
    const db = getSqliteDb();
    const expiresAt = options.ex ? Date.now() + Number(options.ex) * 1000 : null;
    db.prepare(`
      INSERT INTO cache_entries (key, value, updated_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `).run(key, JSON.stringify(value), Date.now(), expiresAt);
    return true;
  } catch (error) {
    console.warn(`[event-store] SQLite set failed for ${key}:`, error.message);
    return false;
  }
}

function trySetSqliteValue(key, value, options = {}) {
  if (shouldSkipLocalCache()) return false;
  if (getSqliteValue(key) !== undefined) return false;
  return setSqliteValue(key, value, options);
}

function deleteSqliteValue(key) {
  if (shouldSkipLocalCache()) return false;

  try {
    const db = getSqliteDb();
    db.prepare("DELETE FROM cache_entries WHERE key = ?").run(key);
    return true;
  } catch (error) {
    console.warn(`[event-store] SQLite delete failed for ${key}:`, error.message);
    return false;
  }
}

async function getCachedValue(key) {
  const kvValue = await getKvValue(key);
  if (kvValue !== undefined) {
    setSqliteValue(key, kvValue);
    return kvValue;
  }
  return getSqliteValue(key);
}

async function setCachedValue(key, value, options = {}) {
  const kvOk = await setKvValue(key, value, options);
  const sqliteOk = setSqliteValue(key, value, options);
  return kvOk || sqliteOk;
}

async function trySetCachedValue(key, value, options = {}) {
  const kvResult = await trySetKvValue(key, value, options);
  if (kvResult === true) {
    setSqliteValue(key, value, options);
    return true;
  }
  if (kvResult === false) return false;
  return trySetSqliteValue(key, value, options);
}

async function deleteCachedValue(key) {
  const kvOk = await deleteKvValue(key);
  const sqliteOk = deleteSqliteValue(key);
  return kvOk || sqliteOk;
}

async function getCachedEvents() {
  const mergedEvents = await getCachedValue(MERGED_EVENT_CACHE_KEY);
  if (Array.isArray(mergedEvents) && mergedEvents.length > 0) return mergedEvents;

  const buckets = await Promise.all(EVENT_BUCKET_KEYS.map((key) => getCachedValue(key)));
  const bucketEvents = dedupeEvents(buckets.flatMap((value) => (Array.isArray(value) ? value : [])));
  if (bucketEvents.length > 0) return bucketEvents;

  const legacyEvents = await getCachedValue(EVENT_CACHE_KEY);
  return Array.isArray(legacyEvents) ? legacyEvents : [];
}

// `events:official` is the canonical event collection.  The older cache keys
// remain a read-through compatibility cache for deployments upgraded in place.
async function getOfficialEvents() {
  if (process.env.EVENT_STORE_MODE === "supabase") return require("./supabase-event-repository").getOfficialEvents();
  const official = await getCachedValue(OFFICIAL_EVENTS_KEY);
  if (Array.isArray(official)) return official;
  const legacy = await getCachedEvents();
  if (legacy.length) await setCachedValue(OFFICIAL_EVENTS_KEY, legacy);
  return legacy;
}

async function migrateLegacyEvents() {
  const official = await getCachedValue(OFFICIAL_EVENTS_KEY);
  const legacy = await getCachedEvents();
  const merged = dedupeEvents([...(Array.isArray(official) ? official : []), ...legacy]);
  // Write even for an empty legacy store: the empty official collection is a
  // completed, idempotent migration marker rather than an ambiguous cache miss.
  if (!Array.isArray(official) || merged.length !== official.length) await setOfficialEvents(merged);
  return { migrated: Math.max(0, merged.length - (Array.isArray(official) ? official.length : 0)), total: merged.length };
}

async function setOfficialEvents(events, options = {}) {
  if (process.env.EVENT_STORE_MODE === "supabase") return require("./supabase-event-repository").setOfficialEvents(events);
  const safe = dedupeEvents(Array.isArray(events) ? events : []);
  await setCachedValue(OFFICIAL_EVENTS_KEY, safe, options);
  // Kept in sync for old workers and bucket readers; consumers must read the
  // official collection above, never a bucket directly.
  await setCachedEvents(safe, options);
  await writeEventBuckets(safe, options);
  return safe;
}

async function updateOfficialEvent(eventId, patch = {}, actor = "admin") {
  const events = await getOfficialEvents();
  const index = findEventIndex(events, eventId);
  if (index < 0) return null;
  const now = new Date().toISOString();
  const current = events[index];
  const normalizedPatch = normalizeEventPatch(patch);
  const next = { ...current, ...normalizedPatch, updatedAt: now, statusSource: "manual", sourceTrace: buildSourceTrace(current), adminReview: { ...(current.adminReview || {}), adminNote: normalizedPatch.adminNote ?? current.adminReview?.adminNote ?? "", actor, updatedAt: now } };
  events[index] = next;
  await setOfficialEvents(events);
  return next;
}

function candidateId() { return `candidate_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
async function getEventCandidates(options = {}) {
  if (process.env.EVENT_STORE_MODE === "supabase") return require("./supabase-event-repository").getEventCandidates(options);
  let items = await getCachedValue(EVENT_CANDIDATES_KEY);
  items = Array.isArray(items) ? items : [];
  if (options.status) items = items.filter((item) => item.status === options.status);
  return items;
}
async function saveEventCandidates(items) { await setCachedValue(EVENT_CANDIDATES_KEY, items.slice(0, 5000)); return items; }
async function createEventCandidates(items, meta = {}) {
  if (process.env.EVENT_STORE_MODE === "supabase") return require("./supabase-event-repository").createEventCandidates(items, meta);
  const now = new Date().toISOString();
  const existing = await getEventCandidates();
  const created = (Array.isArray(items) ? items : []).map((raw) => ({
    candidateId: raw.candidateId || candidateId(), source: raw.source || raw.sourceName || "unknown", status: raw.status || "pending",
    publishedEventId: raw.publishedEventId || null, batchId: meta.batchId || raw.batchId || null, rawSourceData: raw.rawSourceData || raw,
    event: raw.event || raw, createdAt: raw.createdAt || now, updatedAt: now,
  }));
  await saveEventCandidates([...created, ...existing]);
  return created;
}
async function withPublishLock(key, work) {
  const previous = publishLocks.get(key) || Promise.resolve();
  let release; const current = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => current); publishLocks.set(key, queued);
  await previous;
  try { return await work(); } finally { release(); if (publishLocks.get(key) === queued) publishLocks.delete(key); }
}
function writePublishSnapshot(events, candidates) {
  if (shouldSkipLocalCache()) return false;
  const db = getSqliteDb(); const now = Date.now();
  const write = db.prepare(`INSERT INTO cache_entries (key,value,updated_at,expires_at) VALUES (?, ?, ?, NULL) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,expires_at=NULL`);
  db.exec("BEGIN IMMEDIATE");
  try { write.run(OFFICIAL_EVENTS_KEY, JSON.stringify(events), now); write.run(EVENT_CANDIDATES_KEY, JSON.stringify(candidates), now); db.exec("COMMIT"); return true; }
  catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
}
async function publishEventCandidate(candidateIdValue, patch = {}, options = {}) {
 if (process.env.EVENT_STORE_MODE === "supabase") return require("./supabase-event-repository").publishEventCandidate(candidateIdValue, patch, options);
 return withPublishLock(String(candidateIdValue), async () => {
  // The local SQLite fallback is the durable runtime on Vercel/local.  A
  // snapshot transaction prevents a half-published candidate when event write
  // or candidate write fails.  KV is updated only after the snapshot succeeds.
  const candidates = await getEventCandidates();
  const index = candidates.findIndex((item) => item.candidateId === candidateIdValue);
  if (index < 0) return null;
  const candidate = candidates[index];
  if (candidate.status === "published" && candidate.publishedEventId) return { candidate, event: (await getOfficialEvents()).find((x) => x.id === candidate.publishedEventId) };
  const events = await getOfficialEvents();
  const now = new Date().toISOString();
  const eventId = candidate.publishedEventId || patch.id || `event:${candidate.candidateId}`;
  const base = candidate.event || candidate.rawSourceData || {};
  const event = { ...base, ...patch, id: eventId, source: base.source || candidate.source, sourceName: base.sourceName || candidate.source, candidateId: candidate.candidateId, batchId: candidate.batchId, status: patch.status || base.status || "active", createdAt: base.createdAt || now, updatedAt: now };
  const eventIndex = findEventIndex(events, eventId);
  if (eventIndex >= 0) events[eventIndex] = { ...events[eventIndex], ...event }; else events.unshift(event);
  const nextCandidate = { ...candidate, status: "published", publishedEventId: eventId, updatedAt: now, publishedAt: now };
  const nextCandidates = [...candidates]; nextCandidates[index] = nextCandidate;
  if (options.failAfterEvent) throw new Error("Simulated publish failure");
  writePublishSnapshot(events, nextCandidates);
  // Mirrors are best-effort compatibility caches.  The atomic SQLite snapshot
  // above remains the source of truth if a mirror write fails.
  await Promise.all([setKvValue(OFFICIAL_EVENTS_KEY, events), setKvValue(EVENT_CANDIDATES_KEY, nextCandidates)]);
  await setCachedEvents(events); await writeEventBuckets(events);
  return { candidate: nextCandidate, event };
 });
}

async function getEventCacheStatus() {
  const keys = [MERGED_EVENT_CACHE_KEY, ...EVENT_BUCKET_KEYS, EVENT_CACHE_KEY];
  const entries = keys.map((key) => getSqliteEntryMeta(key)).filter(Boolean);
  const lastLocalUpdate = entries
    .map((entry) => Date.parse(entry.updatedAt || ""))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  const events = await getCachedEvents();
  const refreshStatus = await getRefreshStatus();
  const cronLock = await getCronLockStatus();
  return {
    hasKv: Boolean(kv),
    localEntries: entries,
    lastLocalUpdate: lastLocalUpdate ? new Date(lastLocalUpdate).toISOString() : null,
    eventCount: Array.isArray(events) ? events.length : 0,
    refreshStatus,
    cronLock,
  };
}

async function setCachedEvents(events, options = {}) {
  const safeEvents = Array.isArray(events) ? events : [];
  const legacyOk = await setCachedValue(EVENT_CACHE_KEY, safeEvents, options);
  const mergedOk = await setCachedValue(MERGED_EVENT_CACHE_KEY, safeEvents, options);
  return legacyOk || mergedOk;
}

function getEventBucketGroups(events) {
  const safeEvents = Array.isArray(events) ? events : [];
  const trafficEvents = safeEvents.filter((event) => ["traffic", "construction", "accident"].includes(event?.category));
  const activityEvents = safeEvents.filter((event) => event?.category === "activity");
  const newsEvents = safeEvents.filter((event) => !trafficEvents.includes(event) && event?.category !== "activity");
  return {
    traffic: trafficEvents,
    news: newsEvents,
    activities: activityEvents,
  };
}

async function writeEventBuckets(events, options = { ex: 600 }) {
  const buckets = getEventBucketGroups(events);
  await Promise.all([
    setCachedValue(EVENT_BUCKET_KEY_MAP.traffic, buckets.traffic, options),
    setCachedValue(EVENT_BUCKET_KEY_MAP.news, buckets.news, options),
    setCachedValue(EVENT_BUCKET_KEY_MAP.activities, buckets.activities, options),
  ]);
  return {
    traffic: buckets.traffic.length,
    news: buckets.news.length,
    activities: buckets.activities.length,
  };
}

async function clearEventCaches(keys = CLEARABLE_EVENT_CACHE_KEYS) {
  const uniqueKeys = Array.from(new Set(keys));
  const results = await Promise.all(uniqueKeys.map(async (key) => ({
    key,
    cleared: await deleteCachedValue(key),
  })));
  return {
    clearedKeys: results.filter((result) => result.cleared).map((result) => result.key),
    attemptedKeys: uniqueKeys,
  };
}

async function setRefreshStatus(status = {}) {
  const previous = await getRefreshStatus();
  const completedAt = status.completedAt || status.updatedAt || new Date().toISOString();
  const payload = {
    ...(previous || {}),
    ...status,
    lastSuccessAt: previous?.lastSuccessAt || "",
    lastSuccessRunId: previous?.lastSuccessRunId || "",
    lastError: previous?.lastError || null,
    updatedAt: status.updatedAt || new Date().toISOString(),
  };

  if (status.status === "success") {
    payload.lastSuccessAt = completedAt;
    payload.lastSuccessRunId = status.runId || "";
    payload.consecutiveFailures = 0;
  }
  if (status.status === "error") {
    payload.lastError = {
      message: status.error || "unknown error",
      runId: status.runId || "",
      at: completedAt,
    };
    payload.consecutiveFailures = Number(previous?.consecutiveFailures || 0) + 1;
  }

  await setCachedValue(EVENT_REFRESH_STATUS_KEY, payload);
  return payload;
}

async function getRefreshStatus() {
  const value = await getCachedValue(EVENT_REFRESH_STATUS_KEY);
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function cleanRefreshLogError(value) {
  if (!value) return null;
  return String(value)
    .replace(/\b(?:authorization|bearer|token|api[_ -]?key|cron_secret)\b\s*[:=]?\s*(?:bearer\s+)?[^\s,;]+/gi, "[redacted]")
    .replace(/https?:\/\/[^\s?#]+\?[^\s]+/gi, (url) => url.split("?")[0])
    .replace(/\s+at\s+[^\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500) || null;
}

function normalizeRefreshLogEntry(entry = {}) {
  const startedAt = new Date(entry.startedAt || Date.now()).toISOString();
  const completedAt = entry.completedAt ? new Date(entry.completedAt).toISOString() : startedAt;
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const counts = entry.sourceCounts || {};
  const buckets = entry.buckets || {};
  return {
    runId: String(entry.runId || ""),
    trigger: ["scheduled", "manual", "unknown"].includes(entry.trigger) ? entry.trigger : "unknown",
    mode: ["all", "news", "traffic"].includes(entry.mode) ? entry.mode : "all",
    status: ["success", "partial_success", "error", "skipped", "running"].includes(entry.status) ? entry.status : "error",
    startedAt,
    completedAt,
    durationMs: Math.max(0, number(entry.durationMs)),
    count: Math.max(0, number(entry.count)),
    sourceCounts: {
      rssItems: Math.max(0, number(counts.rssItems)), tdx: Math.max(0, number(counts.tdx)),
      construction: Math.max(0, number(counts.construction)), activities: Math.max(0, number(counts.activities)),
      ai: Math.max(0, number(counts.ai)), ruleBased: Math.max(0, number(counts.ruleBased)),
      normalized: Math.max(0, number(counts.normalized)), active: Math.max(0, number(counts.active)),
    },
    buckets: { traffic: Math.max(0, number(buckets.traffic)), news: Math.max(0, number(buckets.news)), activities: Math.max(0, number(buckets.activities)) },
    geocodingAttempts: Math.max(0, number(entry.geocodingAttempts)),
    geocodingHits: Math.max(0, number(entry.geocodingHits)),
    cacheTtlSeconds: Math.max(0, number(entry.cacheTtlSeconds)),
    rawCount: Math.max(0, number(entry.rawCount)),
    errorSourceCount: Math.max(0, number(entry.errorSourceCount)),
    cacheWritten: Boolean(entry.cacheWritten),
    error: cleanRefreshLogError(entry.error),
    ...(entry.skippedReason === "cron_lock" ? { skippedReason: "cron_lock" } : {}),
  };
}

function refreshRunKey(runId) {
  return `${EVENT_REFRESH_RUN_PREFIX}${String(runId || "").trim()}`;
}

function sanitizeRefreshRunItem(item = {}) {
  return {
    title: String(item.title || "").slice(0, 240),
    source: String(item.source || item.sourceName || "unknown").slice(0, 120),
    url: String(item.url || item.sourceUrl || "").split("?")[0].slice(0, 500),
    fetchedAt: String(item.fetchedAt || item.publishedAt || item.createdAt || ""),
    category: String(item.category || ""),
    location: String(item.location || [item.city, item.district, item.address, item.venue].filter(Boolean).join(" ")).slice(0, 240),
    processingResult: ["fetched", "normalized", "accepted", "filtered", "duplicate", "merged", "location_failed", "expired", "source_error"].includes(item.processingResult) ? item.processingResult : "fetched",
    processingReason: cleanRefreshLogError(item.processingReason) || "",
    eventId: String(item.eventId || item.id || "").slice(0, 180),
  };
}

function sanitizeRefreshRunDetails(details = {}) {
  const source = (value = {}) => ({
    status: ["success", "warning", "skipped", "failed"].includes(value.status) ? value.status : "failed",
    count: Math.max(0, Number(value.count) || 0),
    durationMs: Math.max(0, Number(value.durationMs) || 0),
    reason: cleanRefreshLogError(value.reason),
    requestCount: Math.max(0, Number(value.requestCount) || 0), fetchedCount: Math.max(0, Number(value.fetchedCount ?? value.count) || 0),
    parsedCount: Math.max(0, Number(value.parsedCount ?? value.count) || 0), keptCount: Math.max(0, Number(value.keptCount ?? value.count) || 0),
    duplicateCount: Math.max(0, Number(value.duplicateCount) || 0), rejectedCount: Math.max(0, Number(value.rejectedCount) || 0),
    successfulSubrequestCount: Math.max(0, Number(value.successfulSubrequestCount) || 0), failedSubrequestCount: Math.max(0, Number(value.failedSubrequestCount) || 0),
    subrequests: (Array.isArray(value.subrequests) ? value.subrequests : []).slice(0, 100).map((item) => ({ endpoint: String(item.endpoint || "").slice(0, 200), status: ["success","failed"].includes(item.status) ? item.status : "failed", httpStatus: Number.isFinite(Number(item.httpStatus)) ? Number(item.httpStatus) : null, durationMs: Math.max(0, Number(item.durationMs) || 0), fetchedCount: Math.max(0, Number(item.fetchedCount) || 0), errorCode: String(item.errorCode || "").slice(0, 80), errorMessage: cleanRefreshLogError(item.errorMessage) })),
    error: cleanRefreshLogError(value.error),
    items: (Array.isArray(value.items) ? value.items : []).slice(0, 100).map(sanitizeRefreshRunItem),
  });
  const pipeline = details.pipeline || {};
  return {
    runId: String(details.runId || ""), startedAt: String(details.startedAt || ""), completedAt: String(details.completedAt || ""),
    status: ["success", "partial_success", "error", "skipped"].includes(details.status) ? details.status : "error",
    mode: ["all", "news", "traffic"].includes(details.mode) ? details.mode : "all",
    trigger: ["scheduled", "manual", "unknown"].includes(details.trigger) ? details.trigger : "unknown",
    cacheWritten: Boolean(details.cacheWritten),
    error: cleanRefreshLogError(details.error),
    sources: {
      rss: source(details.sources?.rss), tdxTraffic: source(details.sources?.tdxTraffic),
      tdxConstruction: source(details.sources?.tdxConstruction), kktix: source(details.sources?.kktix),
      ai: source(details.sources?.ai), ruleBased: source(details.sources?.ruleBased), location: source(details.sources?.location),
    },
    pipeline: {
      rawCount: Math.max(0, Number(pipeline.rawCount) || 0), normalizedCount: Math.max(0, Number(pipeline.normalizedCount) || 0),
      filteredCount: Math.max(0, Number(pipeline.filteredCount) || 0), duplicateCount: Math.max(0, Number(pipeline.duplicateCount) || 0),
      finalCount: Math.max(0, Number(pipeline.finalCount) || 0),
    },
    finalEvents: (Array.isArray(details.finalEvents) ? details.finalEvents : []).slice(0, 200).map(sanitizeRefreshRunItem),
  };
}

async function getRefreshRunDetail(runId) {
  const value = await getCachedValue(refreshRunKey(runId));
  return value && typeof value === "object" && !Array.isArray(value) ? sanitizeRefreshRunDetails(value) : null;
}

async function saveRefreshRunDetail(details = {}) {
  const safe = sanitizeRefreshRunDetails(details);
  if (!safe.runId) return null;
  await setCachedValue(refreshRunKey(safe.runId), safe, { ex: REFRESH_RUN_DETAIL_TTL_SECONDS });
  const current = await getCachedValue(EVENT_REFRESH_RUN_INDEX_KEY);
  const next = [{ runId: safe.runId, startedAt: safe.startedAt }, ...(Array.isArray(current) ? current : []).filter((item) => item?.runId !== safe.runId)]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const expired = next.slice(MAX_REFRESH_RUN_DETAILS);
  await Promise.all(expired.map((item) => deleteCachedValue(refreshRunKey(item.runId))));
  await setCachedValue(EVENT_REFRESH_RUN_INDEX_KEY, next.slice(0, MAX_REFRESH_RUN_DETAILS), { ex: REFRESH_RUN_DETAIL_TTL_SECONDS });
  return safe;
}

async function getRefreshLog() {
  const value = await getCachedValue(EVENT_REFRESH_LOG_KEY);
  return (Array.isArray(value) ? value : [])
    .map(normalizeRefreshLogEntry)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

async function appendRefreshLog(entry = {}) {
  const next = normalizeRefreshLogEntry(entry);
  const existing = await getRefreshLog();
  const log = [next, ...existing]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, MAX_REFRESH_LOG_ENTRIES);
  await setCachedValue(EVENT_REFRESH_LOG_KEY, log);
  return next;
}

function createLockPayload(owner, ttlSeconds) {
  const now = Date.now();
  return {
    owner,
    startedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
  };
}

async function acquireCronLock(options = {}) {
  const ttlSeconds = Math.max(30, Number(options.ttlSeconds || process.env.CRON_LOCK_TTL_SECONDS || DEFAULT_CRON_LOCK_TTL_SECONDS));
  const owner = String(options.owner || `cron-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const lock = createLockPayload(owner, ttlSeconds);
  const acquired = await trySetCachedValue(CRON_LOCK_KEY, lock, { ex: ttlSeconds });
  if (acquired) return { acquired: true, lock };
  return { acquired: false, lock: await getCronLockStatus() };
}

async function releaseCronLock(owner) {
  const current = await getCachedValue(CRON_LOCK_KEY);
  if (owner && current?.owner && current.owner !== owner) return false;
  return deleteCachedValue(CRON_LOCK_KEY);
}

async function getCronLockStatus() {
  const lock = await getCachedValue(CRON_LOCK_KEY);
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) {
    return { locked: false };
  }

  const expiresAtMs = Date.parse(lock.expiresAt || "");
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
    await deleteCachedValue(CRON_LOCK_KEY);
    return { locked: false };
  }

  return {
    locked: true,
    owner: lock.owner || "",
    startedAt: lock.startedAt || "",
    expiresAt: lock.expiresAt || "",
  };
}

function findEventIndex(events, eventId) {
  const key = String(eventId || "").trim();
  if (!key) return -1;
  return events.findIndex((event) =>
    String(event?.id || "") === key
    || String(event?.eventId || "") === key
    || String(event?.eventFingerprint || "") === key
  );
}

function buildSourceTrace(event) {
  if (Array.isArray(event?.sourceTrace) && event.sourceTrace.length > 0) return event.sourceTrace;
  if (Array.isArray(event?.sources) && event.sources.length > 0) {
    return event.sources.map((source) => ({
      outlet: String(source.outlet || source.source || event.sourceName || event.source || "").trim(),
      title: String(source.title || event.title || "").trim(),
      url: String(source.url || source.sourceUrl || event.sourceUrl || event.url || "").trim(),
      capturedAt: event.updatedAt || event.publishedAt || event.createdAt || "",
    }));
  }
  return [{
    outlet: String(event?.sourceName || event?.source || "unknown").trim(),
    title: String(event?.title || "").trim(),
    url: String(event?.sourceUrl || event?.url || "").trim(),
    capturedAt: event?.updatedAt || event?.publishedAt || event?.createdAt || "",
  }];
}

function normalizeEventPatch(patch = {}) {
  const allowed = {};
  if (patch.title !== undefined) allowed.title = String(patch.title).trim();
  if (patch.content !== undefined) allowed.content = String(patch.content).trim();
  if (patch.category !== undefined) allowed.category = String(patch.category).trim();
  if (patch.status !== undefined) allowed.status = String(patch.status).trim();
  if (patch.verifiedStatus !== undefined) allowed.verifiedStatus = String(patch.verifiedStatus).trim();
  if (patch.reviewState !== undefined) allowed.reviewState = String(patch.reviewState).trim();
  if (patch.mergedIntoEventId !== undefined) allowed.mergedIntoEventId = String(patch.mergedIntoEventId).trim();
  if (patch.adminNote !== undefined) allowed.adminNote = String(patch.adminNote).trim();
  if (patch.locationPrecision !== undefined) allowed.locationPrecision = String(patch.locationPrecision).trim();
  if (patch.locationSource !== undefined) allowed.locationSource = String(patch.locationSource).trim();
  if (patch.locationConfidence !== undefined) {
    const confidence = Number(patch.locationConfidence);
    if (Number.isFinite(confidence)) allowed.locationConfidence = Math.max(0, Math.min(1, confidence));
  }
  if (patch.locationQuality !== undefined) allowed.locationQuality = String(patch.locationQuality).trim();
  if (patch.locationDisplayMode !== undefined) allowed.locationDisplayMode = String(patch.locationDisplayMode).trim();
  if (patch.locationEvidence !== undefined) allowed.locationEvidence = String(patch.locationEvidence).trim();
  if (patch.locationAmbiguity !== undefined) allowed.locationAmbiguity = Boolean(patch.locationAmbiguity);
  if (patch.locationReason !== undefined) allowed.locationReason = String(patch.locationReason).trim();
  if (patch.address !== undefined) allowed.address = String(patch.address).trim();
  if (patch.venue !== undefined) allowed.venue = String(patch.venue).trim();
  if (patch.city !== undefined) allowed.city = String(patch.city).trim();
  if (patch.district !== undefined) allowed.district = String(patch.district).trim();
  if (patch.resolvedAt !== undefined) allowed.resolvedAt = patch.resolvedAt ? String(patch.resolvedAt).trim() : null;
  if (patch.lat !== undefined) {
    const lat = Number(patch.lat);
    if (Number.isFinite(lat)) allowed.lat = lat;
  }
  if (patch.lng !== undefined) {
    const lng = Number(patch.lng);
    if (Number.isFinite(lng)) allowed.lng = lng;
  }
  return allowed;
}

async function updateCachedEvent(eventId, patch = {}, actor = "admin") {
  const events = await getCachedEvents();
  const index = findEventIndex(events, eventId);
  if (index < 0) return null;

  const now = new Date().toISOString();
  const current = events[index];
  const normalizedPatch = normalizeEventPatch(patch);
  const nextStatus = normalizedPatch.status || current.status;
  const resolvedAt = normalizedPatch.resolvedAt !== undefined
    ? normalizedPatch.resolvedAt
    : (["resolved", "cleared"].includes(String(nextStatus || "").toLowerCase()) ? (current.resolvedAt || now) : current.resolvedAt || null);
  const next = {
    ...current,
    ...normalizedPatch,
    status: nextStatus,
    statusSource: "manual",
    reviewState: normalizedPatch.reviewState || (normalizedPatch.mergedIntoEventId ? "merged" : "reviewed"),
    verifiedStatus: normalizedPatch.verifiedStatus || (resolvedAt ? "resolved" : "verified"),
    lastVerifiedAt: now,
    resolvedAt,
    sourceTrace: buildSourceTrace(current),
    adminReview: {
      ...(current.adminReview || {}),
      adminNote: normalizedPatch.adminNote ?? current.adminReview?.adminNote ?? "",
      updatedAt: now,
      actor,
    },
    updatedAt: now,
  };

  events[index] = next;
  await setCachedEvents(events);

  const currentLog = await getCachedValue(EVENT_REVIEW_LOG_KEY);
  const log = Array.isArray(currentLog) ? currentLog : [];
  const entry = {
    eventId: String(eventId),
    action: normalizedPatch.mergedIntoEventId ? "merge" : (resolvedAt ? "resolve-or-update" : "update"),
    patch: normalizedPatch,
    actor,
    createdAt: now,
  };
  await setCachedValue(EVENT_REVIEW_LOG_KEY, [entry, ...log].slice(0, 1000));
  return next;
}

function eventDedupeKey(event) {
  return String(
    event?.eventFingerprint
      || event?.id
      || `${event?.city || ""}:${event?.category || ""}:${event?.title || event?.text || ""}`
  ).trim().toLowerCase();
}

function dedupeEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = eventDedupeKey(event);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  NEWS_CACHE_KEY,
  TRAFFIC_CACHE_KEY,
  EVENT_CACHE_KEY,
  MERGED_EVENT_CACHE_KEY,
  EVENT_BUCKET_KEY_MAP,
  EVENT_BUCKET_KEYS,
  EVENT_REVIEW_LOG_KEY,
  EVENT_REFRESH_STATUS_KEY,
  EVENT_REFRESH_LOG_KEY,
  EVENT_REFRESH_RUN_PREFIX,
  EVENT_REFRESH_RUN_INDEX_KEY,
  OFFICIAL_EVENTS_KEY,
  EVENT_CANDIDATES_KEY,
  MAX_REFRESH_LOG_ENTRIES,
  MAX_REFRESH_RUN_DETAILS,
  REFRESH_RUN_DETAIL_TTL_SECONDS,
  CRON_LOCK_KEY,
  DEFAULT_CRON_LOCK_TTL_SECONDS,
  CLEARABLE_EVENT_CACHE_KEYS,
  acquireCronLock,
  appendRefreshLog,
  clearEventCaches,
  deleteCachedValue,
  getCronLockStatus,
  getCachedEvents,
  getOfficialEvents,
  migrateLegacyEvents,
  setOfficialEvents,
  updateOfficialEvent,
  getEventCandidates,
  createEventCandidates,
  publishEventCandidate,
  getEventCacheStatus,
  getCachedValue,
  getEventBucketGroups,
  getRefreshStatus,
  getRefreshLog,
  getRefreshRunDetail,
  releaseCronLock,
  setCachedEvents,
  setCachedValue,
  setRefreshStatus,
  saveRefreshRunDetail,
  cleanRefreshLogError,
  updateCachedEvent,
  writeEventBuckets,
};
