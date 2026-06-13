const TAIWAN_CITY_COORDS = {
  "台北市": { lat: 25.033, lng: 121.5654 },
  "臺北市": { lat: 25.033, lng: 121.5654 },
  "新北市": { lat: 25.0169, lng: 121.4628 },
  "基隆市": { lat: 25.1276, lng: 121.7392 },
  "桃園市": { lat: 24.9937, lng: 121.3009 },
  "新竹市": { lat: 24.8138, lng: 120.9675 },
  "新竹縣": { lat: 24.8387, lng: 121.0177 },
  "苗栗縣": { lat: 24.5602, lng: 120.8214 },
  "台中市": { lat: 24.1477, lng: 120.6736 },
  "臺中市": { lat: 24.1477, lng: 120.6736 },
  "彰化縣": { lat: 24.0817, lng: 120.5384 },
  "南投縣": { lat: 23.9609, lng: 120.9719 },
  "雲林縣": { lat: 23.7092, lng: 120.4313 },
  "嘉義市": { lat: 23.4801, lng: 120.4491 },
  "嘉義縣": { lat: 23.452, lng: 120.255 },
  "台南市": { lat: 22.9997, lng: 120.227 },
  "臺南市": { lat: 22.9997, lng: 120.227 },
  "高雄市": { lat: 22.6273, lng: 120.3014 },
  "屏東縣": { lat: 22.5519, lng: 120.5488 },
  "宜蘭縣": { lat: 24.7021, lng: 121.7378 },
  "花蓮縣": { lat: 23.9872, lng: 121.6015 },
  "台東縣": { lat: 22.7583, lng: 121.1444 },
  "臺東縣": { lat: 22.7583, lng: 121.1444 },
  "澎湖縣": { lat: 23.5712, lng: 119.5793 },
  "金門縣": { lat: 24.4321, lng: 118.3171 },
  "連江縣": { lat: 26.1602, lng: 119.9517 },
  Taipei: { city: "台北市", lat: 25.033, lng: 121.5654 },
  "New Taipei": { city: "新北市", lat: 25.0169, lng: 121.4628 },
  Keelung: { city: "基隆市", lat: 25.1276, lng: 121.7392 },
  Taoyuan: { city: "桃園市", lat: 24.9937, lng: 121.3009 },
  Hsinchu: { city: "新竹市", lat: 24.8138, lng: 120.9675 },
  Miaoli: { city: "苗栗縣", lat: 24.5602, lng: 120.8214 },
  Taichung: { city: "台中市", lat: 24.1477, lng: 120.6736 },
  Changhua: { city: "彰化縣", lat: 24.0817, lng: 120.5384 },
  Nantou: { city: "南投縣", lat: 23.9609, lng: 120.9719 },
  Yunlin: { city: "雲林縣", lat: 23.7092, lng: 120.4313 },
  Chiayi: { city: "嘉義市", lat: 23.4801, lng: 120.4491 },
  Tainan: { city: "台南市", lat: 22.9997, lng: 120.227 },
  Kaohsiung: { city: "高雄市", lat: 22.6273, lng: 120.3014 },
  Pingtung: { city: "屏東縣", lat: 22.5519, lng: 120.5488 },
  Yilan: { city: "宜蘭縣", lat: 24.7021, lng: 121.7378 },
  Hualien: { city: "花蓮縣", lat: 23.9872, lng: 121.6015 },
  Taitung: { city: "台東縣", lat: 22.7583, lng: 121.1444 },
  Penghu: { city: "澎湖縣", lat: 23.5712, lng: 119.5793 },
  Kinmen: { city: "金門縣", lat: 24.4321, lng: 118.3171 },
  Lienchiang: { city: "連江縣", lat: 26.1602, lng: 119.9517 },
  Taiwan: { city: "台灣", lat: 23.8, lng: 120.9 },
  "台灣": { lat: 23.8, lng: 120.9 },
  "國道": { lat: 23.8, lng: 120.9 },
  "省道": { lat: 23.8, lng: 120.9 },
  Freeway: { city: "國道", lat: 23.8, lng: 120.9 },
  Highway: { city: "省道", lat: 23.8, lng: 120.9 },
};

const CATEGORY_GROUPS = {
  traffic: "traffic",
  construction: "traffic",
  roadwork: "traffic",
  accident: "accident",
  incident: "accident",
  safety: "accident",
  publicsafety: "accident",
  "public-safety": "accident",
  criminal: "accident",
  crime: "accident",
  police: "accident",
  medical: "accident",
  fire: "accident",
  disaster: "disaster",
  earthquake: "disaster",
  typhoon: "disaster",
  weather: "disaster",
  climate: "disaster",
  activity: "activity",
  event: "activity",
  market: "activity",
  exhibition: "activity",
  sports: "activity",
  news: "other",
  other: "other",
};

function parseStoredEvents(value) {
  if (Array.isArray(value)) return value;
  if (value?.events && Array.isArray(value.events)) return value.events;
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);
    if (parsed?.events && Array.isArray(parsed.events)) return parsed.events;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeText(value, fallback = "") {
  return String(value ?? fallback).replace(/\s+/g, " ").trim();
}

