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
      this.container = typeof options.container === "string" ? document.getElementById(options.container) : options.container;
      setTimeout(() => { this.emit("style.load"); this.emit("load"); }, 60);
    }
    on(name, handler) { (this.handlers[name] ||= []).push(handler); return this; }
    emit(name, payload) { (this.handlers[name] || []).forEach((handler) => handler(payload || {})); }
    isStyleLoaded() { return true; }
    flyTo() {}
    addControl() {}
    getLayer() { return false; }
    getSource() { return false; }
    setLayoutProperty() {}
    addSource() {}
    addLayer() {}
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

    await page.goto(`http://127.0.0.1:${port}/video`, { waitUntil: "domcontentloaded" });
    try {
      await page.waitForFunction(() => window.VIDEO_DEMO_DONE === true, null, { timeout: 120000 });
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
      caption: document.querySelector(".video-demo-caption h1")?.textContent || "",
      finalVisible: document.querySelector(".video-demo-summary.visible") !== null,
    }));
    assert.equal(result.done, true);
    assert.match(result.caption, /分散資訊|在地判斷/);
    assert.equal(result.finalVisible, false);
    await browser.close();
    console.log("video demo tests passed");
  } finally {
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
