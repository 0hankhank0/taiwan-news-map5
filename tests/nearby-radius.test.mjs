import assert from "node:assert/strict";
import { buildNearbyRadiusGeoJson } from "../assets/index/modules/nearby-radius.mjs";

const EARTH_RADIUS_METERS = 6371008.8;
const location = { lat: 25.033, lng: 121.565 };
const polygon = buildNearbyRadiusGeoJson(location, 3000);
const ring = polygon.features[0].geometry.coordinates[0];

function distanceMeters([lng, lat]) {
    const toRad = value => value * Math.PI / 180;
    const dLat = toRad(lat - location.lat);
    const dLng = toRad(lng - location.lng);
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(location.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

assert.equal(polygon.type, "FeatureCollection");
assert.equal(polygon.features.length, 1);
assert.equal(ring.length, 73, "a 72-segment geodesic ring includes its closing coordinate");
assert.deepEqual(ring[0], ring.at(-1), "polygon ring is closed");
for (const coordinate of ring.slice(0, -1)) {
    assert.ok(Math.abs(distanceMeters(coordinate) - 3000) < 1, "each geodesic point remains about 3000 m from the center");
}
assert.deepEqual(buildNearbyRadiusGeoJson(null, 3000).features, []);
console.log("nearby radius geometry tests passed");
