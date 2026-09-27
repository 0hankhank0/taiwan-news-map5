import { getActivityLifecycle } from "./event-layer.mjs";

const RANGE_HOURS = Object.freeze({ "6h": 6, "24h": 24, "3d": 72, "7d": 168 });

export function getEventTime(event = {}) {
    // This is when an event occurred or was published, never when an importer
    // fetched it or a provider refreshed its metadata.
    const fields = ["occurredAt", "eventAt", "happenedAt", "publishedAt", "timestamp", "time"];
    for (const field of fields) {
        const value = event[field];
        const time = typeof value === "number" ? value : Date.parse(value);
        if (Number.isFinite(time)) return { field, time };
    }
    return null;
}

export function isWithinTimeRange(event, range = "24h", now = Date.now()) {
    const selectedHours = RANGE_HOURS[range] || RANGE_HOURS["24h"];
    const rangeStart = now - selectedHours * 60 * 60 * 1000;
    const lifecycle = getActivityLifecycle(event, now);
    if (lifecycle.isActivity) {
        // Activities are intervals. Their schedule, not fetchedAt/createdAt/
        // updatedAt, determines whether they belong in a recent view.
        if (lifecycle.state === "ongoing") return true;
        if (lifecycle.state === "recently_ended") return lifecycle.end !== null && lifecycle.end >= rangeStart;
        return false;
    }
    const eventTime = getEventTime(event);
    if (!eventTime) return false;
    return eventTime.time <= now && eventTime.time >= rangeStart;
}

export function getTimeRangeHours(range = "24h") {
    return RANGE_HOURS[range] || RANGE_HOURS["24h"];
}

export { RANGE_HOURS };
