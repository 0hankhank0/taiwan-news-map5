const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const { chromium } = require("playwright");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function waitForServer(url, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(url, (res) => {
        res.resume();
        resolve();
      }).on("error", (error) => {
        if (Date.now() > end) reject(error);
        else setTimeout(tick, 150);
      });
    };
    tick();
  });
}

function startStaticServer(root, port) {
  const app = express();
  app.get("/api/config.js", (req, res) => {
    res.type("application/javascript").send("window.APP_CONFIG = window.APP_CONFIG || {};");
  });
  app.use(express.static(root));
  app.use((req, res) => {
    res.type("html").send(fs.readFileSync(path.join(root, "index.html"), "utf8"));
  });
  return new Promise((resolve) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
  });
}

const MAPBOX_STUB = `
(() => {
  let markerIndex = 0;
  class Popup {
    constructor() { this.html = ""; this.handlers = {}; }
    setHTML(html) { this.html = html; return this; }
    setLngLat() { return this; }
    on(name, handler) { this.handlers[name] = handler; return this; }
    addTo() {
      this.remove();
      this.el = document.createElement("div");
      this.el.className = "mapboxgl-popup custom-popup";
      this.el.innerHTML = this.html;
      document.body.appendChild(this.el);
      this.handlers.open?.();
      return this;
    }
    getElement() { return this.el || document.createElement("div"); }
    remove() { if (this.el) this.el.remove(); this.handlers.close?.(); this.el = null; }
  }
  class Marker {
    constructor(options = {}) { this.el = options.element || document.createElement("div"); }
    setLngLat(value) { this.lngLat = value; return this; }
    setPopup(popup) { this.popup = popup; return this; }
    addTo() {
      const mapEl = document.getElementById("map") || document.body;
      const i = markerIndex++;
      if (this.el.classList.contains("user-location-dot")) {
        Object.assign(this.el.style, {
          position: "absolute",
          left: "52%",
          top: "48%",
          zIndex: "120",
          transform: "translate(-50%, -50%)"
        });
        mapEl.appendChild(this.el);
        return this;
      }
      Object.assign(this.el.style, {
        position: "absolute",
        left: (46 + (i % 4) * 10) + "%",
        top: (30 + Math.floor(i / 4) * 14) + "%",
        zIndex: String(30 + i)
      });
      this.el.addEventListener("click", () => this.popup?.addTo());
      mapEl.appendChild(this.el);
      return this;
    }
    getElement() { return this.el; }
    remove() { this.el.remove(); }
  }
  class Map {
    constructor(options = {}) {
      this.handlers = {};
      this.sources = {};
      this.layers = {};
      this.container = typeof options.container === "string" ? document.getElementById(options.container) : options.container;
      window.__mapboxTestMap = this;
      setTimeout(() => { this.emit("style.load"); this.emit("load"); }, 60);
    }
    on(name, handler) { (this.handlers[name] ||= []).push(handler); return this; }
    emit(name, payload) { (this.handlers[name] || []).forEach((handler) => handler(payload || {})); }
    isStyleLoaded() { return true; }
    flyTo() {}
    addControl() {}
    getLayer(id) { return this.layers[id] || null; }
    getSource(id) { return this.sources[id] || null; }
    setLayoutProperty(id, property, value) { if (this.layers[id]) (this.layers[id].layout ||= {})[property] = value; }
    addSource(id, definition) {
      this.sources[id] = { ...definition, data: definition.data, setData: (data) => { this.sources[id].data = data; } };
    }
    addLayer(definition) { this.layers[definition.id] = { ...definition }; }
    resize() {}
    remove() {}
  }
  window.mapboxgl = { Map, Marker, Popup, NavigationControl: class NavigationControl {} };
})();
`;

function findSystemBrowser() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

async function launchChromium() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const executablePath = findSystemBrowser();
    if (!executablePath) throw error;
    return chromium.launch({ headless: true, executablePath });
  }
}

