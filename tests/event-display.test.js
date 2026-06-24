const assert = require("assert");
const display = require("../event-display");

{
  const event = {
    title: "國道1號南向發生追撞事故",
    category: "traffic",
    content: "事故造成回堵，警方到場處理。",
  };
  assert.equal(display.resolveGroupCategory(event), "accident");
  assert.equal(display.getEventStatusLabel({ ...event, status: "active" }), "影響中");
  assert.equal(display.getEventAdviceLabel(event), "避開事故現場，依警方或現場人員指揮通行。");
  assert.ok(display.getEventImpactTags(event).includes("交通"));
}

{
  const event = {
    title: "9月演唱會首辦",
    category: "activity",
    city: "台北市",
    venue: "台北小巨蛋",
    startsAt: "2099-09-12T10:00:00.000Z",
  };
  assert.equal(display.resolveGroupCategory(event), "activity");
  assert.equal(display.getEventStatusLabel(event), "未來活動");
  assert.equal(display.getEventAdviceLabel(event), "前往前確認時間、交通與入場資訊");
}

{
  const exact = {
    locationPrecision: "exact",
    locationQuality: "high",
    locationConfidence: 0.94,
    locationDisplayMode: "point",
  };
  assert.equal(display.getLocationQuality(exact), "high");
  assert.equal(display.getLocationDisplayMode(exact), "point");
  assert.equal(display.getLocationPrecisionLabel(exact), "精準定位");
  assert.equal(display.getLocationConfidenceLabel(exact), "94%");

  const low = {
    locationPrecision: "city",
    locationQuality: "low",
    locationDisplayMode: "list_only",
  };
  assert.equal(display.getLocationPrecisionLabel(low), "定位待確認");
}

{
  assert.equal(display.getReviewStateLabel({ reviewState: "reviewed" }), "已人工覆核");
  assert.equal(display.getReviewStateLabel({ verifiedStatus: "resolved" }), "已解除");
  assert.equal(display.getSourceTraceLabel({ sourceName: "RSS", sourceTrace: [{}, {}] }), "RSS +1");
}

console.log("event-display tests passed");
