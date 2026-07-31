import assert from "node:assert/strict";
import { getEventTime, isWithinTimeRange } from "../assets/index/modules/time-range-filter.mjs";
import { getEventLayer, isVisibleEventLayer } from "../assets/index/modules/event-layer.mjs";
import { getLocationPresentation } from "../assets/index/modules/location-presentation.mjs";
import { isEventInBounds } from "../assets/index/modules/map-bounds-filter.mjs";
import { formatRelativeTime, getSourceSummary } from "../assets/index/modules/event-card-view.mjs";

const now = Date.parse("2026-07-30T12:00:00Z");
assert.equal(getEventTime({ occurredAt: "2026-07-30T10:00:00Z", publishedAt: "2026-07-30T11:00:00Z" }).field, "occurredAt");
assert.equal(isWithinTimeRange({ publishedAt: "2026-07-30T02:00:00Z" }, "24h", now), true);
assert.equal(isWithinTimeRange({ publishedAt: "2026-07-28T02:00:00Z" }, "24h", now), false);

assert.equal(getEventLayer({ category: "traffic" }, now), "impact");
assert.equal(getEventLayer({ category: "activity", startsAt: "2026-08-02T12:00:00Z" }, now), "upcoming");
assert.equal(isVisibleEventLayer({ category: "activity", startsAt: "2026-08-02T12:00:00Z" }, { now }), false);

assert.equal(getLocationPresentation({ locationPrecision: "exact", locationQuality: "high", lat: 25, lng: 121 }).mode, "exact");
assert.equal(getLocationPresentation({ locationPrecision: "district", locationQuality: "medium", lat: 25, lng: 121 }).mode, "estimated");
assert.equal(getLocationPresentation({ locationPrecision: "city", city: "台南市", lat: 23, lng: 120 }).mode, "city_area");
assert.equal(getLocationPresentation({ locationPrecision: "unknown" }).mode, "unlocated");

assert.equal(isEventInBounds({ lat: 25.04, lng: 121.56 }, { west: 121.5, east: 121.6, south: 25, north: 25.1 }), true);
assert.equal(isEventInBounds({ lat: 24.04, lng: 121.56 }, { west: 121.5, east: 121.6, south: 25, north: 25.1 }), false);
assert.equal(formatRelativeTime({ publishedAt: "2026-07-30T11:15:00Z" }, now), "45 分鐘前");
assert.equal(getSourceSummary({ source: "RSS", sourceTrace: [{}, {}, {}] }), "3 家媒體報導");

console.log("news map module tests passed");
