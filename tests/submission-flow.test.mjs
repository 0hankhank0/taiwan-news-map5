import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSubmissionPayload, getSubmissionResult, hasValidTaiwanCoordinates, validateSubmissionPayload } from "../assets/submit-event.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const homepage = fs.readFileSync(path.join(root, "index.html"), "utf8");
const submitPage = fs.readFileSync(path.join(root, "submit-event.html"), "utf8");
assert.match(homepage, /提供線索/); assert.match(homepage, /aria-label="提供新聞線索"/); assert.doesNotMatch(homepage, /新增事件/);
assert.match(submitPage, /<title>提供新聞線索｜島嶼脈搏<\/title>/); assert.match(submitPage, /<h1>提供新聞線索<\/h1>/); assert.match(submitPage, /不會直接顯示在公開地圖/);
assert.match(submitPage, /name="sourceType" required/); assert.doesNotMatch(submitPage, /value="life"/); assert.doesNotMatch(submitPage, /value="construction"/); assert.doesNotMatch(submitPage, /value="social"/);

const form = new FormData(); form.set("sourceType", "eyewitness"); form.set("description", "這是一段足夠長的現場目擊描述，用來說明事件影響與實際狀況。" ); form.set("publicImpactConfirmed", "on");
const payload = buildSubmissionPayload(form, { latitude: 25.033, longitude: 121.565 });
assert.equal(payload.latitude, 25.033); assert.equal(payload.longitude, 121.565);
assert.equal(hasValidTaiwanCoordinates(25.033, 121.565), true); assert.equal(hasValidTaiwanCoordinates(35, 121.565), false);
assert.deepEqual(validateSubmissionPayload({ sourceType: "news_report", publicImpactConfirmed: "on" }), ["新聞報導與官方公告必須提供來源網址。"]);
assert.deepEqual(validateSubmissionPayload({ sourceType: "official_notice", publicImpactConfirmed: "on" }), ["新聞報導與官方公告必須提供來源網址。"]);
assert.deepEqual(validateSubmissionPayload({ sourceType: "eyewitness", description: "足夠長的內容超過三十個字，卻沒有座標，因此不能送出。", publicImpactConfirmed: "on", latitude: null, longitude: null }), ["現場目擊必須提供台灣境內的有效座標。"]);
assert.deepEqual(validateSubmissionPayload({ sourceType: "eyewitness", description: "太短", publicImpactConfirmed: "on", latitude: 25.033, longitude: 121.565 }), ["現場目擊的事件描述至少需要 30 個字。"]);
assert.deepEqual(validateSubmissionPayload({ sourceType: "eyewitness", description: "這是一段足夠長的現場目擊描述，用來說明事件影響範圍與實際狀況，並提供管理員判斷所需背景。", latitude: 25.033, longitude: 121.565 }), ["請確認這是可能具有公共影響的事件，而非個人瑣事。"]);
const result = getSubmissionResult({ status: "approved", submissionId: "sub_focus" });
assert.equal(result.redirect, null); assert.match(result.message, /等待管理員確認/); assert.match(result.message, /投稿編號：sub_focus/);
console.log("submission flow tests passed");
