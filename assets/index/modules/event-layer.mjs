const FUTURE_ACTIVITY = /(展覽|演唱會|市集|路跑|節慶|活動|表演|賽事)/;
const IMPACT_CATEGORIES = new Set(["traffic", "construction", "roadwork", "accident", "disaster", "fire", "public-safety", "publicsafety"]);

export function isFutureActivity(event = {}, now = Date.now()) {
    const start = Date.parse(event.startsAt || event.startAt || "");
    return Number.isFinite(start) && start > now && (String(event.category || "").toLowerCase() === "activity" || FUTURE_ACTIVITY.test([event.title, event.content, event.summary].join(" ")));
}

export function getEventLayer(event = {}, now = Date.now()) {
    if (isFutureActivity(event, now)) return "upcoming";
    const category = String(event.groupCategory || event.category || event.type || "").toLowerCase();
    if (IMPACT_CATEGORIES.has(category)) return "impact";
    return "news";
}

export function isVisibleEventLayer(event, { showUpcoming = false, now = Date.now() } = {}) {
    const layer = getEventLayer(event, now);
    return layer !== "upcoming" || showUpcoming;
}
