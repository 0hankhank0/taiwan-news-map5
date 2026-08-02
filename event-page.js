const fs = require("fs");
const path = require("path");
const { getOfficialEvents } = require("./event-store");
const { normalizeEventsForFrontend } = require("./event-normalizer");
const { NEWS_CATEGORIES, getCategoryLabel } = require("./shared/event-categories");

const indexHtml = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const CATEGORY_DESCRIPTIONS = Object.freeze({
  traffic: "查看台灣近期交通事故、道路封閉與交通事件發生位置。",
  disaster: "查看台灣近期災害天氣與防災事件發生位置。",
  crime: "查看台灣近期社會治安與犯罪事件發生位置。",
  accident: "查看台灣近期意外事故發生位置。",
  politics: "查看台灣近期政治公共事件發生位置。",
  livelihood: "查看台灣近期民生生活事件發生位置。",
  medical: "查看台灣近期醫療健康事件發生位置。",
  education: "查看台灣近期教育校園事件發生位置。",
  economy: "查看台灣近期產業經濟事件發生位置。",
  culture: "查看台灣近期文化娛樂事件發生位置。",
  international: "查看台灣近期國際事件發生位置。",
  other: "查看台灣近期新聞事件發生位置。"
});

function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function plainText(value, max = 220) { return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
function originFor(req) { return `${req.headers["x-forwarded-proto"] || "http"}://${req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000"}`; }
function json(value) { return JSON.stringify(value).replace(/</g, "\\u003c"); }

function metadataHtml({ title, description, canonical, category, event }) {
  const image = `${new URL("/og-image.jpg", canonical).href}`;
  const jsonLd = event ? {
    "@context": "https://schema.org", "@type": "NewsArticle", headline: title, description,
    datePublished: event.publishedAt || event.createdAt, dateModified: event.updatedAt || event.publishedAt || event.createdAt,
    mainEntityOfPage: canonical, articleSection: category,
    spatialCoverage: event.city || event.address ? { "@type": "Place", name: [event.city, event.district, event.address].filter(Boolean).join(" ") } : undefined,
    publisher: { "@type": "Organization", name: "島嶼脈搏" }
  } : null;
  return `<title>${escapeHtml(title)}｜島嶼脈搏</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:image" content="${escapeHtml(image)}"><meta property="og:site_name" content="島嶼脈搏"><meta property="og:locale" content="zh_TW"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(image)}">${jsonLd ? `<script type="application/ld+json">${json(jsonLd)}</script>` : ""}`;
}

function renderPage(meta) { return indexHtml.replace(/<title>[\s\S]*?<\/title>/i, metadataHtml(meta)); }

async function handler(req, res) {
  const origin = originFor(req);
  const eventId = String(req.params?.eventId || req.query?.eventId || "").trim();
  const categoryKey = String(req.params?.categoryKey || req.query?.categoryKey || "").trim().toLowerCase();
  try {
    if (eventId) {
    const events = normalizeEventsForFrontend(await getOfficialEvents());
    const event = events.find((item) => String(item.id) === eventId);
    if (!event) return res.status(404).type("html").send(renderPage({ title: "找不到此事件", description: "此事件可能已下架或合併。", canonical: `${origin}/event/${encodeURIComponent(eventId)}`, category: "其他" }));
    const canonical = `${origin}/event/${encodeURIComponent(event.id)}`;
    return res.type("html").send(renderPage({ title: plainText(event.title, 120), description: plainText(event.summary || event.content || event.title), canonical, category: getCategoryLabel(event.category, event), event }));
    }
    if (categoryKey && NEWS_CATEGORIES[categoryKey]) {
    const label = NEWS_CATEGORIES[categoryKey];
    return res.type("html").send(renderPage({ title: `台灣${label}新聞地圖`, description: CATEGORY_DESCRIPTIONS[categoryKey], canonical: `${origin}/category/${encodeURIComponent(categoryKey)}`, category: label }));
    }
    return res.status(404).type("html").send(renderPage({ title: "找不到頁面", description: "請返回台灣新聞事件地圖。", canonical: `${origin}/` }));
  } catch (error) {
    console.error("[event-page] event lookup failed:", error.message);
    return res.status(503).type("html").send(renderPage({ title: "事件資料暫時無法載入", description: "請稍後再試或返回新聞地圖。", canonical: eventId ? `${origin}/event/${encodeURIComponent(eventId)}` : `${origin}/` }));
  }
}

module.exports = handler;
module.exports.CATEGORY_DESCRIPTIONS = CATEGORY_DESCRIPTIONS;
