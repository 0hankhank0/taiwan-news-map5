export const TAIPEI_UTC_OFFSET = 8 * 60 * 60 * 1000;
export const ACTIVITY_FUTURE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const ACTIVITY_DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;
export const ACTIVITY_ENDED_GRACE_MS = 6 * 60 * 60 * 1000;

const ACTIVITY_CATEGORIES = new Set(["activity", "event", "market", "exhibition", "sports"]);
const TERMINAL_STATUSES = new Set(["expired", "cancelled", "canceled", "ended", "completed", "closed", "archived", "rejected", "hidden", "resolved", "cleared"]);
const ACTIVE_STATUSES = new Set(["active", "ongoing", "in_progress", "live"]);
const SCHEDULED_STATUSES = new Set(["upcoming", "scheduled"]);
const IMPACT_CATEGORIES = new Set(["traffic", "construction", "roadwork", "accident", "disaster", "fire", "public-safety", "publicsafety"]);
const ACTIVITY_KEYWORDS = /(活動|展覽|市集|演唱會|賽事|路跑|表演|節慶|講座|工作坊|\bevent\b|\bactivity\b|\bmarket\b|\bexhibition\b|\bconcert\b|\bcompetition\b|\brace\b|\bmarathon\b|\bperformance\b|\bfestival\b|\blecture\b|\bworkshop\b)/i;
const START_FIELDS = ["startsAt", "startAt", "eventStartTime", "startDateTime", "startDate", "StartDateTime", "StartDate"];
const END_FIELDS = ["endsAt", "endAt", "eventEndTime", "endDateTime", "endDate", "EndDateTime", "EndDate"];

function firstTime(event, fields) {
    for (const field of fields) {
        const time = parseTaipeiEventTime(event?.[field]);
        if (time !== null) return time;
    }
    return null;
}

/** Parses timezone-less calendar values as Asia/Taipei (UTC+8), not the browser timezone. */
export function parseTaipeiEventTime(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value !== "string" || !value.trim()) return null;
    const raw = value.trim();
    const local = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/);
    if (local) {
        const [, year, month, day, hour = "00", minute = "00", second = "00", fraction = ""] = local;
        const ms = Number(fraction.padEnd(3, "0") || 0);
        return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), ms) - TAIPEI_UTC_OFFSET;
    }
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

export function isActivityEvent(event = {}) {
    const category = String(event.groupCategory || event.category || event.type || "").trim().toLowerCase();
    if (ACTIVITY_CATEGORIES.has(category)) return true;
    return ACTIVITY_KEYWORDS.test([event.title, event.content, event.summary, event.description].filter(Boolean).join(" "));
}

export function getActivityLifecycle(event = {}, now = Date.now()) {
    const isActivity = isActivityEvent(event);
    const startValue = firstTime(event, START_FIELDS);
    const endValue = firstTime(event, END_FIELDS);
    const status = String(event.status || event.state || "").trim().toLowerCase();
    if (!isActivity) return { isActivity: false, state: "not_activity", start: startValue, end: endValue };
    if (TERMINAL_STATUSES.has(status)) return { isActivity: true, state: "terminal", start: startValue, end: endValue };
    if (SCHEDULED_STATUSES.has(status) && startValue === null) return { isActivity: true, state: "missing_start", start: null, end: endValue };
    if (startValue !== null && endValue !== null && endValue < startValue) return { isActivity: true, state: "invalid_schedule", start: startValue, end: endValue };
    if (startValue === null && endValue === null) {
        return { isActivity: true, state: ACTIVE_STATUSES.has(status) ? "ongoing" : "timeless", start: null, end: null };
    }
    const start = startValue ?? endValue - ACTIVITY_DEFAULT_DURATION_MS;
    const end = endValue ?? startValue + ACTIVITY_DEFAULT_DURATION_MS;
    if (now < start) return { isActivity: true, state: "upcoming", start, end, isWithinFutureWindow: start - now <= ACTIVITY_FUTURE_WINDOW_MS };
    if (now <= end) return { isActivity: true, state: "ongoing", start, end };
    if (now <= end + ACTIVITY_ENDED_GRACE_MS) return { isActivity: true, state: "recently_ended", start, end };
    return { isActivity: true, state: "ended", start, end };
}

export function isFutureActivity(event = {}, now = Date.now()) {
    const lifecycle = getActivityLifecycle(event, now);
    return lifecycle.isActivity && lifecycle.state === "upcoming" && lifecycle.isWithinFutureWindow === true;
}

export function getEventLayer(event = {}, now = Date.now()) {
    if (isFutureActivity(event, now)) return "upcoming";
    const category = String(event.groupCategory || event.category || event.type || "").toLowerCase();
    if (IMPACT_CATEGORIES.has(category)) return "impact";
    return "news";
}

export function isVisibleEventLayer(event, { showUpcoming = false, now = Date.now() } = {}) {
    const lifecycle = getActivityLifecycle(event, now);
    if (!lifecycle.isActivity) return true;
    if (lifecycle.state === "upcoming") return showUpcoming && lifecycle.isWithinFutureWindow === true;
    return !["terminal", "missing_start", "invalid_schedule", "ended"].includes(lifecycle.state);
}
