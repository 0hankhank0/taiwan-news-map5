export function buildEventPath(event = {}) {
    const id = String(event?.id || event?.eventId || "").trim();
    return id ? `/event/${encodeURIComponent(id)}` : "/";
}

export function buildEventUrl(event, origin = window.location.origin) {
    return new URL(buildEventPath(event), origin).href;
}

export function getRequestedEventId(location = window.location) {
    const pathMatch = String(location.pathname || "").match(/^\/event\/([^/]+)\/?$/);
    if (pathMatch) {
        try { return decodeURIComponent(pathMatch[1]).trim(); } catch { return ""; }
    }
    return new URLSearchParams(location.search || "").get("event")?.trim() || "";
}

export function isEventRoute(pathname = window.location.pathname) {
    return /^\/event\/[^/]+\/?$/.test(String(pathname || ""));
}

export function getRequestedCategory(location = window.location, categories = {}) {
    const match = String(location.pathname || "").match(/^\/category\/([^/]+)\/?$/);
    if (!match) return "";
    const key = decodeURIComponent(match[1]).toLowerCase();
    return Object.prototype.hasOwnProperty.call(categories, key) ? key : "";
}
