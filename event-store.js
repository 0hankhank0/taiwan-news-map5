const fs = require("fs");
const os = require("os");
const path = require("path");
const { Redis } = require("@upstash/redis");

const EVENT_CACHE_KEY = "taiwan_traffic_events";

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

async function getKvValue(key) {
  if (!kv) return undefined;
  try {
    const value = await kv.get(key);
    return value === null ? undefined : value;
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

    return JSON.parse(row.value);
  } catch (error) {
    console.warn(`[event-store] SQLite get failed for ${key}:`, error.message);
    return undefined;
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
  const events = await getCachedValue(EVENT_CACHE_KEY);
  return Array.isArray(events) ? events : [];
}

async function setCachedEvents(events, options = {}) {
  const safeEvents = Array.isArray(events) ? events : [];
  return setCachedValue(EVENT_CACHE_KEY, safeEvents, options);
}

module.exports = {
  EVENT_CACHE_KEY,
  getCachedEvents,
  getCachedValue,
  setCachedEvents,
  setCachedValue,
};
