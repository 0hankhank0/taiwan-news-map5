import assert from "node:assert/strict";
import { buildEventPath, getRequestedEventId, getRequestedCategory, isEventRoute } from "../assets/index/modules/event-permalink.mjs";

assert.equal(buildEventPath({ id: "news/a b" }), "/event/news%2Fa%20b");
assert.equal(getRequestedEventId({ pathname: "/event/news%2Fa%20b", search: "" }), "news/a b");
assert.equal(getRequestedEventId({ pathname: "/", search: "?event=legacy" }), "legacy");
assert.equal(isEventRoute("/event/a"), true);
assert.equal(getRequestedCategory({ pathname: "/category/crime" }, { crime: "社會治安" }), "crime");
console.log("event permalink tests passed");
