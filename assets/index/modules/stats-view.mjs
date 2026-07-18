const CATEGORY_LABELS = {
    traffic: "交通",
    accident: "事故",
    disaster: "災害",
    criminal: "治安",
    medical: "醫療",
    construction: "施工",
    activity: "活動",
    other: "其他"
};

export function normalizeStatsCity(value) {
    const city = String(value || "").trim()
        .replace(/[縣市]$/u, "")
        .replace(/臺/g, "台");
    return city || "未標示";
}

export function findLatestEventTime(events) {
    const timestamps = (events || []).map((event) => {
        const value = event.updatedAt || event.publishedAt || event.createdAt || event.time;
        const time = Date.parse(value);
        return Number.isFinite(time) ? time : 0;
    }).filter(Boolean);
    return timestamps.length ? new Date(Math.max(...timestamps)) : null;
}

export function buildCategoryDistribution(events) {
    const counts = new Map();
    for (const event of events || []) {
        const key = CATEGORY_LABELS[event.category] ? event.category : "other";
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()]
        .map(([key, count]) => ({ key, label: CATEGORY_LABELS[key], count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-Hant"));
}

export function buildStatsSummary(events) {
    const cityCounts = new Map();
    for (const event of events || []) {
        const city = normalizeStatsCity(event.city);
        cityCounts.set(city, (cityCounts.get(city) || 0) + 1);
    }
    const cities = [...cityCounts.entries()]
        .map(([city, count]) => ({ city, count }))
        .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, "zh-Hant"));
    const categories = buildCategoryDistribution(events);
    return {
        total: (events || []).length,
        cities,
        cityCount: cities.filter(({ city }) => city !== "未標示").length,
        topCategory: categories[0] || null,
        categories,
        lastUpdated: findLatestEventTime(events)
    };
}

export function sortPopularOrRecentEvents(events, reactions = {}) {
    return (events || []).map((event) => {
        const reaction = reactions[String(event.id || "")] || {};
        const muyu = Math.max(0, Number(reaction.muyu) || 0);
        const candle = Math.max(0, Number(reaction.candle) || 0);
        const timestamp = Date.parse(event.updatedAt || event.publishedAt || event.createdAt || event.time) || 0;
        return { ...event, muyu, candle, total: muyu + candle, timestamp };
    }).sort((a, b) => b.total - a.total || b.timestamp - a.timestamp);
}

export function getStatsCategoryLabel(category) {
    return CATEGORY_LABELS[category] || CATEGORY_LABELS.other;
}
