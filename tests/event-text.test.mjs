import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
    forEachEventSafely,
    getSearchableEventText,
    isMourningEvent,
    normalizeEventTextFields
} from "../assets/index/modules/event-text.mjs";

const events = [
    { title: undefined, content: undefined },
    { title: 123, content: 456 },
    { title: null, content: { message: "事故" } },
    { title: "事故造成死亡", content: null },
    { title: "一般道路施工", content: ["封閉", "改道"] },
    { hasCasualty: false, title: "死亡事故舊聞" },
    { hasCasualty: "false", title: "一般事件" }
];

for (const event of events) {
    assert.doesNotThrow(() => isMourningEvent(event));
    assert.doesNotThrow(() => getSearchableEventText(event));
    const normalized = normalizeEventTextFields(event);
    assert.equal(typeof normalized.title, "string");
    assert.equal(typeof normalized.content, "string");
    assert.equal(typeof normalized.city, "string");
    assert.equal(typeof normalized.source, "string");
}

assert.equal(normalizeEventTextFields(events[0]).title, "未命名事件");
assert.equal(isMourningEvent(events[3]), true);
assert.equal(isMourningEvent(events[5]), false);
assert.equal(isMourningEvent(events[6]), false);
assert.match(getSearchableEventText(events[2]), /事故/);
assert.match(getSearchableEventText(events[4]), /封閉/);

const rendered = [];
const failures = [];
forEachEventSafely(events, (event, index) => {
    if (index === 2) throw new Error("bad event");
    rendered.push(event);
}, (error, event, index) => failures.push({ error, event, index }));
assert.equal(rendered.length, events.length - 1);
assert.equal(failures.length, 1);
assert.equal(failures[0].index, 2);

const mainSource = fs.readFileSync(path.resolve("assets/index/main.mjs"), "utf8");
assert.match(mainSource, /資料服務暫時無法連線，目前顯示展示資料/);
assert.match(mainSource, /\[island-pulse\] 事件渲染失敗/);
assert.ok(
    mainSource.indexOf("資料服務暫時無法連線，目前顯示展示資料")
        < mainSource.indexOf("[island-pulse] 事件渲染失敗"),
    "API fallback and render errors must be handled in separate branches"
);

console.log("event text safety tests passed");
