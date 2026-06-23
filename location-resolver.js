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
  { pattern: /台大體育館|臺大體育館|台灣大學體育館|臺灣大學體育館/, city: "台北市", lat: 25.0217, lng: 121.5358 },
  { pattern: /台北大巨蛋|臺北大巨蛋/, city: "台北市", lat: 25.0437, lng: 121.5616 },
  { pattern: /壽山動物園/, city: "高雄市", lat: 22.6378, lng: 120.2766 },
  { pattern: /高美濕地/, city: "台中市", lat: 24.3118, lng: 120.5490 },
  { pattern: /新光三越.*台中|台中.*新光三越|臺中.*新光三越/, city: "台中市", lat: 24.1650, lng: 120.6432 },
  { pattern: /西市場|菜奇鴨/, city: "台南市", lat: 22.9954, lng: 120.1970 },
  { pattern: /卓樂部落/, city: "花蓮縣", lat: 23.3480, lng: 121.3100 },
  { pattern: /流霞谷親水烤肉園區|流霞谷/, city: "桃園市", lat: 24.7958, lng: 121.3910 },
  { pattern: /阿塱壹古道/, city: "屏東縣", lat: 22.2529, lng: 120.8854 },
  { pattern: /建國花市/, city: "台北市", lat: 25.0361, lng: 121.5372 },
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

const DISTRICT_CENTERS = {
  "台北市大安區": { lat: 25.0262, lng: 121.5435 },
  "台北市大同區": { lat: 25.0634, lng: 121.5130 },
  "台北市信義區": { lat: 25.0330, lng: 121.5654 },
  "台中市西屯區": { lat: 24.1810, lng: 120.6278 },
  "台中市清水區": { lat: 24.2680, lng: 120.5759 },
  "台中市霧峰區": { lat: 24.0615, lng: 120.7008 },
  "台中市北屯區": { lat: 24.1820, lng: 120.6869 },
  "台南市中西區": { lat: 22.9948, lng: 120.1978 },
  "高雄市鼓山區": { lat: 22.6502, lng: 120.2812 },
  "桃園市復興區": { lat: 24.8164, lng: 121.3526 },
  "桃園市龜山區": { lat: 24.9925, lng: 121.3370 },
  "新北市三芝區": { lat: 25.2580, lng: 121.5010 },
  "新竹縣竹北市": { lat: 24.8382, lng: 121.0070 },
  "花蓮縣卓溪鄉": { lat: 23.3466, lng: 121.3030 },
  "屏東縣牡丹鄉": { lat: 22.1268, lng: 120.8174 },
  "台東縣達仁鄉": { lat: 22.2917, lng: 120.8846 },
  "澎湖縣白沙鄉": { lat: 23.6531, lng: 119.5869 },
};

const CITY_ALIASES = {
  "臺北市": "台北市",
  "臺中市": "台中市",
  "臺南市": "台南市",
  "臺東縣": "台東縣",
};

function normalizeText(value, fallback = "") {
  return String(value ?? fallback).replace(/\s+/g, " ").trim();
}

function normalizeCity(value) {
  const raw = normalizeText(value, "台灣").replace(/臺/g, "台");
  const direct = TAIWAN_CITY_COORDS[raw];
  if (direct?.city) return direct.city;
  const city = Object.keys(TAIWAN_CITY_COORDS)
    .filter((cityName) => cityName.length >= 3)
    .find((cityName) => raw.includes(cityName.replace(/臺/g, "台")));
  return CITY_ALIASES[city] || city || raw;
}

function inferCityFromText(text) {
  const source = normalizeText(text).replace(/臺/g, "台");
  const city = Object.keys(TAIWAN_CITY_COORDS)
    .filter((cityName) => cityName.length >= 3)
    .find((cityName) => source.includes(cityName.replace(/臺/g, "台")));
  return CITY_ALIASES[city] || city || "";
}

function extractDistrict(text = "") {
  const source = normalizeText(text).replace(/臺/g, "台");
  const matches = [...source.matchAll(/([\u4e00-\u9fff]{1,4}(?:區|鄉|鎮|市))/g)].map((match) => match[1]);
  return matches.find((name) => /(?:區|鄉|鎮)$/.test(name))
    || matches.find((name) => /市$/.test(name) && !TAIWAN_CITY_COORDS[name])
    || "";
}

function isValidTaiwanCoord(lat, lng) {
  return lat >= 21 && lat <= 27 && lng >= 118 && lng <= 123;
}

