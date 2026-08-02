const assert = require("assert");
const fs = require("fs");
const path = require("path");
const handler = require("../event-page");

assert.equal(handler.CATEGORY_DESCRIPTIONS.traffic.includes("交通"), true);
const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
assert.equal(vercelConfig.functions["api/event-page.js"].includeFiles, "index.html");

function invoke(page, query) {
  const result = { status: 200, body: "" };
  const res = { status(code) { result.status = code; return this; }, setHeader(key, value) { result.headers = { ...result.headers, [key]: value }; }, send(body) { result.body = body; return this; } };
  return page({ query, headers: { host: "localhost:3000" } }, res).then(() => result);
}

(async () => {
  const modulePath = require.resolve("../event-page");
  const templatePath = path.join(__dirname, "..", "index.html");
  const originalReadFileSync = fs.readFileSync;
  try {
    fs.readFileSync = function (filePath, ...args) {
      if (path.resolve(filePath) === path.resolve(templatePath)) {
        const error = new Error("template missing for test");
        error.code = "ENOENT";
        throw error;
      }
      return originalReadFileSync.call(this, filePath, ...args);
    };
    delete require.cache[modulePath];
    const lazyHandler = require("../event-page");
    assert.equal(typeof lazyHandler, "function");
    const result = await invoke(lazyHandler, { eventId: "Miaoli_disaster_水雲瀑布" });
    assert.equal(result.status, 503);
    assert.match(result.body, /事件頁面暫時無法載入/);
    assert.match(result.body, /og:title/);
    assert.match(result.body, /Miaoli_disaster_%E6%B0%B4%E9%9B%B2%E7%80%91%E5%B8%83/);
  } finally {
    fs.readFileSync = originalReadFileSync;
    delete require.cache[modulePath];
  }
  console.log("event page metadata configuration tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
