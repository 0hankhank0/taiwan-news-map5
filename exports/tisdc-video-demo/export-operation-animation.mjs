import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import http from "node:http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ANIMATION_HTML = path.join(__dirname, "operation-animation.html");
const STATIC_ROOT = path.join(__dirname, "..");
const PREVIEW_DIR = path.join(__dirname, "previews");
const PREVIEW_FRAMES = [
  { time: 3, name: "01-event-map.png" },
  { time: 11, name: "02-category-filter.png" },
  { time: 14, name: "02-nearby-mode.png" },
  { time: 24, name: "03-report-loop.png" },
  { time: 38, name: "04-summary-cards.png" },
  { time: 45, name: "05-ending.png" },
];
const SYSTEM_BROWSER_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

async function findSystemBrowser() {
  for (const candidate of SYSTEM_BROWSER_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Keep checking known install paths.
    }
  }
  return "";
}

async function launchBrowser() {
  try {
    return await chromium.launch({
      headless: true,
      args: ["--autoplay-policy=no-user-gesture-required"],
    });
  } catch (error) {
    const executablePath = await findSystemBrowser();
    if (!executablePath) throw error;
    console.warn(`[tisdc-video] Playwright browser missing, using system browser: ${executablePath}`);
    return chromium.launch({
      headless: true,
      executablePath,
      args: ["--autoplay-policy=no-user-gesture-required", "--disable-gpu"],
    });
  }
}

function extensionForMime(mimeType) {
  return mimeType.includes("mp4") ? "mp4" : "webm";
}

function formatSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".css") return "text/css; charset=utf-8";
  return "application/octet-stream";
}

async function createStaticServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const rawPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const resolved = path.resolve(STATIC_ROOT, rawPath || "tisdc-video-demo/operation-animation.html");
    if (!resolved.startsWith(path.resolve(STATIC_ROOT))) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fsSync.stat(resolved, (statError, stat) => {
      if (statError || !stat.isFile()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": contentTypeFor(resolved),
        "Cache-Control": "no-store",
      });
      fsSync.createReadStream(resolved).pipe(res);
    });
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/tisdc-video-demo/operation-animation.html`,
  };
}

async function main() {
  const staticHost = await createStaticServer();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(180000);
    await page.goto(staticHost.url, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    console.log("[tisdc-video] Rendering 46s operation animation");
    const result = await page.evaluate(async () => window.renderAnimation());
    const extension = extensionForMime(result.mimeType || "video/webm");
    const output = path.join(__dirname, `island-pulse-operation-animation.${extension}`);
    await fs.writeFile(output, Buffer.from(result.base64, "base64"));
    const stat = await fs.stat(output);

    await fs.mkdir(PREVIEW_DIR, { recursive: true });
    for (const frame of PREVIEW_FRAMES) {
      await page.evaluate(time => window.previewFrame(time), frame.time);
      await page.screenshot({
        path: path.join(PREVIEW_DIR, frame.name),
        type: "png",
        fullPage: false,
      });
    }

    console.log(`[tisdc-video] ${path.basename(output)} - ${formatSize(stat.size)} - ${result.mimeType || "video/webm"}`);
    console.log(`[tisdc-video] ${output}`);
    console.log(`[tisdc-video] previews - ${PREVIEW_DIR}`);
    await page.close();
  } finally {
    await browser.close();
    staticHost.server.close();
  }
}

main().catch(error => {
  console.error("[tisdc-video] export failed");
  console.error(error);
  process.exitCode = 1;
});