function isCoordInCity(city, lat, lng) {
  const bounds = TAIWAN_CITY_BOUNDS[normalizeCity(city)];
  if (!bounds) return true;
  return lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng;
}

function isCityCenterCoord(city, lat, lng) {
  const fallback = TAIWAN_CITY_COORDS[normalizeCity(city)];
  return Boolean(fallback)
    && Math.abs(Number(lat) - fallback.lat) < 0.0002
    && Math.abs(Number(lng) - fallback.lng) < 0.0002;
}

function getCityFallback(city) {
  const fallback = TAIWAN_CITY_COORDS[normalizeCity(city)];
  if (!fallback) return null;
  return { lat: fallback.lat, lng: fallback.lng };
}

function getDistrictCenter(city, district) {
  const key = `${normalizeCity(city)}${normalizeText(district).replace(/臺/g, "台")}`;
  return DISTRICT_CENTERS[key] || null;
}

function getLocationText(event, title = "", content = "") {
  return normalizeText([
    event.address,
    event.location,
    event.venue,
    event.district,
    title,
    content,
  ].filter(Boolean).join(" ")).replace(/臺/g, "台");
}

function resolveKnownLocationCoord(event, city, title = "", content = "") {
  const text = getLocationText(event, title, content);
  const normalizedCity = normalizeCity(city);
  const match = KNOWN_LOCATION_COORDS.find((entry) => {
    const entryCity = normalizeCity(entry.city);
    return entry.pattern.test(text) && (!TAIWAN_CITY_BOUNDS[normalizedCity] || entryCity === normalizedCity || entry.city === city);
  });
  if (!match) return null;
  return {
    lat: match.lat,
    lng: match.lng,
    locationPrecision: "exact",
    locationSource: "known-location",
    locationQuery: text.slice(0, 120),
  };
}

function buildLocationQuery(event, city, title = "", content = "") {
  const parts = [
    event.venue,
    event.address || event.location,
    event.district,
    city,
    title,
    content,
  ].map((part) => normalizeText(part)).filter(Boolean);
  const query = parts.find((part) => /[縣市].{1,24}(區|鄉|鎮|路|街|巷|館|園|場|廟|部落|市場|濕地|古道|大學|百貨|中心)/.test(part))
    || parts.find((part) => part.length >= 3 && !/^(台灣|國道|省道)$/.test(part))
    || "";
  return normalizeText(`${city || ""} ${query}`.replace(/臺/g, "台")).slice(0, 120);
}

