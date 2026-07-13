const EARTH_RADIUS_METERS = 6371008.8;

/**
 * Builds a geodesic polygon rather than a screen-space circle, so it remains
 * accurate while the Mapbox map is panned or zoomed.
 */
export function buildNearbyRadiusGeoJson(location, radiusMeters, steps = 72) {
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);
    const radius = Number(radiusMeters);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radius) || radius <= 0) {
        return { type: "FeatureCollection", features: [] };
    }

    const toRadians = value => value * Math.PI / 180;
    const toDegrees = value => value * 180 / Math.PI;
    const angularDistance = radius / EARTH_RADIUS_METERS;
    const centerLat = toRadians(lat);
    const centerLng = toRadians(lng);
    const coordinates = [];
    const pointCount = Math.max(64, Math.min(96, Math.round(steps)));

    for (let index = 0; index <= pointCount; index += 1) {
        const bearing = (index / pointCount) * Math.PI * 2;
        const pointLat = Math.asin(
            Math.sin(centerLat) * Math.cos(angularDistance)
            + Math.cos(centerLat) * Math.sin(angularDistance) * Math.cos(bearing)
        );
        const pointLng = centerLng + Math.atan2(
            Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(centerLat),
            Math.cos(angularDistance) - Math.sin(centerLat) * Math.sin(pointLat)
        );
        coordinates.push([toDegrees(pointLng), toDegrees(pointLat)]);
    }

    return {
        type: "FeatureCollection",
        features: [{
            type: "Feature",
            properties: { radiusMeters: radius },
            geometry: { type: "Polygon", coordinates: [coordinates] }
        }]
    };
}
