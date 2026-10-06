import assert from "node:assert/strict";
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
assert.match(getSearchableEventText({ address: "臺北市信義路", venue: "市民廣場", district: "信義區", summary: "改道措施" }), /台北市信義路 市民廣場/);
assert.match(getSearchableEventText({ summary: "改道措施" }), /改道措施/);

const rendered = [];
const failures = [];
forEachEventSafely(events, (event, index) => {
    if (index === 2) throw new Error("bad event");
    rendered.push(event);
}, (error, event, index) => failures.push({ error, event, index }));
assert.equal(rendered.length, events.length - 1);
assert.equal(failures.length, 1);
assert.equal(failures[0].index, 2);

console.log("event text safety tests passed");
