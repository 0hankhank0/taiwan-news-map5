const ALLOWED_KEYS = new Set(["category", "city", "sourceType", "deviceLayout", "refreshResult"]);
export function safeAnalyticsProperties(properties = {}) {
  return Object.fromEntries(Object.entries(properties).filter(([key, value]) => ALLOWED_KEYS.has(key) && ["string", "number", "boolean"].includes(typeof value)).map(([key, value]) => [key, String(value).slice(0, 80)]));
}
export function trackEvent(name, properties = {}, analytics = globalThis.va) {
  if (!/^[a-z_]{1,64}$/.test(String(name))) return;
  const safe = safeAnalyticsProperties(properties);
  try { if (typeof analytics === "function") analytics("event", { name, data: safe }); } catch { /* analytics must never affect the map */ }
}