function normalizeCategory(value) {
  const category = normalizeText(value, "other").toLowerCase().replace(/_/g, "-");
  return CATEGORY_GROUPS[category] ? category : "other";
}

function normalizeCity(value) {
  const raw = normalizeText(value, "台灣");
  const match = TAIWAN_CITY_COORDS[raw];
  if (match?.city) return match.city;
  return raw;
}

function inferCityFromText(text) {
  const source = normalizeText(text);
  return Object.keys(TAIWAN_CITY_COORDS).find((city) => source.includes(city)) || "";
}

function resolveCoordinates(event, city) {
  const lat = Number(event.lat ?? event.latitude ?? event.PositionLat ?? event.positionLat);
  const lng = Number(event.lng ?? event.lon ?? event.longitude ?? event.PositionLon ?? event.positionLon);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };

  const cityKey = city || inferCityFromText(`${event.title || ""} ${event.content || ""} ${event.description || ""}`);
  const fallback = TAIWAN_CITY_COORDS[cityKey];
  if (fallback) return { lat: fallback.lat, lng: fallback.lng };
  return { lat: NaN, lng: NaN };
}

function isValidTaiwanCoord(lat, lng) {
  return lat >= 21 && lat <= 27 && lng >= 118 && lng <= 123;
}

function inferSeverity(event, category) {
  const raw = event.severity ?? event.impactSeverity ?? event.level;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.min(5, Math.max(1, Math.round(raw)));
  if (typeof raw === "string") {
    const value = raw.toLowerCase();
    if (value === "high" || value === "severe") return 5;
    if (value === "medium" || value === "moderate") return 3;
    if (value === "low" || value === "minor") return 1;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.min(5, Math.max(1, Math.round(parsed)));
  }

  if (["disaster", "earthquake", "typhoon", "fire"].includes(category)) return 4;
  if (["traffic", "construction", "accident", "medical", "criminal", "police"].includes(category)) return 3;
  return 1;
}

function makeStableId(event, index) {
  const existing = normalizeText(event.id || event.eventId || event.eventFingerprint);
  if (existing) return existing;

  const key = [
    event.source || "event",
    event.city || "",
    event.category || "",
    event.title || event.text || index,
  ].join(":");

  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return `event_${Math.abs(hash).toString(36)}`;
}

function normalizeEvent(event, index = 0) {
  if (!event || typeof event !== "object") return null;
  if (isDemoEvent(event)) return null;

  const title = normalizeText(event.title || event.text || event.name || event.description);
  const content = normalizeText(event.content || event.summary || event.description || event.text || title);
  if (!title && !content) return null;

  const rawCategory = normalizeCategory(event.category || event.type);
  const groupCategory = CATEGORY_GROUPS[rawCategory] || "other";
  const city = normalizeCity(event.city || event.region || event.location || inferCityFromText(`${title} ${content}`));
  const { lat, lng } = resolveCoordinates(event, city);
  if (!isValidTaiwanCoord(lat, lng)) return null;

  const sourceUrl = normalizeText(event.sourceUrl || event.url || event.link);
  const publishedAt = event.publishedAt || event.updatedAt || event.time || event.createdAt || new Date().toISOString();
  const createdAt = Number(event.createdAt) || Date.parse(publishedAt) || Date.now();

  return {
    ...event,
    id: makeStableId(event, index),
    title: title || content,
    content: content || title,
    summary: normalizeText(event.summary || content || title),
    category: rawCategory,
    rawCategory,
    groupCategory,
    city,
    lat,
    lng,
    severity: inferSeverity(event, rawCategory),
    source: normalizeText(event.source || event.sourceName || "news"),
    sourceName: normalizeText(event.sourceName || event.source || "news"),
    sourceUrl,
    url: sourceUrl,
    publishedAt: new Date(publishedAt).toString() === "Invalid Date" ? new Date(createdAt).toISOString() : new Date(publishedAt).toISOString(),
    createdAt,
    interactionCount: Number(event.interactionCount || event.reactionCount || event.count || 0),
    hasCasualty: Boolean(event.hasCasualty),
  };
}

function isDemoEvent(event) {
  const id = normalizeText(event.id || event.eventId).toLowerCase();
  const source = normalizeText(`${event.source || ""} ${event.sourceName || ""}`).toLowerCase();
  const url = normalizeText(event.sourceUrl || event.url || event.link).toLowerCase();

  return Boolean(event.isDemo)
    || id.startsWith("demo-")
    || id.startsWith("mock-")
    || source.includes("concept demo")
    || source.includes("demo")
    || url.includes("example.com");
}

function normalizeEventsForFrontend(value) {
  const seen = new Set();
  return parseStoredEvents(value)
    .map(normalizeEvent)
    .filter(Boolean)
    .filter((event) => {
      const key = normalizeText(event.eventFingerprint || `${event.city}:${event.groupCategory}:${event.title}`).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aTime = Date.parse(a.publishedAt) || a.createdAt || 0;
      const bTime = Date.parse(b.publishedAt) || b.createdAt || 0;
      return bTime - aTime;
    });
}

module.exports = {
  normalizeEvent,
  normalizeEventsForFrontend,
  parseStoredEvents,
};
