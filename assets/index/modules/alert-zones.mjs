export const ALERT_ZONES_STORAGE_KEY = "tnm_alert_zones_v1";
export const ALERT_ZONE_MAX_ITEMS = 10;
export const ALERT_ZONE_TYPES = {
    home: "住家",
    work: "公司",
    frequent: "常走"
};
export const ALERT_ZONE_RADII = [1000, 3000, 5000, 10000];

function defaultStorage() {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    return null;
}

function parseStoredValue(value) {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch {
        return [];
    }
}

function numberOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function isValidCoordinate(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function normalizeType(type) {
    const raw = String(type || "").trim();
    return Object.prototype.hasOwnProperty.call(ALERT_ZONE_TYPES, raw) ? raw : "frequent";
}

function normalizeRadius(value) {
    const radius = Number(value);
    return ALERT_ZONE_RADII.includes(radius) ? radius : 3000;
}

function zoneTimestamp(value, fallback) {
    const raw = String(value || "").trim();
    if (!raw) return fallback;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeZone(zone, index = 0, now = new Date().toISOString()) {
    if (!zone || typeof zone !== "object") return null;
    const lat = numberOrNull(zone.lat);
    const lng = numberOrNull(zone.lng);
    if (!isValidCoordinate(lat, lng)) return null;
    const type = normalizeType(zone.type);
    const fallbackLabel = ALERT_ZONE_TYPES[type] || ALERT_ZONE_TYPES.frequent;
    const label = String(zone.label || fallbackLabel).trim().slice(0, 24) || fallbackLabel;
    const id = String(zone.id || `zone_${index + 1}`).trim().slice(0, 80) || `zone_${index + 1}`;
    const createdAt = zoneTimestamp(zone.createdAt, now);
    const updatedAt = zoneTimestamp(zone.updatedAt, createdAt);
    return {
        id,
        type,
        label,
        lat,
        lng,
        radiusMeters: normalizeRadius(zone.radiusMeters || zone.radius || zone.distanceMeters),
        enabled: zone.enabled !== false,
        createdAt,
        updatedAt
    };
}

export function normalizeAlertZones(value, now = new Date().toISOString()) {
    const parsed = parseStoredValue(value);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.zones) ? parsed.zones : [];
    const seen = new Set();
    const zones = [];
    for (let i = 0; i < list.length && zones.length < ALERT_ZONE_MAX_ITEMS; i += 1) {
        const normalized = normalizeZone(list[i], i, now);
        if (!normalized || seen.has(normalized.id)) continue;
        seen.add(normalized.id);
        zones.push(normalized);
    }
    return zones;
}

export function loadAlertZones(storage = defaultStorage()) {
    if (!storage || typeof storage.getItem !== "function") return [];
    return normalizeAlertZones(storage.getItem(ALERT_ZONES_STORAGE_KEY));
}

export function saveAlertZones(zones, storage = defaultStorage()) {
    const normalized = normalizeAlertZones(zones);
    if (storage && typeof storage.setItem === "function") {
        storage.setItem(ALERT_ZONES_STORAGE_KEY, JSON.stringify(normalized));
    }
    return normalized;
}

export function createAlertZone({ type = "frequent", label = "", lat, lng, radiusMeters = 3000, now = new Date(), id = "" } = {}) {
    const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    const normalizedType = normalizeType(type);
    const fallbackLabel = ALERT_ZONE_TYPES[normalizedType] || ALERT_ZONE_TYPES.frequent;
    const zone = normalizeZone({
        id: id || `zone_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        type: normalizedType,
        label: label || fallbackLabel,
        lat,
        lng,
        radiusMeters,
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp
    }, 0, timestamp);
    if (!zone) throw new Error("Invalid alert zone coordinates");
    return zone;
}

export function updateAlertZone(zones, zoneId, patch = {}) {
    const now = new Date().toISOString();
    return normalizeAlertZones(zones).map(zone => {
        if (zone.id !== zoneId) return zone;
        return normalizeZone({
            ...zone,
            ...patch,
            id: zone.id,
            updatedAt: now
        }, 0, now) || zone;
    });
}

export function removeAlertZone(zones, zoneId) {
    return normalizeAlertZones(zones).filter(zone => zone.id !== zoneId);
}

export function getAlertZoneTypeLabel(type) {
    return ALERT_ZONE_TYPES[normalizeType(type)] || ALERT_ZONE_TYPES.frequent;
}

export function formatAlertZoneRadius(meters) {
    const value = Number(meters);
    if (!Number.isFinite(value) || value <= 0) return "";
    if (value >= 1000) {
        const km = value / 1000;
        const rounded = km >= 10 ? Math.round(km) : Math.round(km * 10) / 10;
        return `${String(rounded).replace(/\.0$/, "")} km`;
    }
    return `${Math.round(value)} m`;
}

export function canEventMatchAlertZone(event) {
    if (!event || typeof event !== "object") return false;
    const lat = numberOrNull(event.lat);
    const lng = numberOrNull(event.lng);
    if (!isValidCoordinate(lat, lng)) return false;
    const quality = String(event.locationQuality || "").trim().toLowerCase();
    const displayMode = String(event.locationDisplayMode || "").trim().toLowerCase();
    if (quality === "low" || displayMode === "list_only") return false;
    return true;
}

export function matchAlertZones(event, zones, distanceMeters) {
    if (!canEventMatchAlertZone(event) || typeof distanceMeters !== "function") return [];
    const eventLat = Number(event.lat);
    const eventLng = Number(event.lng);
    return normalizeAlertZones(zones)
        .filter(zone => zone.enabled)
        .map(zone => ({
            zoneId: zone.id,
            label: zone.label,
            type: zone.type,
            typeLabel: getAlertZoneTypeLabel(zone.type),
            distanceMeters: distanceMeters(zone.lat, zone.lng, eventLat, eventLng),
            radiusMeters: zone.radiusMeters
        }))
        .filter(match => Number.isFinite(match.distanceMeters) && match.distanceMeters <= match.radiusMeters)
        .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export function attachAlertZoneMatches(events, zones, distanceMeters) {
    const list = Array.isArray(events) ? events : [];
    return list.map(event => ({
        ...event,
        alertZoneMatches: matchAlertZones(event, zones, distanceMeters)
    }));
}

export function filterAlertZoneEvents(events) {
    return (Array.isArray(events) ? events : []).filter(event => Array.isArray(event.alertZoneMatches) && event.alertZoneMatches.length > 0);
}

export function sortAlertZoneEvents(events) {
    return [...(Array.isArray(events) ? events : [])].sort((a, b) => {
        const aDistance = Math.min(...(a.alertZoneMatches || []).map(match => match.distanceMeters), Infinity);
        const bDistance = Math.min(...(b.alertZoneMatches || []).map(match => match.distanceMeters), Infinity);
        if (aDistance !== bDistance) return aDistance - bDistance;
        const aTime = Date.parse(a.updatedAt || a.publishedAt || a.createdAt || "") || 0;
        const bTime = Date.parse(b.updatedAt || b.publishedAt || b.createdAt || "") || 0;
        return bTime - aTime;
    });
}

export function countAlertZoneMatchedEvents(events) {
    return filterAlertZoneEvents(events).length;
}
