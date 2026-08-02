import assert from "node:assert/strict";
import { getEventTime, isWithinTimeRange } from "../assets/index/modules/time-range-filter.mjs";
import {
    ACTIVITY_DEFAULT_DURATION_MS,
    ACTIVITY_ENDED_GRACE_MS,
    ACTIVITY_FUTURE_WINDOW_MS,
    TAIPEI_UTC_OFFSET,
    getActivityLifecycle,
    getEventLayer,
    isFutureActivity,
    isVisibleEventLayer,
    parseTaipeiEventTime
} from "../assets/index/modules/event-layer.mjs";
import { getLocationPresentation } from "../assets/index/modules/location-presentation.mjs";
import { isEventInBounds } from "../assets/index/modules/map-bounds-filter.mjs";
import { formatRelativeTime, getSourceSummary } from "../assets/index/modules/event-card-view.mjs";

const now = Date.parse("2026-07-30T12:00:00Z");
const activity = { category: "activity", title: "城市活動" };

assert.equal(parseTaipeiEventTime("2026-08-01T08:30:00"), Date.parse("2026-08-01T00:30:00Z"));
assert.equal(parseTaipeiEventTime("2026-08-01"), Date.parse("2026-07-31T16:00:00Z"));
assert.equal(TAIPEI_UTC_OFFSET, 8 * 60 * 60 * 1000);

const boundaryStart = now + ACTIVITY_FUTURE_WINDOW_MS;
assert.equal(isFutureActivity({ ...activity, startsAt: new Date(boundaryStart).toISOString() }, now), true);
assert.equal(isVisibleEventLayer({ ...activity, startsAt: new Date(boundaryStart).toISOString() }, { now, showUpcoming: true }), true);
assert.equal(isVisibleEventLayer({ ...activity, startsAt: new Date(boundaryStart + 1).toISOString() }, { now, showUpcoming: true }), false);

const defaultDuration = getActivityLifecycle({ ...activity, startsAt: "2026-07-30T10:00:00Z" }, now);
assert.equal(defaultDuration.end - defaultDuration.start, ACTIVITY_DEFAULT_DURATION_MS);
assert.equal(defaultDuration.state, "ongoing");

const justEnded = { ...activity, endsAt: new Date(now - ACTIVITY_ENDED_GRACE_MS).toISOString() };
const justEndedLifecycle = getActivityLifecycle(justEnded, now);
assert.equal(justEndedLifecycle.start, justEndedLifecycle.end - ACTIVITY_DEFAULT_DURATION_MS);
assert.equal(justEndedLifecycle.state, "recently_ended");
assert.equal(isVisibleEventLayer(justEnded, { now }), true);
const expired = { ...activity, endsAt: new Date(now - ACTIVITY_ENDED_GRACE_MS - 1).toISOString() };
assert.equal(getActivityLifecycle(expired, now).state, "ended");
assert.equal(isVisibleEventLayer(expired, { now }), false);

for (const status of ["cancelled", "expired", "resolved", "cleared"]) {
    assert.equal(isVisibleEventLayer({ ...activity, status }, { now, showUpcoming: true }), false, status);
}
assert.equal(isVisibleEventLayer({ ...activity, status: "upcoming" }, { now, showUpcoming: true }), false);
assert.equal(isVisibleEventLayer({ ...activity, startsAt: "2026-08-02T12:00:00Z", endsAt: "2026-08-01T12:00:00Z" }, { now, showUpcoming: true }), false);
assert.equal(getActivityLifecycle({ ...activity, status: "active" }, now).state, "ongoing");

assert.equal(getEventTime({ occurredAt: "2026-07-30T10:00:00Z", publishedAt: "2026-07-30T11:00:00Z" }).field, "occurredAt");
assert.equal(isWithinTimeRange({ publishedAt: "2026-07-30T02:00:00Z" }, "24h", now), true);
assert.equal(isWithinTimeRange({ publishedAt: "2026-07-28T02:00:00Z" }, "24h", now), false);
assert.equal(getEventLayer({ category: "traffic" }, now), "impact");
assert.equal(isVisibleEventLayer({ category: "traffic", status: "resolved" }, { now }), true);
assert.equal(getEventLayer({ category: "news", title: "一般新聞" }, now), "news");

assert.equal(getLocationPresentation({ locationPrecision: "exact", locationQuality: "high", lat: 25, lng: 121 }).mode, "exact");
assert.equal(getLocationPresentation({ locationPrecision: "district", locationQuality: "medium", lat: 25, lng: 121 }).mode, "estimated");
assert.equal(getLocationPresentation({ locationPrecision: "city", city: "台北市", lat: 23, lng: 120 }).mode, "city_area");
assert.equal(getLocationPresentation({ locationPrecision: "unknown" }).mode, "unlocated");
assert.equal(isEventInBounds({ lat: 25.04, lng: 121.56 }, { west: 121.5, east: 121.6, south: 25, north: 25.1 }), true);
assert.equal(isEventInBounds({ lat: 24.04, lng: 121.56 }, { west: 121.5, east: 121.6, south: 25, north: 25.1 }), false);
assert.equal(formatRelativeTime({ publishedAt: "2026-07-30T11:15:00Z" }, now), "45 分鐘前");
assert.equal(getSourceSummary({ source: "RSS", sourceTrace: [{}, {}, {}] }), "3 家媒體報導");

console.log("news map module tests passed");
