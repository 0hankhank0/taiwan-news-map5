const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const { chromium } = require("playwright");

const MAPBOX_STUB = `(() => {
  class Marker { constructor(options={}) { this.el=options.element||document.createElement("div"); } setLngLat(value) { this.lngLat=value; return this; } setPopup() { return this; } setSubpixelPositioning() { return this; } addTo() { (document.getElementById("map")||document.body).appendChild(this.el); return this; } getElement() { return this.el; } remove() { this.el.remove(); } }
  class Popup { setHTML() { return this; } setLngLat() { return this; } on() { return this; } addTo() { return this; } remove() {} }
  class Map { constructor(options={}) { this.handlers={}; this.sources={}; this.layers={}; window.__mapboxTestMap=this; setTimeout(()=>{ this.emit("style.load"); this.emit("load"); }, 20); } on(name, fn) { (this.handlers[name] ||= []).push(fn); return this; } emit(name) { (this.handlers[name]||[]).forEach(fn=>fn({})); } isStyleLoaded() { return true; } getSource(id) { return this.sources[id]||null; } getLayer(id) { return this.layers[id]||null; } addSource(id, definition) { this.sources[id]={...definition, setData:data=>{ this.sources[id].data=data; }}; } addLayer(definition) { this.layers[definition.id]={...definition}; } setLayoutProperty(id, prop, value) { if(this.layers[id]) (this.layers[id].layout ||= {})[prop]=value; } addControl() {} flyTo() {} resize() {} remove() {} }
  window.mapboxgl={Map, Marker, Popup, NavigationControl: class {}};
})();`;

function startServer(root) {
  const app = express();
  app.get("/api/config.js", (req, res) => res.type("js").send("window.APP_CONFIG={};"));
  app.use(express.static(root));
  return new Promise(resolve => { const server=app.listen(0, "127.0.0.1", () => resolve(server)); });
}
function findSystemBrowser() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || "";
}
async function launchChromium() {
  try { return await chromium.launch({ headless: true }); }
  catch (error) {
    const executablePath = findSystemBrowser();
    if (!executablePath) throw error;
    return chromium.launch({ headless: true, executablePath });
  }
}
function distanceMeters(a, b) {
  const r = 6371008.8, toRad = value => value * Math.PI / 180;
  const dLat=toRad(b[1]-a[1]), dLng=toRad(b[0]-a[0]);
  const h=Math.sin(dLat/2)**2+Math.cos(toRad(a[1]))*Math.cos(toRad(b[1]))*Math.sin(dLng/2)**2;
  return 2*r*Math.asin(Math.min(1,Math.sqrt(h)));
}

(async () => {
  const root = path.resolve(__dirname, "..");
  const server = await startServer(root);
  const port = server.address().port;
  const browser = await launchChromium();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, geolocation: { latitude: 25.033, longitude: 121.565 }, permissions: ["geolocation"] });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem("beta_accepted", "true"));
    await page.route("https://api.mapbox.com/mapbox-gl-js/**/mapbox-gl.js", route => route.fulfill({ contentType: "application/javascript", body: MAPBOX_STUB }));
    await page.route("https://api.mapbox.com/mapbox-gl-js/**/mapbox-gl.css", route => route.fulfill({ contentType: "text/css", body: "" }));
    await page.route(/https:\/\/(fonts|cdnjs)\./, route => route.fulfill({ contentType: "text/css", body: "" }));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    await page.click("#nearby-toggle-desktop");
    await page.waitForFunction(() => Boolean(window.__mapboxTestMap?.getSource("nearby-radius")));
    const first = await page.evaluate(() => {
      const map = window.__mapboxTestMap, source = map.getSource("nearby-radius");
      return { source, fill: map.getLayer("nearby-radius-fill"), line: map.getLayer("nearby-radius-line") };
    });
    assert.ok(first.fill && first.line, "nearby mode creates fill and line layers");
    const ring3 = first.source.data.features[0].geometry.coordinates[0];
    assert.ok(Math.abs(distanceMeters([121.565, 25.033], ring3[18]) - 3000) < 2, "3 km ring uses geographic meters");

    await page.click("#settings-btn");
    await page.waitForSelector("#settings-modal.visible");
    assert.equal(await page.locator("#nearby-radius-desktop").isVisible(), true, "desktop nearby radius control is visible in settings");
    assert.notEqual(
      await page.evaluate(() => document.getElementById("nearby-radius-desktop") === document.getElementById("alert-zone-radius")),
      true,
      "nearby radius and alert-zone radius use distinct controls"
    );
    assert.equal(await page.inputValue("#alert-zone-radius"), "3000", "alert-zone radius starts independently at 3 km");
    await page.selectOption("#nearby-radius-desktop", "5000");
    const desktopUpdate = await page.waitForFunction(() => window.__mapboxTestMap.getSource("nearby-radius").data.features[0]?.properties?.radiusMeters === 5000).then(handle => handle.jsonValue());
    assert.equal(desktopUpdate, true);
    assert.equal(await page.inputValue("#alert-zone-radius"), "3000", "desktop nearby radius does not modify alert-zone radius");
    assert.equal(await page.evaluate(() => Object.keys(window.__mapboxTestMap.sources).filter(id => id === "nearby-radius").length), 1, "radius changes reuse one source");

    await page.click("#settings-close-btn");
    await page.waitForFunction(() => !document.getElementById("settings-modal").classList.contains("visible"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.selectOption("#nearby-radius-mobile", "10000");
    await page.waitForFunction(() => window.__mapboxTestMap.getSource("nearby-radius").data.features[0]?.properties?.radiusMeters === 10000);
    assert.equal(await page.inputValue("#nearby-radius-desktop"), "10000", "mobile and desktop selectors stay synchronized");
    assert.equal(await page.inputValue("#alert-zone-radius"), "3000", "mobile nearby radius does not modify alert-zone radius");

    await page.click("#nearby-toggle-mobile");
    await page.waitForFunction(() => window.__mapboxTestMap.getSource("nearby-radius").data.features.length === 0);
    assert.equal(await page.evaluate(() => window.__mapboxTestMap.getLayer("nearby-radius-fill").layout.visibility), "none", "turning off nearby mode hides the ring");
    await context.close();
    console.log("nearby radius UI tests passed");
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exit(1); });
