export function normalizeBounds(bounds) {
    if (!bounds) return null;
    const west = Number(bounds.getWest ? bounds.getWest() : bounds.west);
    const east = Number(bounds.getEast ? bounds.getEast() : bounds.east);
    const south = Number(bounds.getSouth ? bounds.getSouth() : bounds.south);
    const north = Number(bounds.getNorth ? bounds.getNorth() : bounds.north);
    return [west, east, south, north].every(Number.isFinite) ? { west, east, south, north } : null;
}

export function isEventInBounds(event, bounds) {
    const area = normalizeBounds(bounds);
    const lat = Number(event?.lat), lng = Number(event?.lng);
    if (!area || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    const longitudeMatches = area.west <= area.east ? lng >= area.west && lng <= area.east : lng >= area.west || lng <= area.east;
    return longitudeMatches && lat >= area.south && lat <= area.north;
}
