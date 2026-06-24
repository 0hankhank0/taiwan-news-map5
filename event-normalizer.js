const locationResolver = require("./location-resolver");
const { classifyEventVisibility, isLowRealtimeEvent } = require("./event-content-filter");

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

const TAIWAN_CITY_BOUNDS = {
  "台北市": { minLat: 24.94, maxLat: 25.22, minLng: 121.43, maxLng: 121.68 },
  "臺北市": { minLat: 24.94, maxLat: 25.22, minLng: 121.43, maxLng: 121.68 },
  "新北市": { minLat: 24.65, maxLat: 25.32, minLng: 121.20, maxLng: 122.05 },
  "基隆市": { minLat: 25.05, maxLat: 25.18, minLng: 121.66, maxLng: 121.82 },
  "桃園市": { minLat: 24.55, maxLat: 25.14, minLng: 120.95, maxLng: 121.50 },
  "新竹市": { minLat: 24.72, maxLat: 24.88, minLng: 120.88, maxLng: 121.05 },
  "新竹縣": { minLat: 24.35, maxLat: 24.95, minLng: 120.90, maxLng: 121.35 },
  "苗栗縣": { minLat: 24.25, maxLat: 24.75, minLng: 120.58, maxLng: 121.05 },
  "台中市": { minLat: 23.95, maxLat: 24.45, minLng: 120.45, maxLng: 121.45 },
  "臺中市": { minLat: 23.95, maxLat: 24.45, minLng: 120.45, maxLng: 121.45 },
  "彰化縣": { minLat: 23.78, maxLat: 24.18, minLng: 120.25, maxLng: 120.65 },
  "南投縣": { minLat: 23.45, maxLat: 24.25, minLng: 120.55, maxLng: 121.35 },
  "雲林縣": { minLat: 23.45, maxLat: 23.85, minLng: 120.05, maxLng: 120.75 },
  "嘉義市": { minLat: 23.42, maxLat: 23.55, minLng: 120.38, maxLng: 120.52 },
  "嘉義縣": { minLat: 23.20, maxLat: 23.65, minLng: 120.00, maxLng: 120.95 },
  "台南市": { minLat: 22.85, maxLat: 23.45, minLng: 120.00, maxLng: 120.65 },
  "臺南市": { minLat: 22.85, maxLat: 23.45, minLng: 120.00, maxLng: 120.65 },
  "高雄市": { minLat: 22.45, maxLat: 23.50, minLng: 120.15, maxLng: 121.10 },
  "屏東縣": { minLat: 21.88, maxLat: 22.92, minLng: 120.38, maxLng: 121.05 },
  "宜蘭縣": { minLat: 24.30, maxLat: 25.05, minLng: 121.45, maxLng: 122.10 },
  "花蓮縣": { minLat: 23.00, maxLat: 24.45, minLng: 120.95, maxLng: 121.85 },
  "台東縣": { minLat: 21.90, maxLat: 23.45, minLng: 120.65, maxLng: 121.60 },
  "臺東縣": { minLat: 21.90, maxLat: 23.45, minLng: 120.65, maxLng: 121.60 },
  "澎湖縣": { minLat: 23.15, maxLat: 23.85, minLng: 119.25, maxLng: 119.85 },
  "金門縣": { minLat: 24.30, maxLat: 24.55, minLng: 118.15, maxLng: 118.55 },
  "連江縣": { minLat: 25.90, maxLat: 26.40, minLng: 119.85, maxLng: 120.05 },
};

const KNOWN_LOCATION_COORDS = [
  { pattern: /大佳河濱公園|台北龍舟|臺北龍舟/, city: "台北市", lat: 25.0732, lng: 121.5365 },
  { pattern: /吉林路.*工地|中山區.*吉林路/, city: "台北市", lat: 25.0584, lng: 121.5302 },
  { pattern: /吳興街\s*600\s*巷|信義區.*吳興街/, city: "台北市", lat: 25.0216, lng: 121.5699 },
  { pattern: /涵煙翠|新店.*土石|新店.*邊坡/, city: "新北市", lat: 24.9599, lng: 121.5355 },
  { pattern: /核二廠|第二核能發電廠|萬里.*台電/, city: "新北市", lat: 25.2036, lng: 121.6625 },
  { pattern: /慈雲路|慈雲空橋|埔頂三路/, city: "新竹市", lat: 24.7876, lng: 121.0188 },
  { pattern: /中港溪.*龍舟|竹南.*龍舟|龍舟碼頭/, city: "苗栗縣", lat: 24.6837, lng: 120.8717 },
  { pattern: /造橋.*台鐵|台鐵山線.*造橋/, city: "苗栗縣", lat: 24.6407, lng: 120.8670 },
  { pattern: /濁水溪出海口|東方白鸛/, city: "雲林縣", lat: 23.7977, lng: 120.1773 },
  { pattern: /大富東街/, city: "嘉義市", lat: 23.4586, lng: 120.4310 },
  { pattern: /沙港村|湖西.*沙港/, city: "澎湖縣", lat: 23.5964, lng: 119.6351 },
  { pattern: /金門小三通|水頭碼頭|金城鎮.*小三通/, city: "金門縣", lat: 24.4126, lng: 118.2866 },
  { pattern: /安南區/, city: "台南市", lat: 23.0472, lng: 120.1845 },
  { pattern: /國道5號|國5/, city: "國道5號北上", lat: 24.9264, lng: 121.7165 },
  { pattern: /國道1號.*彰化|國1.*彰化/, city: "彰化縣", lat: 24.0703, lng: 120.5382 },
];

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