function getExistingCoord(event) {
  const lat = Number(event.lat ?? event.latitude ?? event.PositionLat ?? event.positionLat);
  const lng = Number(event.lng ?? event.lon ?? event.longitude ?? event.PositionLon ?? event.positionLon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function isOfficialCoordinate(event) {
  const source = normalizeText(`${event.source || ""} ${event.sourceName || ""}`).toLowerCase();
  return source.includes("tdx") || source.includes("pbs") || source.includes("ubike");
}

function clampConfidence(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function normalizePrecision(value) {
  const precision = normalizeText(value).toLowerCase();
  return ["exact", "district", "city", "unknown"].includes(precision) ? precision : "unknown";
}

function inferLocationQuality(confidence) {
  const score = clampConfidence(confidence);
  if (score >= 0.8) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

function inferLocationDisplayMode(locationQuality, locationPrecision) {
  if (locationQuality === "high") return "point";
  if (locationQuality === "medium" && locationPrecision !== "unknown") return "estimated";
  return "list_only";
}

function defaultLocationConfidence(source, precision) {
  const normalizedSource = normalizeText(source).toLowerCase();
  const normalizedPrecision = normalizePrecision(precision);

  if (normalizedSource === "manual") return 1;
  if (normalizedSource === "official") return 0.98;
  if (normalizedSource === "known-location") return 0.94;
  if (normalizedSource.includes("mapbox")) return normalizedPrecision === "exact" ? 0.82 : 0.62;
  if (normalizedSource.includes("geoapify")) return normalizedPrecision === "exact" ? 0.8 : 0.6;
  if (normalizedSource === "provided") return normalizedPrecision === "exact" ? 0.74 : 0.55;
  if (normalizedSource === "ai-context") return normalizedPrecision === "exact" ? 0.68 : 0.48;
  if (normalizedPrecision === "district") return 0.58;
  if (normalizedPrecision === "city") return 0.34;
  return 0.1;
}

function withLocationQuality(location, event = {}) {
  const precision = normalizePrecision(location.locationPrecision || event.locationPrecision);
  const source = normalizeText(location.locationSource || event.locationSource || "unknown");
  const explicitConfidence = Number(location.locationConfidence ?? event.locationConfidence);
  const confidence = clampConfidence(
    explicitConfidence,
    defaultLocationConfidence(source, precision)
  );
  const locationQuality = normalizeText(location.locationQuality || event.locationQuality)
    || inferLocationQuality(confidence);
  const displayMode = normalizeText(location.locationDisplayMode || event.locationDisplayMode)
    || inferLocationDisplayMode(locationQuality, precision);

  return {
    ...location,
    locationPrecision: precision,
    locationSource: source,
    locationConfidence: confidence,
    locationQuality,
    locationDisplayMode: displayMode,
    locationEvidence: normalizeText(location.locationEvidence || event.locationEvidence || event.locationReason || ""),
  };
}

function getCityBounds(city) {
  return TAIWAN_CITY_BOUNDS[normalizeCity(city)] || null;
}

function normalizeForLocationMatch(value = "") {
  return normalizeText(value)
    .replace(/臺/g, "台")
    .replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "")
    .toLowerCase();
}

function extractLocationTokens(value = "") {
  const source = normalizeText(value).replace(/臺/g, "台");
  const matches = [
    ...source.matchAll(/([\u4e00-\u9fffA-Za-z0-9]{2,24}(?:縣|市|區|鄉|鎮|村|里|路|街|巷|段|橋|站|館|園|場|廟|宮|大學|高中|國中|國小|市場|百貨|中心|醫院|公園|濕地|古道|部落))/g),
  ].map((match) => match[1]);
  return Array.from(new Set(matches.map(normalizeForLocationMatch).filter((token) => token.length >= 2))).slice(0, 12);
}

function inferCandidatePrecision(candidate = {}) {
  const raw = normalizeText(candidate.precision || candidate.featureType || candidate.resultType).toLowerCase();
  if (/address|poi|amenity|building|venue|street|road|intersection/.test(raw)) return "exact";
  if (/district|locality|neighborhood|suburb|township|village/.test(raw)) return "district";
  if (/place|city|region|county|state/.test(raw)) return "city";
  return normalizePrecision(candidate.locationPrecision || "unknown");
}

function scoreGeocodingCandidate(event = {}, baseLocation = {}, candidate = {}) {
  const lat = Number(candidate.lat);
  const lng = Number(candidate.lng);
  const city = normalizeCity(baseLocation.city || event.city || "");
  const query = normalizeText(candidate.query || baseLocation.locationQuery || event.locationQuery || buildLocationQuery(event, city, event.title, event.content));
  const candidateText = normalizeText([
    candidate.placeName,
    candidate.formatted,
    candidate.address,
    candidate.name,
    candidate.city,
    candidate.district,
    candidate.context,
  ].filter(Boolean).join(" "));
  const precision = inferCandidatePrecision(candidate);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isValidTaiwanCoord(lat, lng)) {
    return { ...candidate, accepted: false, rejectedReason: "invalid-coordinate", score: 0, locationPrecision: precision };
  }
  if (city && !isCoordInCity(city, lat, lng)) {
    return { ...candidate, accepted: false, rejectedReason: "outside-city", score: 0, locationPrecision: precision };
  }

  const queryTokens = extractLocationTokens(query);
  const evidenceTokens = extractLocationTokens(event.locationEvidence || event.locationText || event.address || event.location || "");
  const tokens = Array.from(new Set([...queryTokens, ...evidenceTokens]));
  const normalizedCandidateText = normalizeForLocationMatch(candidateText);
  const matchedTokens = tokens.filter((token) => normalizedCandidateText.includes(token));
  const cityMatched = city ? normalizedCandidateText.includes(normalizeForLocationMatch(city)) : true;

  let score = 0.18;
  score += clampConfidence(candidate.confidence ?? candidate.relevance ?? candidate.rankConfidence, 0.5) * 0.35;
  if (precision === "exact") score += 0.18;
  else if (precision === "district") score += 0.08;
  if (cityMatched) score += 0.12;
  if (matchedTokens.length > 0) score += Math.min(0.22, matchedTokens.length * 0.08);
  if (candidate.source === "mapbox") score += 0.02;
  if (candidate.source === "geoapify") score += 0.02;
  if (event.locationConfidence !== undefined) score += clampConfidence(event.locationConfidence, 0) * 0.08;
  if (!matchedTokens.length && precision !== "city") score -= 0.12;

  score = clampConfidence(score);
  const confidenceCap = precision === "city" ? 0.52 : precision === "district" ? 0.74 : 0.95;
  const confidence = Math.min(score, confidenceCap);
  const quality = inferLocationQuality(confidence);
  return {
    ...candidate,
    lat,
    lng,
    accepted: confidence >= 0.55,
    rejectedReason: confidence >= 0.55 ? "" : "low-confidence",
    score,
    matchedTokens,
    locationPrecision: precision,
    locationConfidence: confidence,
    locationQuality: quality,
    locationDisplayMode: inferLocationDisplayMode(quality, precision),
  };
}

function rankGeocodingCandidates(event = {}, baseLocation = {}, candidates = []) {
  return candidates
    .map((candidate) => scoreGeocodingCandidate(event, baseLocation, candidate))
    .sort((a, b) => {
      if (Boolean(b.accepted) !== Boolean(a.accepted)) return Number(b.accepted) - Number(a.accepted);
      return (b.locationConfidence || 0) - (a.locationConfidence || 0);
    });
}

function resolveLocationSync(event, options = {}) {
  const title = normalizeText(options.title ?? event.title ?? event.text ?? event.name ?? event.description);
  const content = normalizeText(options.content ?? event.content ?? event.summary ?? event.description ?? event.text ?? title);
  const city = normalizeCity(event.city || event.region || event.location || inferCityFromText(`${title} ${content}`));
  const district = normalizeText(event.district || extractDistrict(`${event.address || ""} ${event.location || ""} ${title} ${content}`));
  const existing = getExistingCoord(event);
  const locationQuery = normalizeText(event.locationQuery || buildLocationQuery(event, city, title, content));

  if (existing && isOfficialCoordinate(event) && isValidTaiwanCoord(existing.lat, existing.lng)) {
    return withLocationQuality({ ...existing, city, district, locationPrecision: "exact", locationSource: event.locationSource || "official", locationQuery }, event);
  }

  const known = resolveKnownLocationCoord(event, city, title, content);
  if (known) return withLocationQuality({ ...known, city, district }, event);

  if (existing && isValidTaiwanCoord(existing.lat, existing.lng)) {
    const outsideCity = !isCoordInCity(city, existing.lat, existing.lng);
    const cityCenter = isCityCenterCoord(city, existing.lat, existing.lng);
    if (!outsideCity && !cityCenter) {
      return withLocationQuality({
        ...existing,
        city,
        district,
        locationPrecision: event.locationPrecision || "exact",
        locationSource: event.locationSource || "provided",
        locationQuery,
      }, event);
    }
    if (!outsideCity && cityCenter) {
      return withLocationQuality({
        ...existing,
        city,
        district,
        locationPrecision: event.locationPrecision || "city",
        locationSource: event.locationSource || "city-fallback",
        locationQuery,
      }, event);
    }
  }

  const districtCenter = getDistrictCenter(city, district);
  if (districtCenter) {
    return withLocationQuality({ ...districtCenter, city, district, locationPrecision: "district", locationSource: "district-fallback", locationQuery }, event);
  }

  const cityFallback = getCityFallback(city);
  if (cityFallback) {
    return withLocationQuality({ ...cityFallback, city, district, locationPrecision: "city", locationSource: "city-fallback", locationQuery }, event);
  }

  return withLocationQuality({ lat: NaN, lng: NaN, city, district, locationPrecision: "unknown", locationSource: "unknown", locationQuery }, event);
}

function makeGeocodingCacheKey(city, query) {
  return normalizeText(`${normalizeCity(city)}:${query}`.toLowerCase().replace(/臺/g, "台"));
}

module.exports = {
  TAIWAN_CITY_COORDS,
  TAIWAN_CITY_BOUNDS,
  KNOWN_LOCATION_COORDS,
  buildLocationQuery,
  extractDistrict,
  getCityBounds,
  getCityFallback,
  inferLocationDisplayMode,
  inferLocationQuality,
  inferCityFromText,
  isCityCenterCoord,
  isCoordInCity,
  isValidTaiwanCoord,
  makeGeocodingCacheKey,
  normalizeCity,
  normalizePrecision,
  normalizeText,
  rankGeocodingCandidates,
  resolveKnownLocationCoord,
  resolveLocationSync,
  scoreGeocodingCandidate,
  withLocationQuality,
};
