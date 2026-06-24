const { Redis } = require("@upstash/redis");
const { getCachedValue, setCachedValue } = require("./event-store");

const REACTIONS_KEY = "reaction_counts";

function createKvClient() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const kv = createKvClient();

function getReactionKey(eventId, type) {
  return `reaction:${eventId}:${type}`;
}

async function getLocalCounts() {
  const counts = await getCachedValue(REACTIONS_KEY);
  return counts && typeof counts === "object" && !Array.isArray(counts) ? counts : {};
}

async function setLocalCounts(counts) {
  await setCachedValue(REACTIONS_KEY, counts);
}

async function incrementReaction(eventId, type) {
  if (kv) {
    await kv.incr(getReactionKey(eventId, type));
    return;
  }

  const counts = await getLocalCounts();
  counts[eventId] = counts[eventId] || { muyu: 0, candle: 0 };
  counts[eventId][type] = Number(counts[eventId][type] || 0) + 1;
  await setLocalCounts(counts);
}

async function getReaction(eventId) {
  if (kv) {
    const [muyu, candle] = await Promise.all([
      kv.get(getReactionKey(eventId, "muyu")),
      kv.get(getReactionKey(eventId, "candle")),
    ]);
    return {
      muyu: parseInt(muyu || 0, 10),
      candle: parseInt(candle || 0, 10),
    };
  }

  const counts = await getLocalCounts();
  return {
    muyu: Number(counts[eventId]?.muyu || 0),
    candle: Number(counts[eventId]?.candle || 0),
  };
}

async function getReactions(eventIds = []) {
  const ids = Array.from(new Set(
    (Array.isArray(eventIds) ? eventIds : [])
      .map((eventId) => String(eventId || "").trim())
      .filter(Boolean)
  ));

  if (kv) {
    const entries = await Promise.all(ids.map(async (eventId) => [eventId, await getReaction(eventId)]));
    return Object.fromEntries(entries);
  }

  const counts = await getLocalCounts();
  return Object.fromEntries(ids.map((eventId) => [eventId, {
    muyu: Number(counts[eventId]?.muyu || 0),
    candle: Number(counts[eventId]?.candle || 0),
  }]));
}

async function getReactionTotals() {
  if (kv) {
    const keys = await kv.keys("reaction:*");
    let muyu = 0;
    let candle = 0;

    for (const key of keys) {
      const val = parseInt((await kv.get(key)) || 0, 10);
      if (key.endsWith(":muyu")) muyu += val;
      if (key.endsWith(":candle")) candle += val;
    }

    return { muyu, candle };
  }

  const counts = await getLocalCounts();
  return Object.values(counts).reduce(
    (totals, item) => ({
      muyu: totals.muyu + Number(item?.muyu || 0),
      candle: totals.candle + Number(item?.candle || 0),
    }),
    { muyu: 0, candle: 0 },
  );
}

module.exports = {
  getReaction,
  getReactions,
  getReactionTotals,
  incrementReaction,
};
