const PUNCTUATION_RE = /[\s\p{P}\p{S}_]+/gu;
const MAX_EVENT_TIME_GAP_MS = 48 * 60 * 60 * 1000;

function normalizedText(value) {
    return String(value || "").toLocaleLowerCase().replace(PUNCTUATION_RE, "");
}

function eventTime(event = {}) {
    const value = event.occurredAt || event.startsAt || event.startAt || event.publishedAt || event.updatedAt || event.createdAt;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : null;
}

function activityOccurrenceKey(event = {}) {
    if (event.category !== "activity" && event.eventKind !== "activity") return "";
    const start = Date.parse(String(event.startsAt || event.startAt || ""));
    const end = Date.parse(String(event.endsAt || event.endAt || ""));
    if (!Number.isFinite(start) && !Number.isFinite(end)) return "";
    const title = normalizedText(event.title || event.text);
    const place = normalizedText(event.venue || event.address || event.location || event.city);
    return `${title}:${place}:${Number.isFinite(start) ? start : ""}:${Number.isFinite(end) ? end : ""}`;
}

function stableIdentity(event = {}) {
    const identity = event.sourceEventId || event.sourceId || event.externalId || event.eventId || event.eventFingerprint || event.id;
    return identity ? `id:${String(identity).trim().toLocaleLowerCase()}` : "";
}

function sourceUrl(event = {}) {
    return String(event.sourceUrl || event.url || event.link || "").trim().toLocaleLowerCase();
}

function sameLocation(a, b) {
    const cityA = normalizedText(a.city);
    const cityB = normalizedText(b.city);
    if (cityA && cityB && cityA === cityB) return true;
    const latA = Number(a.lat), lngA = Number(a.lng), latB = Number(b.lat), lngB = Number(b.lng);
    if (![latA, lngA, latB, lngB].every(Number.isFinite)) return false;
    const latDistance = (latA - latB) * 111000;
    const lngDistance = (lngA - lngB) * 111000 * Math.cos((latA + latB) * Math.PI / 360);
    return Math.hypot(latDistance, lngDistance) <= 2000;
}

function isDuplicateEvent(newEvent = {}, existingEvent = {}) {
    if (newEvent.category === "activity" || newEvent.eventKind === "activity") {
        const occurrence = activityOccurrenceKey(newEvent);
        return Boolean(occurrence) && occurrence === activityOccurrenceKey(existingEvent);
    }
    const identity = stableIdentity(newEvent);
    if (identity && identity === stableIdentity(existingEvent)) return true;
    const url = sourceUrl(newEvent);
    if (url && url === sourceUrl(existingEvent)) return true;
    if (url || sourceUrl(existingEvent)) return false;

    // Without a stable identity, require all contextual signals. Exact title is
    // intentional: a shared prefix is not evidence that two incidents match.
    const titleA = normalizedText(newEvent.title || newEvent.text);
    const titleB = normalizedText(existingEvent.title || existingEvent.text);
    if (!titleA || titleA !== titleB) return false;
    const sourceA = normalizedText(newEvent.sourceName || newEvent.source);
    const sourceB = normalizedText(existingEvent.sourceName || existingEvent.source);
    if (!sourceA || !sourceB || sourceA !== sourceB || !sameLocation(newEvent, existingEvent)) return false;
    const timeA = eventTime(newEvent);
    const timeB = eventTime(existingEvent);
    return timeA !== null && timeB !== null && Math.abs(timeA - timeB) <= MAX_EVENT_TIME_GAP_MS;
}

export { activityOccurrenceKey, isDuplicateEvent, stableIdentity };
