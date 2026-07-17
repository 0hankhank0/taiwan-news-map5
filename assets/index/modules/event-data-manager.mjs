const CACHE_KEY = "island-pulse:events:v1";

export function eventFingerprint(events) {
  return JSON.stringify((Array.isArray(events) ? events : []).map((event) => [event.id, event.updatedAt, event.publishedAt, event.title]));
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
    inFlight = Promise.resolve().then(fetchEvents).then((events) => {
      if (!Array.isArray(events)) throw new Error("Invalid event response");
      const updatedAt = new Date().toISOString(); const fingerprint = eventFingerprint(events);
      const unchanged = fingerprint === lastFingerprint;
      lastFingerprint = fingerprint; lastSuccessAt = Date.now(); writeEventCache(events, updatedAt, storage);
      emit({ phase: "success", events, updatedAt, unchanged, manual });
      return events;
    }).catch((error) => {
      const cached = readEventCache(storage);
      emit({ phase: "error", error, cached, manual });
      return null;
    }).finally(() => { inFlight = null; });
    return inFlight;
  }
  function start() { if (timer || stopped) return; refresh(); timer = setInterval(() => { if (!document.hidden) refresh(); }, intervalMs); }
  function stop() { stopped = true; if (timer) clearInterval(timer); timer = null; }
  function onVisibilityChange() { if (!document.hidden && Date.now() - lastSuccessAt > focusAfterMs) refresh(); }
  return { refresh, start, stop, onVisibilityChange, get lastSuccessAt() { return lastSuccessAt; } };
}
