import assert from "node:assert/strict";
import {
    ALERT_ZONES_STORAGE_KEY,
    createAlertZone,
    normalizeAlertZones,
    loadAlertZones,
    saveAlertZones,
    matchAlertZones,
    attachAlertZoneMatches,
    filterAlertZoneEvents,
    sortAlertZoneEvents,
    countAlertZoneMatchedEvents
} from "../assets/index/modules/alert-zones.mjs";

function distanceMeters(aLat, aLng, bLat, bLng) {
    const toRad = value => value * Math.PI / 180;
    const radius = 6371000;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function memoryStorage(initial = {}) {
    const store = { ...initial };
    return {
        getItem(key) {
            return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
        },
        setItem(key, value) {
            store[key] = String(value);
        }
    };
}

{
    const zones = normalizeAlertZones(JSON.stringify([
        { id: "home", type: "home", label: "住家", lat: 25.033, lng: 121.565, radiusMeters: 5000 },
        { id: "bad", type: "work", label: "無座標", lat: "x", lng: 121.5 },
        { id: "dup", type: "unknown", label: "", lat: 24.15, lng: 120.67, radiusMeters: 999 },
        { id: "dup", type: "work", label: "duplicate", lat: 24.16, lng: 120.68, radiusMeters: 3000 }
    ]), "2026-01-01T00:00:00.000Z");

    assert.equal(zones.length, 2);
    assert.equal(zones[0].type, "home");
    assert.equal(zones[1].type, "frequent");
    assert.equal(zones[1].label, "常走");
    assert.equal(zones[1].radiusMeters, 3000);
}

{
    const zone = createAlertZone({
        id: "work-zone",
        type: "work",
        label: "公司",
        lat: 25.0478,
        lng: 121.5319,
        radiusMeters: 1000,
        now: "2026-01-01T00:00:00.000Z"
    });
    assert.equal(zone.id, "work-zone");
    assert.equal(zone.enabled, true);
    assert.equal(zone.createdAt, "2026-01-01T00:00:00.000Z");
}

{
    const storage = memoryStorage();
    const saved = saveAlertZones([
        { id: "home", type: "home", label: "住家", lat: 25.033, lng: 121.565, radiusMeters: 3000 }
    ], storage);
    assert.equal(saved.length, 1);
    assert.equal(JSON.parse(storage.getItem(ALERT_ZONES_STORAGE_KEY)).length, 1);
    assert.equal(loadAlertZones(storage)[0].id, "home");
}

{
    const zones = [
        { id: "home", type: "home", label: "住家", lat: 25.033, lng: 121.565, radiusMeters: 3000 },
        { id: "work", type: "work", label: "公司", lat: 24.15, lng: 120.67, radiusMeters: 1000 }
    ];
    const event = { id: "e1", lat: 25.034, lng: 121.566, locationQuality: "high", locationDisplayMode: "point" };
    const matches = matchAlertZones(event, zones, distanceMeters);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].zoneId, "home");

    const farEvent = { id: "e2", lat: 22.6, lng: 120.3, locationQuality: "high", locationDisplayMode: "point" };
    assert.equal(matchAlertZones(farEvent, zones, distanceMeters).length, 0);
}

{
    const zones = [
        { id: "home", type: "home", label: "住家", lat: 25.033, lng: 121.565, radiusMeters: 3000, enabled: false }
    ];
    const event = { id: "e1", lat: 25.034, lng: 121.566, locationQuality: "high", locationDisplayMode: "point" };
    assert.equal(matchAlertZones(event, zones, distanceMeters).length, 0);
}

{
    const zones = [
        { id: "home", type: "home", label: "住家", lat: 25.033, lng: 121.565, radiusMeters: 3000 }
    ];
    assert.equal(matchAlertZones({ lat: 25.034, lng: 121.566, locationQuality: "low" }, zones, distanceMeters).length, 0);
    assert.equal(matchAlertZones({ lat: 25.034, lng: 121.566, locationDisplayMode: "list_only" }, zones, distanceMeters).length, 0);
}

{
    const zones = [
        { id: "wide", type: "frequent", label: "常走", lat: 25.0, lng: 121.5, radiusMeters: 10000 },
        { id: "near", type: "home", label: "住家", lat: 25.033, lng: 121.565, radiusMeters: 3000 }
    ];
    const events = attachAlertZoneMatches([
        { id: "near-event", lat: 25.034, lng: 121.566, locationQuality: "high", locationDisplayMode: "point" },
        { id: "far-event", lat: 24.9, lng: 121.4, locationQuality: "high", locationDisplayMode: "point" }
    ], zones, distanceMeters);

    assert.equal(countAlertZoneMatchedEvents(events), 1);
    assert.equal(filterAlertZoneEvents(events).length, 1);
    assert.equal(sortAlertZoneEvents(filterAlertZoneEvents(events))[0].id, "near-event");
    assert.deepEqual(events[0].alertZoneMatches.map(match => match.zoneId), ["near", "wide"]);
}

console.log("alert-zones tests passed");
