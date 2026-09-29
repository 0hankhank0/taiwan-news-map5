import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { isDuplicateEvent as isFrontendDuplicate } from "../assets/index/modules/event-dedup.mjs";

const require = createRequire(import.meta.url);
const { isDuplicateEvent: isBackendDuplicate, normalizeFinalEvents } = require("../event-refresh.js");

const news = (overrides = {}) => ({
    category: "traffic",
    eventKind: "news",
    title: "台北市信義區道路施工封閉",
    content: "信義區道路施工，請依現場指示通行。",
    city: "台北市",
    source: "RSS",
    lat: 25.03,
    lng: 121.56,
    publishedAt: "2026-09-29T01:00:00Z",
    ...overrides,
});

const assertParity = (a, b, expected) => {
    assert.equal(isFrontendDuplicate(a, b), expected);
    assert.equal(isBackendDuplicate(a, [b]), expected);
};

// A shared title prefix is not enough: closure and opening are separate states.
assertParity(news({ title: "台北市信義區道路施工解除" }), news(), false);

// Same title alone is not enough when the city, date, or source URL differs.
assertParity(news({ city: "台中市", lat: 24.15, lng: 120.68 }), news(), false);
assertParity(news({ url: "https://example.test/other" }), news({ url: "https://example.test/original" }), false);

// A stable source URL still identifies the same report even when its title changes.
assertParity(news({ title: "道路施工最新公告", url: "https://example.test/original" }), news({ url: "https://example.test/original" }), true);

// Completely identical records without a URL still need contextual identity.
assertParity(news({ url: "" }), news({ url: "" }), true);

const activity = (overrides = {}) => ({
    category: "activity",
    eventKind: "activity",
    title: "城市音樂會",
    venue: "台北市立公園",
    city: "台北市",
    startsAt: "2026-10-10T10:00:00Z",
    endsAt: "2026-10-10T12:00:00Z",
    ...overrides,
});
assertParity(activity(), activity(), true);
assertParity(activity({ startsAt: "2026-10-11T10:00:00Z", endsAt: "2026-10-11T12:00:00Z" }), activity(), false);

const normalized = normalizeFinalEvents([
    news({ id: "first", url: "https://example.test/close", title: "台北市信義區道路施工封閉" }),
    news({ id: "second", url: "https://example.test/clear", title: "台北市信義區道路施工解除" }),
]);
assert.equal(normalized.length, 2);

console.log("event dedup regression tests passed");
