const assert = require("assert");
const {
  isCoordInCity,
  rankGeocodingCandidates,
  resolveLocationSync,
} = require("../location-resolver");
const { normalizeEvent } = require("../event-normalizer");

function approx(actual, expected, tolerance = 0.0005) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be close to ${expected}`);
}

{
  const event = {
    title: "TDX 即時路況",
    source: "TDX CMS",
    sourceName: "TDX CMS",
    city: "台中市",
    lat: 24.1234,
    lng: 120.5678,
  };
  const location = resolveLocationSync(event);
  approx(location.lat, 24.1234);
  approx(location.lng, 120.5678);
  assert.equal(location.locationPrecision, "exact");
  assert.equal(location.locationSource, "official");
  assert.equal(location.locationQuality, "high");
  assert.equal(location.locationDisplayMode, "point");
}

{
  const event = {
    title: "壽山動物園親子闖關活動",
    content: "高雄市農業局於壽山動物園舉辦親子活動。",
    city: "高雄市",
    address: "高雄市鼓山區壽山動物園",
    lat: 22.6273,
    lng: 120.3014,
    source: "自由地方",
  };
  const location = resolveLocationSync(event);
  approx(location.lat, 22.6378);
  approx(location.lng, 120.2766);
  assert.equal(location.locationPrecision, "exact");
  assert.equal(location.locationSource, "known-location");
}

{
  assert.equal(isCoordInCity("台北市", 22.6273, 120.3014), false);
  assert.equal(isCoordInCity("高雄市", 22.6273, 120.3014), true);
}

{
  const event = {
    title: "彰化車手詐300萬遭起訴",
    content: "檢方已依詐欺等罪起訴。",
    city: "彰化縣",
    address: "彰化縣",
    source: "自由社會",
  };
  const location = resolveLocationSync(event);
  approx(location.lat, 24.0817);
  approx(location.lng, 120.5384);
  assert.equal(location.locationPrecision, "city");
  assert.equal(location.locationQuality, "low");
  assert.equal(location.locationDisplayMode, "list_only");
}

{
  const event = {
    title: "台北防颱整備會議",
    content: "台北市政府說明防颱整備，未提供事件發生的街道或地標。",
    city: "台北市",
    address: "台北市",
    source: "自由地方",
    lat: 25.0347,
    lng: 121.5668,
    locationPrecision: "exact",
    locationSource: "provided",
    locationConfidence: 0.74,
    locationDisplayMode: "estimated",
  };
  const location = resolveLocationSync(event);
  approx(location.lat, 25.033);
  approx(location.lng, 121.5654);
  assert.equal(location.locationPrecision, "city");
  assert.equal(location.locationSource, "city-fallback");
  assert.equal(location.locationQuality, "low");
  assert.equal(location.locationDisplayMode, "list_only");

  const normalized = normalizeEvent(event);
  assert.equal(normalized.locationPrecision, "city");
  assert.equal(normalized.locationSource, "city-fallback");
  assert.equal(normalized.locationQuality, "low");
  assert.equal(normalized.locationDisplayMode, "list_only");
}

{
  const event = {
    title: "台北市信義區松仁路發生火警",
    content: "消防局在台北市信義區松仁路附近處理，周邊短暫管制。",
    city: "台北市",
    address: "台北市信義區松仁路",
    source: "自由社會",
    lat: 25.0347,
    lng: 121.5668,
    locationPrecision: "exact",
    locationSource: "nominatim",
    locationConfidence: 0.82,
    locationDisplayMode: "point",
  };
  const location = resolveLocationSync(event);
  approx(location.lat, 25.0347);
  approx(location.lng, 121.5668);
  assert.equal(location.locationPrecision, "exact");
  assert.equal(location.locationSource, "nominatim");
  assert.equal(location.locationDisplayMode, "point");
}

{
  const event = {
    title: "警廣即時路況",
    source: "PBS",
    sourceName: "PBS",
    city: "高雄市",
    lat: 22.6251,
    lng: 120.3009,
  };
  const location = resolveLocationSync(event);
  approx(location.lat, 22.6251);
  approx(location.lng, 120.3009);
  assert.equal(location.locationPrecision, "exact");
  assert.equal(location.locationSource, "official");
  assert.equal(location.locationDisplayMode, "point");
}

{
  const event = {
    title: "台北市信義區松仁路與松壽路口發生火警",
    content: "消防局在台北市信義區松仁路與松壽路口進行交通管制。",
    city: "台北市",
    locationEvidence: "台北市信義區松仁路與松壽路口發生火警",
    locationConfidence: 0.92,
  };
  const baseLocation = resolveLocationSync({
    ...event,
    address: "台北市信義區",
    lat: 25.033,
    lng: 121.5654,
  });
  const ranked = rankGeocodingCandidates(event, baseLocation, [
    {
      source: "mapbox",
      lat: 22.6273,
      lng: 120.3014,
      placeName: "高雄市前金區",
      featureType: "address",
      confidence: 0.99,
      query: "台北市信義區松仁路與松壽路口",
    },
    {
      source: "mapbox",
      lat: 25.0338,
      lng: 121.5681,
      placeName: "台北市信義區松仁路與松壽路口",
      featureType: "address",
      confidence: 0.9,
      query: "台北市信義區松仁路與松壽路口",
    },
  ]);
  assert.equal(ranked[0].accepted, true);
  assert.equal(ranked[0].locationQuality, "high");
  assert.equal(ranked[0].locationPrecision, "exact");
  approx(ranked[0].lat, 25.0338);
  assert.equal(ranked.some((candidate) => candidate.rejectedReason === "outside-city"), true);
}

console.log("location-resolver tests passed");
