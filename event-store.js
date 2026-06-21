const fs = require("fs");
const os = require("os");
const path = require("path");
const { Redis } = require("@upstash/redis");

const EVENT_CACHE_KEY = "taiwan_traffic_events";
const MERGED_EVENT_CACHE_KEY = "events:merged";
const EVENT_BUCKET_KEYS = ["events:traffic", "events:news", "events:activities"];
const EVENT_REVIEW_LOG_KEY = "events:review-log";

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

async function getCachedEvents() {
  const mergedEvents = await getCachedValue(MERGED_EVENT_CACHE_KEY);
  if (Array.isArray(mergedEvents) && mergedEvents.length > 0) return mergedEvents;

  const buckets = await Promise.all(EVENT_BUCKET_KEYS.map((key) => getCachedValue(key)));
  const bucketEvents = dedupeEvents(buckets.flatMap((value) => (Array.isArray(value) ? value : [])));
  if (bucketEvents.length > 0) return bucketEvents;

  const legacyEvents = await getCachedValue(EVENT_CACHE_KEY);
  return Array.isArray(legacyEvents) ? legacyEvents : [];
}

async function getEventCacheStatus() {
  const keys = [MERGED_EVENT_CACHE_KEY, ...EVENT_BUCKET_KEYS, EVENT_CACHE_KEY];
  const entries = keys.map((key) => getSqliteEntryMeta(key)).filter(Boolean);
  const lastLocalUpdate = entries
    .map((entry) => Date.parse(entry.updatedAt || ""))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  const events = await getCachedEvents();
  return {
    hasKv: Boolean(kv),
    localEntries: entries,
    lastLocalUpdate: lastLocalUpdate ? new Date(lastLocalUpdate).toISOString() : null,
    eventCount: Array.isArray(events) ? events.length : 0,
  };
}

async function setCachedEvents(events, options = {}) {
  const safeEvents = Array.isArray(events) ? events : [];
  const legacyOk = await setCachedValue(EVENT_CACHE_KEY, safeEvents, options);
  const mergedOk = await setCachedValue(MERGED_EVENT_CACHE_KEY, safeEvents, options);
  return legacyOk || mergedOk;
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
  EVENT_CACHE_KEY,
  MERGED_EVENT_CACHE_KEY,
  EVENT_BUCKET_KEYS,
  EVENT_REVIEW_LOG_KEY,
  getCachedEvents,
  getEventCacheStatus,
  getCachedValue,
  setCachedEvents,
  setCachedValue,
  updateCachedEvent,
};
