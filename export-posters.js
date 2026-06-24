const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");

const ROOT = __dirname;
const SOURCE = path.join(ROOT, "poster-export.html");
const OUT_DIR = path.join(ROOT, "exports", "goldenpin");
const WIDTH = 3508;
const HEIGHT = 2480;
const MIN_BYTES = 2 * 1024 * 1024;
const MAX_BYTES = 5 * 1024 * 1024;
const GRAIN_OPACITIES = [0, 0.012, 0.02, 0.032, 0.048, 0.064, 0.084, 0.11, 0.14];

const GRAIN_SVG = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220">
  <filter id="n">
    <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="4" stitchTiles="stitch"/>
    <feColorMatrix type="saturate" values="0"/>
  </filter>
  <rect width="220" height="220" filter="url(#n)" opacity="0.72"/>
</svg>
`.trim());

function mb(bytes) {
  return bytes / 1024 / 1024;
}

function formatMb(bytes) {
  return `${mb(bytes).toFixed(2)} MB`;
}

function isCompliant(bytes) {
  return bytes >= MIN_BYTES && bytes <= MAX_BYTES;
}

function findChromeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function getImageSize(filePath) {
  const buffer = fs.readFileSync(filePath);

  if (buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }

      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      const isStartOfFrame =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);

      if (isStartOfFrame) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }

      offset += 2 + length;
    }
  }

  return { width: 0, height: 0 };
}

async function capturePoster(page, locator, options) {
  const top = await locator.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  await page.evaluate((y) => window.scrollTo(0, y), Math.round(top));
  await page.waitForFunction((y) => Math.abs(window.scrollY - y) <= 1, Math.round(top));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));

  await page.screenshot({
    ...options,
    scale: "css",
    animations: "disabled",
    caret: "hide",
  });
}

async function writeJpegWithinTarget(page, locator, filePath) {
  let quality = 100;
  let best = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await capturePoster(page, locator, {
      path: filePath,
      type: "jpeg",
      quality,
    });

    const bytes = fs.statSync(filePath).size;
    best = { quality, bytes };

    if (isCompliant(bytes)) {
      return best;
    }

    if (bytes > MAX_BYTES && quality > 46) {
      quality -= 6;
      continue;
    }

    if (bytes < MIN_BYTES && quality < 100) {
      quality = Math.min(100, quality + 4);
      continue;
    }

    return best;
  }

  return best;
}

async function setGrainOpacity(locator, opacity) {
  await locator.evaluate((element, value) => {
    element.style.setProperty("--export-grain-opacity", String(value));
  }, opacity);
}

async function chooseGrainOpacity(page, locator, index) {
  const tmpPng = path.join(OUT_DIR, `.tmp-poster-${index + 1}.png`);
  const tmpJpg = path.join(OUT_DIR, `.tmp-poster-${index + 1}.jpg`);
  let best = { opacity: 0, pngBytes: 0, jpgBytes: 0, score: Number.POSITIVE_INFINITY };

  for (const opacity of GRAIN_OPACITIES) {
    await setGrainOpacity(locator, opacity);

    await capturePoster(page, locator, {
      path: tmpPng,
      type: "png",
    });

    await capturePoster(page, locator, {
      path: tmpJpg,
      type: "jpeg",
      quality: 100,
    });

    const pngBytes = fs.statSync(tmpPng).size;
    const jpgBytes = fs.statSync(tmpJpg).size;
    const pngOk = isCompliant(pngBytes);
    const jpgOk = jpgBytes >= MIN_BYTES;
    const score =
      Math.abs(Math.max(MIN_BYTES - pngBytes, 0)) +
      Math.abs(Math.max(MIN_BYTES - jpgBytes, 0)) +
      Math.abs(Math.max(pngBytes - MAX_BYTES, 0)) * 2 +
      Math.abs(Math.max(jpgBytes - MAX_BYTES, 0)) * 2;

    if (score < best.score) {
      best = { opacity, pngBytes, jpgBytes, score };
    }

    if (pngOk && jpgOk && jpgBytes <= MAX_BYTES) {
      break;
    }

    if (pngBytes > MAX_BYTES && jpgBytes < MIN_BYTES) {
      break;
    }
  }

  for (const tmp of [tmpPng, tmpJpg]) {
    if (fs.existsSync(tmp)) {
      fs.unlinkSync(tmp);
    }
  }

  await setGrainOpacity(locator, best.opacity);
  return best;
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(`Missing source file: ${SOURCE}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const executablePath = findChromeExecutable();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
  });

  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });

  await page.goto(pathToFileURL(SOURCE).href, { waitUntil: "networkidle" });
  await page.addStyleTag({
    content: `
      .export-toolbar,
      .poster-caption {
        display: none !important;
      }

      html,
      body {
        margin: 0 !important;
        background: #060A14 !important;
      }

      .gallery {
        gap: 0 !important;
        padding: 0 !important;
      }

      .poster-shell {
        margin: 0 !important;
      }

      .export-grain {
        position: absolute;
        inset: 0;
        z-index: 18;
        pointer-events: none;
        opacity: var(--export-grain-opacity, 0);
        mix-blend-mode: soft-light;
        background-image: url("data:image/svg+xml,${GRAIN_SVG}");
        background-size: 220px 220px;
      }
    `,
  });

  await page.$$eval(".export-poster", (posters) => {
    posters.forEach((poster) => {
      if (!poster.querySelector(".export-grain")) {
        const grain = document.createElement("div");
        grain.className = "export-grain";
        poster.appendChild(grain);
      }
    });
  });

  const posters = page.locator(".export-poster");
  const count = await posters.count();

  if (count !== 5) {
    throw new Error(`Expected 5 .export-poster elements, found ${count}.`);
  }

  const report = [];

  for (let index = 0; index < count; index += 1) {
    const poster = posters.nth(index);

    const box = await poster.boundingBox();
    if (!box || Math.round(box.width) !== WIDTH || Math.round(box.height) !== HEIGHT) {
      throw new Error(
        `Poster ${index + 1} has invalid size: ${box ? `${box.width}x${box.height}` : "unknown"}.`
      );
    }

    const num = String(index + 1).padStart(2, "0");
    const pngName = `goldenpin-submit-${num}.png`;
    const jpgName = `goldenpin-submit-${num}.jpg`;
    const pngPath = path.join(OUT_DIR, pngName);
    const jpgPath = path.join(OUT_DIR, jpgName);

    const grain = await chooseGrainOpacity(page, poster, index);
    const pngGrainOpacity = index === 0 ? 0.032 : grain.opacity;
    const jpgGrainOpacity = index === 0 ? 0.064 : grain.opacity;

    await setGrainOpacity(poster, pngGrainOpacity);
    await capturePoster(page, poster, {
      path: pngPath,
      type: "png",
    });

    await setGrainOpacity(poster, jpgGrainOpacity);
    const jpgResult = await writeJpegWithinTarget(page, poster, jpgPath);

    for (const [name, filePath, quality] of [
      [pngName, pngPath, null],
      [jpgName, jpgPath, jpgResult.quality],
    ]) {
      const bytes = fs.statSync(filePath).size;
      const size = getImageSize(filePath);
      report.push({
        file: name,
        dimensions: `${size.width}x${size.height}`,
        size: formatMb(bytes),
        compliant: isCompliant(bytes) ? "YES" : "NO",
        quality: quality ? String(quality) : "-",
        grain: (name.endsWith(".png") ? pngGrainOpacity : jpgGrainOpacity).toFixed(3),
      });
    }
  }

  await browser.close();

  console.log("\nGolden Pin export complete:");
  console.table(report);
  console.log(`Output folder: ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
