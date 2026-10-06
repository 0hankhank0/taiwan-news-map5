const CACHE_KEY = "island-pulse:events:v1";

export function eventFingerprint(events) {
  const value = (input) => input == null ? null : String(input).replace(/\s+/g, " ").trim();
  const number = (input) => Number.isFinite(Number(input)) ? Number(input) : null;
  return JSON.stringify((Array.isArray(events) ? events : []).map((event) => ({
    id: value(event?.id), title: value(event?.title), category: value(event?.category), groupCategory: value(event?.groupCategory),
    status: value(event?.status), lat: number(event?.lat), lng: number(event?.lng),
    locationQuality: value(event?.locationQuality), locationPrecision: value(event?.locationPrecision),
    publishedAt: value(event?.publishedAt), updatedAt: value(event?.updatedAt), startsAt: value(event?.startsAt), endsAt: value(event?.endsAt),
    sourceUrl: value(event?.sourceUrl || event?.url), summary: value(event?.summary), content: value(event?.content),
  })).sort((a, b) => String(a.id || "").localeCompare(String(b.id || ""))));
}

export function readEventCache(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(CACHE_KEY) || "null");
    return Array.isArray(value?.events) && value.events.length ? value : null;
  } catch { return null; }
}

export function writeEventCache(events, updatedAt = new Date().toISOString(), storage = globalThis.localStorage) {
  try { storage?.setItem(CACHE_KEY, JSON.stringify({ events, updatedAt })); } catch { /* storage is optional */ }
}

export function createEventDataManager({ fetchEvents, onState, intervalMs = 300000, focusAfterMs = 120000, storage } = {}) {
  let inFlight = null, timer = null, lastSuccessAt = 0, lastFingerprint = "", stopped = false;
  const emit = (state) => onState?.(state);
  async function refresh({ manual = false } = {}) {
    if (inFlight) return inFlight;
    emit({ phase: "loading", manual });
    inFlight = Promise.resolve().then(fetchEvents).then((result) => {
      const events = Array.isArray(result) ? result : result?.events;
      if (!Array.isArray(events)) throw new Error("Invalid event response");
      const updatedAt = new Date().toISOString(); const fingerprint = eventFingerprint(events);
      const unchanged = fingerprint === lastFingerprint;
      lastFingerprint = fingerprint; lastSuccessAt = Date.now(); writeEventCache(events, updatedAt, storage);
      emit({ phase: "success", events, response: Array.isArray(result) ? null : result?.response, updatedAt, unchanged, manual });
      return events;
    }).catch((error) => {
      const cached = readEventCache(storage);
      emit({ phase: "error", error, cached, manual });
      return null;
    }).finally(() => { inFlight = null; });
    return inFlight;
  }
  function start() {
    if (timer || stopped) return inFlight || Promise.resolve(null);
    const firstRefresh = refresh();
    timer = setInterval(() => { if (!document.hidden) refresh(); }, intervalMs);
    return firstRefresh;
  }
  function stop() { stopped = true; if (timer) clearInterval(timer); timer = null; }
  function onVisibilityChange() { if (!document.hidden && Date.now() - lastSuccessAt > focusAfterMs) refresh(); }
  return { refresh, start, stop, onVisibilityChange, get lastSuccessAt() { return lastSuccessAt; } };
}
