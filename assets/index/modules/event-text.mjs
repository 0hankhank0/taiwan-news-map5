import { normalizeFilterText } from "./filters.mjs";

export function safeText(value, fallback = "") {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return fallback;
    if (typeof value === "number" || typeof value === "boolean") return String(value);

    try {
        const serialized = JSON.stringify(value);
        return typeof serialized === "string" ? serialized : fallback;
    } catch {
        return fallback;
    }
}

function firstUsableValue(...values) {
    return values.find(value => value !== null && value !== undefined && value !== "");
}

export function normalizeEventTextFields(ev) {
    const event = ev && typeof ev === "object" && !Array.isArray(ev) ? ev : {};
    const title = safeText(firstUsableValue(event.title, event.name), "未命名事件") || "未命名事件";

    return {
        ...event,
        title,
        content: safeText(firstUsableValue(event.content, event.summary, event.description, event.text)),
        summary: safeText(event.summary),
        text: safeText(event.text),
        city: safeText(firstUsableValue(event.city, event.region)),
        source: safeText(firstUsableValue(event.sourceName, event.source))
    };
}

export function isMourningEvent(ev = {}) {
    if (typeof ev?.hasCasualty === "boolean") return ev.hasCasualty;

    const keywords = ["死亡", "罹難", "身亡", "喪生", "不治", "往生", "遇難"];
    const text = [ev?.title, ev?.content, ev?.summary, ev?.text]
        .map(value => safeText(value))
        .join(" ");

    return keywords.some(keyword => text.includes(keyword));
}

export function getSearchableEventText(ev = {}) {
    return normalizeFilterText([ev?.title, ev?.content, ev?.summary, ev?.address, ev?.venue, ev?.city, ev?.district, ev?.source, ev?.sourceName]
        .map(value => safeText(value))
        .join(" "));
}

export function forEachEventSafely(events, renderEvent, onError = console.error) {
    (Array.isArray(events) ? events : []).forEach((ev, index) => {
        try {
            renderEvent(ev, index);
        } catch (error) {
            onError(error, ev, index);
        }
    });
}
