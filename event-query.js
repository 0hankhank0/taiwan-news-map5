function normalizeQueryValue(value) {
  return String(Array.isArray(value) ? value[0] : value || "").trim();
}

function applyEventQueryFilters(events, query = {}) {
  const category = normalizeQueryValue(query.category).toLowerCase();
  const status = normalizeQueryValue(query.status).toLowerCase();
  const city = normalizeQueryValue(query.city);
  const source = normalizeQueryValue(query.source).toLowerCase();
  const q = normalizeQueryValue(query.q).toLowerCase();
  const limit = Math.max(0, Math.min(Number(normalizeQueryValue(query.limit)) || 0, 500));

  let filtered = Array.isArray(events) ? events : [];
  if (category && category !== "all") {
    filtered = filtered.filter((event) =>
      String(event.category || "").toLowerCase() === category
      || String(event.groupCategory || "").toLowerCase() === category
    );
  }
  if (status && status !== "all") {
    filtered = filtered.filter((event) => String(event.status || "").toLowerCase() === status);
  }
  if (city && city !== "all") {
    filtered = filtered.filter((event) => String(event.city || "").includes(city));
  }
  if (source && source !== "all") {
    filtered = filtered.filter((event) =>
      String(event.source || "").toLowerCase().includes(source)
      || String(event.sourceName || "").toLowerCase().includes(source)
    );
  }
  if (q) {
    filtered = filtered.filter((event) =>
      [event.title, event.content, event.summary, event.address, event.venue, event.city, event.district]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }
  return limit > 0 ? filtered.slice(0, limit) : filtered;
}

function getEventTimestamp(event) {
  const raw = event?.updatedAt || event?.publishedAt || event?.time || event?.createdAt || event?.startsAt || event?.startAt;
  const timestamp = Date.parse(raw || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getEventStatusSummary(events, cacheStatus) {
  const safeEvents = Array.isArray(events) ? events : [];
  const newestEvent = safeEvents
    .map(getEventTimestamp)
    .filter(Boolean)
    .sort((a, b) => b - a)[0];
  const sourceNames = Array.from(new Set(safeEvents
    .map((event) => event.sourceName || event.source)
    .filter(Boolean)
    .map((source) => String(source).trim())
    .filter(Boolean)))
    .slice(0, 8);

  return {
    total: safeEvents.length,
    sources: sourceNames,
    newestEventAt: newestEvent ? new Date(newestEvent).toISOString() : "",
    cacheUpdatedAt: cacheStatus?.lastLocalUpdate || "",
    hasKv: Boolean(cacheStatus?.hasKv),
  };
}

module.exports = {
  applyEventQueryFilters,
  getEventStatusSummary,
  getEventTimestamp,
  normalizeQueryValue,
};
