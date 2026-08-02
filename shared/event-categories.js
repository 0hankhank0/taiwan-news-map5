(function eventCategoriesModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TNM_EVENT_CATEGORIES = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createEventCategories() {
  const NEWS_CATEGORIES = Object.freeze({
    traffic: "交通",
    disaster: "災害天氣",
    crime: "社會治安",
    accident: "意外事故",
    politics: "政治公共",
    livelihood: "民生生活",
    medical: "醫療健康",
    education: "教育校園",
    economy: "產業經濟",
    culture: "文化娛樂",
    international: "國際事件",
    other: "其他"
  });

  const EVENT_KINDS = Object.freeze(["news", "traffic_data", "activity", "submission", "official_alert"]);
  const LEGACY_CATEGORIES = Object.freeze({
    criminal: "crime", police: "crime", "治安": "crime", "犯罪": "crime",
    weather: "disaster", climate: "disaster", earthquake: "disaster", typhoon: "disaster",
    health: "medical", school: "education", business: "economy", entertainment: "culture",
    construction: "traffic", roadwork: "traffic", road: "traffic", congestion: "traffic", jam: "traffic",
    incident: "accident", safety: "accident", publicsafety: "accident", "public-safety": "accident"
  });

  function clean(value) {
    return String(value || "").trim().toLowerCase().replace(/_/g, "-");
  }

  function inferFireCategory(event = {}) {
    const text = [event.title, event.summary, event.content, event.description].filter(Boolean).join(" ").toLowerCase();
    if (/(arson|縱火|放火|蓄意)/i.test(text)) return "crime";
    if (/(typhoon|颱風|earthquake|地震|flood|淹水|山崩|豪雨|災害)/i.test(text)) return "disaster";
    return "accident";
  }

  function normalizeEventCategory(value, event = {}) {
    const raw = clean(value || event.category || event.type);
    if (raw === "fire" || raw === "arson") return inferFireCategory(event);
    if (Object.prototype.hasOwnProperty.call(NEWS_CATEGORIES, raw)) return raw;
    return LEGACY_CATEGORIES[raw] || "other";
  }

  function getCategoryLabel(value, event) {
    return NEWS_CATEGORIES[normalizeEventCategory(value, event)] || NEWS_CATEGORIES.other;
  }

  function normalizeSecondaryTags(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((tag) => String(tag || "").trim()).filter((tag) => tag && tag.length <= 24))].slice(0, 5);
  }

  function normalizeCategoryConfidence(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : null;
  }

  function inferEventKind(event = {}) {
    const raw = clean(event.eventKind);
    if (EVENT_KINDS.includes(raw)) return raw;
    const source = clean(`${event.source || ""} ${event.sourceName || ""}`);
    const category = clean(event.category || event.type);
    if (source.includes("tdx") || source.includes("pbs")) return "traffic_data";
    if (category === "activity" || source.includes("kktix") || source.includes("iculture")) return "activity";
    if (source.includes("submission") || event.submissionId) return "submission";
    return "news";
  }

  return { NEWS_CATEGORIES, EVENT_KINDS, LEGACY_CATEGORIES, normalizeEventCategory, getCategoryLabel, normalizeSecondaryTags, normalizeCategoryConfidence, inferEventKind };
});
