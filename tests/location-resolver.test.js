const assert = require("assert");
const {
  isCoordInCity,
  resolveLocationSync,
} = require("../api/location-resolver");

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
}

console.log("location-resolver tests passed");
