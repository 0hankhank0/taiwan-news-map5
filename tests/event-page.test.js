const assert = require("assert");
const handler = require("../event-page");

assert.equal(handler.CATEGORY_DESCRIPTIONS.traffic.includes("交通"), true);
console.log("event page metadata configuration tests passed");
