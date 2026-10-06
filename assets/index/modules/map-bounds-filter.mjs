export function normalizeBounds(bounds) {
    if (!bounds) return null;
    const values = [bounds.getWest ? bounds.getWest() : bounds.west, bounds.getEast ? bounds.getEast() : bounds.east, bounds.getSouth ? bounds.getSouth() : bounds.south, bounds.getNorth ? bounds.getNorth() : bounds.north];
    if (values.some(value => value == null || typeof value === "boolean" || String(value).trim() === "")) return null;
    const [west, east, south, north] = values.map(Number);
    return [west, east, south, north].every(Number.isFinite) && Math.abs(west) <= 180 && Math.abs(east) <= 180 && south >= -90 && north <= 90 && south <= north ? { west, east, south, north } : null;
}

export function isEventInBounds(event, bounds) {
    const area = normalizeBounds(bounds);
    if ([event?.lat, event?.lng].some(value => value == null || typeof value === "boolean" || String(value).trim() === "")) return false;
    const lat = Number(event?.lat), lng = Number(event?.lng);
    if (!area || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
    const longitudeMatches = area.west <= area.east ? lng >= area.west && lng <= area.east : lng >= area.west || lng <= area.east;
    return longitudeMatches && lat >= area.south && lat <= area.north;
}