const CITY_ALIASES = {
  "臺北市": "台北市",
  "臺中市": "台中市",
  "臺南市": "台南市",
  "臺東縣": "台東縣",
};

const DISTRICT_PATTERN = /([\u4e00-\u9fff]{1,4}(?:區|鄉|鎮|市))/g;

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
  return locationResolver.normalizeCity(value);
}

function inferCityFromText(text) {
  return locationResolver.inferCityFromText(text);
}

function extractDistrict(text = "") {
  return locationResolver.extractDistrict(text);
}

function parseTime(value) {
  if (!value) return null;
  const ts = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function inferStatus(event) {
  const now = Date.now();
  const startAt = parseTime(event.startsAt || event.startAt);
  const endAt = parseTime(event.endsAt || event.endAt || event.expiresAt);
  if (endAt && endAt < now) return "expired";
  if (startAt && startAt > now) return "upcoming";
  return "active";
}

function inferImpact(event, category) {
  const text = normalizeText(`${event.title || ""} ${event.content || ""} ${event.text || ""}`);
  if (category === "activity") return "活動期間周邊可能有人潮與交通變化。";
  if (category === "traffic" || category === "construction") return "周邊道路可能壅塞或受管制影響。";
  if (category === "accident") return "現場周邊通行與安全可能受影響。";
  if (category === "disaster" || /火災|淹水|坍方|地震|停電|停水/.test(text)) return "周邊民生、交通或安全可能受影響。";
  if (category === "criminal") return "周邊公共安全需留意。";
  return "此事件可能影響周邊活動與通行。";
}

function inferAdvice(event, category) {
  const text = normalizeText(`${event.title || ""} ${event.content || ""} ${event.text || ""}`);
  if (category === "activity") return "前往前請確認活動頁公告、交通方式與入場時間。";
  if (category === "traffic" || category === "construction" || /封閉|管制|壅塞|塞車/.test(text)) return "行經附近請放慢車速，必要時提前改道。";
  if (category === "accident") return "避開事故現場，依警方或現場人員指揮通行。";
  if (category === "disaster" || /火災|淹水|坍方|土石流|地震/.test(text)) return "避免靠近危險區域，留意官方最新公告。";
  if (category === "criminal") return "避免靠近現場，留意警方與地方政府公告。";
  return "前往附近前先確認最新資訊。";
}

function resolveCoordinates(event, city) {
  const lat = Number(event.lat ?? event.latitude ?? event.PositionLat ?? event.positionLat);
  const lng = Number(event.lng ?? event.lon ?? event.longitude ?? event.PositionLon ?? event.positionLon);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };

  const cityKey = city || inferCityFromText(`${event.title || ""} ${event.content || ""} ${event.description || ""}`);
  const fallback = locationResolver.getCityFallback(cityKey);
  if (fallback) return { lat: fallback.lat, lng: fallback.lng };
  return { lat: NaN, lng: NaN };
}

function isValidTaiwanCoord(lat, lng) {
  return locationResolver.isValidTaiwanCoord(lat, lng);
}

function isCoordInCity(city, lat, lng) {
  return locationResolver.isCoordInCity(city, lat, lng);
}

