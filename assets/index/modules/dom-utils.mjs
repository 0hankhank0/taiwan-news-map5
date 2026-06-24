export function bindDelegatedActions(root, handlers = {}) {
    root.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
        if (!target) return;
        const action = target.dataset.action;
        const handler = handlers[action];
        if (typeof handler !== "function") return;
        handler(event, target);
    });
}

export function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function escapeAttribute(value) {
    return escapeHtml(value);
}

export function sanitizeExternalUrl(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    try {
        const base = typeof window !== "undefined" && window.location?.origin
            ? window.location.origin
            : "https://example.invalid";
        const url = new URL(raw, base);
        return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
        return "";
    }
}
