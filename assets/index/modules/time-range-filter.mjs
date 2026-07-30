const RANGE_HOURS = Object.freeze({ "6h": 6, "24h": 24, "3d": 72, "7d": 168 });

export function getEventTime(event = {}) {
    const fields = ["occurredAt", "eventAt", "happenedAt", "startsAt", "startAt", "publishedAt", "updatedAt", "createdAt", "timestamp", "time"];
    for (const field of fields) {
        const value = event[field];
        const time = typeof value === "number" ? value : Date.parse(value);
        if (Number.isFinite(time)) return { field, time };
    }
    return null;
}

export function isWithinTimeRange(event, range = "24h", now = Date.now()) {
    const selectedHours = RANGE_HOURS[range] || RANGE_HOURS["24h"];
    const eventTime = getEventTime(event);
    if (!eventTime) return false;
    return eventTime.time <= now && eventTime.time >= now - selectedHours * 60 * 60 * 1000;
}

export function getTimeRangeHours(range = "24h") {
    return RANGE_HOURS[range] || RANGE_HOURS["24h"];
}

export { RANGE_HOURS };
