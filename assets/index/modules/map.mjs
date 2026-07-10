export function getMapboxToken() {
    return window.MAPBOX_ACCESS_TOKEN || "pk.eyJ1IjoiaGFua2hhbmsiLCJhIjoiY21wNWhmNHNiMDJxMzJycjB4a3FmNDY0biJ9.FK_qTU4xvkvvYq1Ze8WC4g";
}

function normalizeLocationText(value) {
    return String(value || "").trim().toLowerCase();
}

function defaultLocationQuality(event) {
    const explicit = normalizeLocationText(event?.locationQuality);
    if (["high", "medium", "low"].includes(explicit)) return explicit;
    const confidence = Number(event?.locationConfidence);
    if (Number.isFinite(confidence)) {
        if (confidence >= 0.8) return "high";
        if (confidence >= 0.55) return "medium";
        return "low";
    }
    const precision = normalizeLocationText(event?.locationPrecision);
    if (precision === "exact" || precision === "district") return "medium";
    return "low";
}

function defaultLocationDisplayMode(event, quality) {
    const explicit = normalizeLocationText(event?.locationDisplayMode);
    if (["point", "estimated", "list_only"].includes(explicit)) return explicit;
    const precision = normalizeLocationText(event?.locationPrecision);
    if (quality === "high") return "point";
    if (quality === "medium" && precision !== "unknown") return "estimated";
    return "list_only";
}

export function shouldRenderLocationMarker(event, helpers = {}) {
    const precision = normalizeLocationText(event?.locationPrecision);
    const quality = typeof helpers.getLocationQuality === "function"
        ? helpers.getLocationQuality(event)
        : defaultLocationQuality(event);
    if (precision === "city" || quality === "low") return false;

    const displayMode = typeof helpers.getLocationDisplayMode === "function"
        ? helpers.getLocationDisplayMode(event)
        : defaultLocationDisplayMode(event, quality);
    return displayMode !== "list_only";
}
