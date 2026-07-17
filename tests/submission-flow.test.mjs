import assert from "node:assert/strict";
import { buildSubmissionPayload, getSubmissionResult, hasValidTaiwanCoordinates } from "../assets/submit-event.mjs";
import { findPublishedSubmission, getRequestedSubmissionId, removeSubmissionQuery } from "../assets/index/modules/submission-focus.mjs";

const payload = buildSubmissionPayload(new FormData(), { latitude: 25.033, longitude: 121.565 });
assert.equal(payload.latitude, 25.033);
assert.equal(payload.longitude, 121.565);
assert.equal(hasValidTaiwanCoordinates(25.033, 121.565), true);
assert.equal(hasValidTaiwanCoordinates(35, 121.565), false);

const approved = getSubmissionResult({ status: "approved", submissionId: "sub_focus" });
assert.equal(approved.redirect, "/?submission=sub_focus");
assert.match(approved.message, /已通過自動檢查並發布/);
assert.equal(getSubmissionResult({ status: "pending_admin", submissionId: "sub_pending" }).redirect, null);

assert.equal(getRequestedSubmissionId("?category=all&submission=sub_focus"), "sub_focus");
const target = findPublishedSubmission([{ source: "user_submission", submissionId: "sub_focus", lat: 25.033, lng: 121.565 }], "sub_focus");
assert.equal(target.submissionId, "sub_focus");
assert.equal(findPublishedSubmission([{ source: "RSS", submissionId: "sub_focus" }], "sub_focus"), null);
let replaced = "";
removeSubmissionQuery({ href: "https://news.example/?submission=sub_focus&category=all#map" }, { replaceState(_state, _title, url) { replaced = url; } });
assert.equal(replaced, "/?category=all#map");
console.log("submission flow tests passed");