function resolveKnownLocationCoord(event, city, title, content) {
  return locationResolver.resolveKnownLocationCoord(event, city, title, content);
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

function buildSourceTrace(event) {
  if (Array.isArray(event.sourceTrace) && event.sourceTrace.length > 0) return event.sourceTrace;
  if (Array.isArray(event.sources) && event.sources.length > 0) {
    return event.sources.map((source) => ({
      outlet: normalizeText(source.outlet || source.source || event.sourceName || event.source || "unknown"),
      title: normalizeText(source.title || event.title || ""),
      url: normalizeText(source.url || source.sourceUrl || event.sourceUrl || event.url || ""),
      capturedAt: normalizeText(event.updatedAt || event.publishedAt || event.createdAt || ""),
    }));
  }
  return [{
    outlet: normalizeText(event.sourceName || event.source || "unknown"),
    title: normalizeText(event.title || ""),
    url: normalizeText(event.sourceUrl || event.url || ""),
    capturedAt: normalizeText(event.updatedAt || event.publishedAt || event.createdAt || ""),
  }];
}

function normalizeEvent(event, index = 0) {
  if (!event || typeof event !== "object") return null;
  if (isDemoEvent(event)) return null;

  const title = normalizeText(event.title || event.text || event.name || event.description);
  const content = normalizeText(event.content || event.summary || event.description || event.text || title);
  if (!title && !content) return null;

  const rawCategory = normalizeCategory(event.category || event.type);
  const groupCategory = CATEGORY_GROUPS[rawCategory] || "other";
  const location = locationResolver.resolveLocationSync(event, { title, content });
  const city = location.city;
  let { lat, lng } = location;
  if (!isValidTaiwanCoord(lat, lng)) return null;

  const sourceUrl = normalizeText(event.sourceUrl || event.url || event.link);
  const publishedAt = event.publishedAt || event.updatedAt || event.time || event.createdAt || new Date().toISOString();
  const createdAt = Number(event.createdAt) || Date.parse(publishedAt) || Date.now();
  const district = normalizeText(location.district || event.district || extractDistrict(`${event.address || ""} ${event.location || ""} ${title} ${content}`));

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
    district,
    address: normalizeText(event.address || event.location || ""),
    venue: normalizeText(event.venue || ""),
    lat,
    lng,
    locationPrecision: normalizeText(event.locationPrecision || location.locationPrecision || "unknown"),
    locationSource: normalizeText(event.locationSource || location.locationSource || "unknown"),
    locationQuery: normalizeText(event.locationQuery || location.locationQuery || ""),
    locationConfidence: Number.isFinite(Number(event.locationConfidence ?? location.locationConfidence))
      ? Number(event.locationConfidence ?? location.locationConfidence)
      : 0,
    locationQuality: normalizeText(event.locationQuality || location.locationQuality || "low"),
    locationDisplayMode: normalizeText(event.locationDisplayMode || location.locationDisplayMode || "list_only"),
    locationEvidence: normalizeText(event.locationEvidence || location.locationEvidence || ""),
    locationAmbiguity: Boolean(event.locationAmbiguity),
    locationReason: normalizeText(event.locationReason || ""),
    locationCandidates: Array.isArray(event.locationCandidates) ? event.locationCandidates.slice(0, 8) : undefined,
    severity: inferSeverity(event, rawCategory),
    source: normalizeText(event.source || event.sourceName || "news"),
    sourceName: normalizeText(event.sourceName || event.source || "news"),
    sourceUrl,
    url: sourceUrl,
    publishedAt: new Date(publishedAt).toString() === "Invalid Date" ? new Date(createdAt).toISOString() : new Date(publishedAt).toISOString(),
    updatedAt: new Date(event.updatedAt || createdAt).toString() === "Invalid Date" ? new Date(createdAt).toISOString() : new Date(event.updatedAt || createdAt).toISOString(),
    createdAt,
    startsAt: event.startsAt || event.startAt || null,
    endsAt: event.endsAt || event.endAt || null,
    expiresAt: event.expiresAt || null,
    status: normalizeText(event.status || inferStatus(event)),
    statusSource: normalizeText(event.statusSource || event.sourceName || event.source || "source"),
    verifiedStatus: normalizeText(event.verifiedStatus || "unverified"),
    reviewState: normalizeText(event.reviewState || "unreviewed"),
    lastVerifiedAt: event.lastVerifiedAt || null,
    resolvedAt: event.resolvedAt || null,
    mergedIntoEventId: normalizeText(event.mergedIntoEventId || ""),
    sourceTrace: buildSourceTrace(event),
    adminReview: event.adminReview && typeof event.adminReview === "object" ? event.adminReview : null,
    impact: normalizeText(event.impact || inferImpact(event, rawCategory)),
    advice: normalizeText(event.advice || inferAdvice(event, rawCategory)),
    tags: Array.isArray(event.tags) ? event.tags : [rawCategory, city, district].filter(Boolean),
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

function isInstitutionalNewsEvent(event) {
  const source = normalizeText(`${event.source || ""} ${event.sourceName || ""}`).toLowerCase();
  if (source.includes("kktix") || source.includes("tdx") || source.includes("pbs") || source.includes("ubike")) return false;
  return isLowRealtimeEvent(event);
}

function normalizeEventsForFrontend(value) {
  const seen = new Set();
  return parseStoredEvents(value)
    .map(normalizeEvent)
    .filter(Boolean)
    .map((event) => ({
      ...event,
      visibilityReason: event.visibilityReason || classifyEventVisibility(event).reason,
    }))
    .filter((event) => !event.mergedIntoEventId)
    .filter((event) => !isInstitutionalNewsEvent(event))
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