(async () => {
  const port = await getFreePort();
  const root = path.resolve(__dirname, "..");
  const mainModuleSource = fs.readFileSync(path.join(root, "assets", "index", "main.mjs"), "utf8");
  const server = await startStaticServer(root, port);

  try {
    await waitForServer(`http://127.0.0.1:${port}/video`);
    const browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const browserMessages = [];
    page.on("console", (message) => browserMessages.push(`${message.type()}: ${message.text()}`));
    page.on("pageerror", (error) => browserMessages.push(`pageerror: ${error.message}`));
    page.on("response", (response) => {
      if (response.status() >= 400) browserMessages.push(`response ${response.status()}: ${response.url()}`);
    });
    page.on("requestfailed", (request) => {
      browserMessages.push(`requestfailed: ${request.url()} ${request.failure()?.errorText || ""}`);
    });
    await page.route("https://api.mapbox.com/mapbox-gl-js/**/mapbox-gl.js", (route) => {
      route.fulfill({ status: 200, contentType: "application/javascript", body: MAPBOX_STUB });
    });
    await page.route("https://api.mapbox.com/mapbox-gl-js/**/mapbox-gl.css", (route) => {
      route.fulfill({ status: 200, contentType: "text/css", body: "" });
    });
    await page.route(/https:\/\/(fonts|cdnjs)\./, (route) => {
      route.fulfill({ status: 200, contentType: "text/css", body: "" });
    });

    const startedAt = Date.now();
    await page.goto(`http://127.0.0.1:${port}/video?test=1`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Array.isArray(window.VIDEO_DEMO_EVENTS) && window.VIDEO_DEMO_EVENTS.length >= 70 && window.VIDEO_DEMO_EVENTS.length <= 80);
    let initialState;
    try {
      initialState = await page.waitForFunction(() => {
        const state = window.VIDEO_DEMO_STATE;
        if (!state || state.activeCategory !== "all" || state.isNearbyMode) return false;
        return state.markerCount > 60 ? state : false;
      }, null, { timeout: 12000 }).then((handle) => handle.jsonValue());
    } catch (error) {
      const state = await page.evaluate(() => ({
        demoEvents: window.VIDEO_DEMO_EVENTS?.length || 0,
        state: window.VIDEO_DEMO_STATE || null,
        markers: document.querySelectorAll(".map-pin.event-marker").length,
        cards: document.querySelectorAll(".event-card-v2").length,
      }));
      console.error("initial marker state:", JSON.stringify(state));
      throw error;
    }

    const trafficState = await page.waitForFunction((initialMarkers) => {
      const state = window.VIDEO_DEMO_STATE;
      if (!state || state.activeCategory !== "traffic" || state.isNearbyMode) return false;
      return state.markerCount < initialMarkers ? state : false;
    }, initialState.markerCount, { timeout: 25000 }).then((handle) => handle.jsonValue());

    const rangeAlignmentPromise = page.waitForFunction(() => {
      const range = document.querySelector(".video-demo-range.visible");
      const marker = document.querySelector(".user-location-dot");
      if (!range || !marker) return false;
      const rangeRect = range.getBoundingClientRect();
      const markerRect = marker.getBoundingClientRect();
      if (!rangeRect.width || !markerRect.width) return false;
      const dx = (rangeRect.left + rangeRect.width / 2) - (markerRect.left + markerRect.width / 2);
      const dy = (rangeRect.top + rangeRect.height / 2) - (markerRect.top + markerRect.height / 2);
      const distance = Math.hypot(dx, dy);
      return distance < 5 ? { dx, dy, distance } : false;
    }, null, { timeout: 45000 }).then((handle) => handle.jsonValue());

    const nearby3State = await page.waitForFunction(() => {
      const state = window.VIDEO_DEMO_STATE;
      if (!state || !state.isNearbyMode || state.nearbyRadiusMeters !== 3000) return false;
      return state.visibleCount >= 3 && state.visibleCount <= 5 ? state : false;
    }, null, { timeout: 35000 }).then((handle) => handle.jsonValue());

    const nearby5State = await page.waitForFunction((nearby3Count) => {
      const state = window.VIDEO_DEMO_STATE;
      if (!state || !state.isNearbyMode || state.nearbyRadiusMeters !== 5000) return false;
      if (state.visibleCount <= nearby3Count) return false;
      return state.visibleCount >= 9 && state.visibleCount <= 12 ? state : false;
    }, nearby3State.visibleCount, { timeout: 45000 }).then((handle) => handle.jsonValue());

    const reportStep = await page.waitForFunction(() => {
      const title = document.querySelector(".video-demo-caption h1")?.textContent || "";
      const copy = document.querySelector(".video-demo-caption p")?.textContent || "";
      return title.includes("共同修正資料") && copy.includes("使用者可補充錯誤位置或分類") ? { title, copy } : false;
    }, null, { timeout: 55000 }).then((handle) => handle.jsonValue());

    const rangeAlignment = await rangeAlignmentPromise;

    const successStartedAt = await page.waitForFunction(() => {
      const success = document.getElementById("report-success");
      if (!success || success.style.display !== "block") return false;
      if (!/已送出，等待覆核/.test(success.textContent || "")) return false;
      return Date.now();
    }, null, { timeout: 55000 }).then((handle) => handle.jsonValue());
    const demoSuccessNote = await page.waitForFunction(() => {
      const note = document.querySelector("#report-success .video-demo-report-note");
      return note?.textContent?.trim() === "影片示範模式不寫入正式資料庫。" ? note.textContent.trim() : false;
    }, null, { timeout: 55000 }).then((handle) => handle.jsonValue());
    const reportSubmitAlignment = await page.waitForFunction(() => {
      const submitButton = document.getElementById("report-submit-btn");
      const frame = document.querySelector(".video-demo-frame.visible");
      if (!submitButton || !frame) return false;
      const submitRect = submitButton.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      if (!submitRect.width || !submitRect.height || !frameRect.width || !frameRect.height) return false;
      const alignment = {
        dx: (frameRect.left + frameRect.width / 2) - (submitRect.left + submitRect.width / 2),
        dy: (frameRect.top + frameRect.height / 2) - (submitRect.top + submitRect.height / 2),
      };
      return Math.abs(alignment.dx) < 5 && Math.abs(alignment.dy) < 5 ? alignment : false;
    }, null, { timeout: 55000 }).then((handle) => handle.jsonValue());
    const successVisibilityWaitMs = 800;
    await page.waitForTimeout(successVisibilityWaitMs);
    const successStillVisible = await page.evaluate(() => {
      const success = document.getElementById("report-success");
      return Boolean(success && success.style.display === "block" && /已送出，等待覆核/.test(success.textContent || ""));
    });
    const successDurationMs = Date.now() - successStartedAt;

    try {
      await page.waitForFunction(() => window.VIDEO_DEMO_DONE === true, null, { timeout: 60000 });
    } catch (error) {
      const state = await page.evaluate(() => ({
        done: window.VIDEO_DEMO_DONE,
        caption: document.querySelector(".video-demo-caption h1")?.textContent || "",
        step: document.querySelector(".video-demo-step")?.textContent || "",
        cards: document.querySelectorAll(".event-card-v2").length,
        pins: document.querySelectorAll(".map-pin.event-marker").length,
        modalVisible: document.querySelector("#report-modal.visible") !== null,
      })).catch(() => ({}));
      console.error("video demo timeout state:", JSON.stringify(state));
      console.error("browser messages:", browserMessages.slice(-20).join("\n"));
      throw error;
    }
    const result = await page.evaluate(() => ({
      done: window.VIDEO_DEMO_DONE === true,
      eventCount: window.VIDEO_DEMO_EVENTS?.length || 0,
      caption: document.querySelector(".video-demo-caption h1")?.textContent || "",
      finalVisible: document.querySelector(".video-demo-summary.visible") !== null,
      nearbySourceExists: Boolean(window.__mapboxTestMap?.getSource("nearby-radius")),
    }));
    const elapsedMs = Date.now() - startedAt;
    assert.equal(result.done, true);
    assert.ok(result.eventCount >= 70 && result.eventCount <= 80, `unexpected event count ${result.eventCount}`);
    assert.ok(initialState.markerCount > 60, `initial marker count ${initialState.markerCount}`);
    assert.ok(trafficState.markerCount < initialState.markerCount, `traffic markers ${trafficState.markerCount} should be below ${initialState.markerCount}`);
    assert.ok(nearby3State.visibleCount < nearby5State.visibleCount, `3 km ${nearby3State.visibleCount} should be below 5 km ${nearby5State.visibleCount}`);
    assert.ok(nearby5State.visibleCount >= 9 && nearby5State.visibleCount <= 12, `5 km count ${nearby5State.visibleCount}`);
    assert.ok(rangeAlignment.distance < 5, `range center is ${rangeAlignment.distance}px from user marker`);
    assert.match(reportStep.title, /共同修正資料/);
    assert.match(reportStep.copy, /使用者可補充錯誤位置或分類/);
    assert.equal(demoSuccessNote, "影片示範模式不寫入正式資料庫。");
    assert.match(mainModuleSource, /type === "success" && VIDEO_DEMO_ROUTE/, "the video-demo database notice must be gated to VIDEO_DEMO_ROUTE");
    assert.ok(Math.abs(reportSubmitAlignment.dx) < 5, `report frame horizontal offset is ${reportSubmitAlignment.dx}px`);
    assert.ok(Math.abs(reportSubmitAlignment.dy) < 5, `report frame vertical offset is ${reportSubmitAlignment.dy}px`);
    assert.equal(successStillVisible, true, `report success disappeared after ${successDurationMs}ms`);
    assert.ok(successDurationMs >= successVisibilityWaitMs, `report success lasted ${successDurationMs}ms`);
    assert.ok(elapsedMs < 50000, `video demo took ${elapsedMs}ms`);
    assert.match(mainModuleSource, /<article><span>System<\/span><strong>持續完善中<\/strong><small>資料來源、覆核機制與使用體驗持續優化<\/small><\/article>/);
    for (const forbiddenText of ["\u6797\u5efa\u5b8f", "\u4f5c\u8005\uff0f\u5718\u968a\u8cc7\u8a0a", "\u8acb\u65bc\u6b63\u5f0f\u9001\u4ef6\u524d\u586b\u5165\u540d\u7a31", "\u56de\u5831\u8207\u8986\u6838\u6d41\u7a0b\u539f\u578b", "\u6a21\u64ec\u9001\u51fa\u5b8c\u6210", "\u4e0d\u6703\u9032\u5165\u771f\u5be6\u8986\u6838\u6d41\u7a0b", "\u90e8\u5206\u8cc7\u6599\u56de\u5831\u8207\u5f8c\u7aef\u8986\u6838\u6d41\u7a0b\u70ba\u6982\u5ff5\u6a21\u64ec"]) {
      assert.equal(mainModuleSource.includes(forbiddenText), false, `video demo source contains forbidden text: ${forbiddenText}`);
    }
    assert.match(result.caption, /分散資訊|在地判斷/);
    assert.equal(result.finalVisible, false);
    assert.equal(result.nearbySourceExists, false, "video route must not add the normal nearby radius layer");
    await browser.close();
    console.log("video demo tests passed");
  } finally {
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
