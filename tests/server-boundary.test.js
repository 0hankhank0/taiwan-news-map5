const assert = require("node:assert/strict");
const os = require("node:os"), path = require("node:path");
process.env.PORT = "0";
delete process.env.HOST;
process.env.EVENT_STORE_MODE = "local";
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `server-boundary-${process.pid}.sqlite`);
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
require.cache[require.resolve("dotenv")] = { exports: { config() {} } };
const express = require("express");
const listen = express.application.listen;
let server;
(async () => {
  await new Promise((resolve, reject) => {
    express.application.listen = function (...args) { server = listen.apply(this, args); server.once("listening", resolve); server.once("error", reject); return server; };
    require("../server");
  });
  assert.equal(server.address().address, "127.0.0.1");
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const url of ["/server.js", "/package.json", "/data/taiwan-news-cache.sqlite", "/.env", "/test-artifacts/project-diagnostics/results.json", "/api/nonexistent"]) {
    const response = await fetch(base + url); assert.equal(response.status, 404, url);
  }
  for (const url of ["/", "/brand-logo.jpg", "/event-display.js", "/event-content-filter.js", "/assets/index/main.mjs", "/shared/event-categories.js", "/admin-events.html"]) assert.equal((await fetch(base + url)).status, 200, url);
  const callback = await fetch(base + "/api/payment-callback", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "RtnCode=1" });
  assert.notEqual(await callback.text(), "1|OK", "unsigned callback cannot be accepted");
  assert.ok(callback.status >= 400);
  console.log("server boundary tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { express.application.listen = listen; server?.close(); });
