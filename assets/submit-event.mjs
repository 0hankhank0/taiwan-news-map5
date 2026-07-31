export const TAIWAN_BOUNDS = { minLat: 21.5, maxLat: 26.5, minLng: 118, maxLng: 122.5 };

export function hasValidTaiwanCoordinates(latitude, longitude) {
  const lat = Number(latitude), lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= TAIWAN_BOUNDS.minLat && lat <= TAIWAN_BOUNDS.maxLat && lng >= TAIWAN_BOUNDS.minLng && lng <= TAIWAN_BOUNDS.maxLng;
}

export function buildSubmissionPayload(formData, coordinates) {
  const payload = Object.fromEntries(formData.entries());
  payload.evidenceUrls = payload.evidenceUrl ? [payload.evidenceUrl] : [];
  delete payload.evidenceUrl;
  payload.latitude = coordinates ? Number(coordinates.latitude) : null;
  payload.longitude = coordinates ? Number(coordinates.longitude) : null;
  return payload;
}

export function validateSubmissionPayload(payload) {
  if (!payload.sourceType) return ["請選擇線索來源類型。"];
  if (["news_report", "official_notice"].includes(payload.sourceType) && !payload.sourceUrl) return ["新聞報導與官方公告必須提供來源網址。"];
  if (payload.sourceType === "eyewitness" && !hasValidTaiwanCoordinates(payload.latitude, payload.longitude)) return ["現場目擊必須提供台灣境內的有效座標。"];
  if (payload.sourceType === "eyewitness" && String(payload.description || "").trim().length < 30) return ["現場目擊的事件描述至少需要 30 個字。"];
  if (!payload.publicImpactConfirmed) return ["請確認這是可能具有公共影響的事件，而非個人瑣事。"];
  return [];
}

export function getSubmissionResult(response) {
  return { message: `新聞線索已收到，正在等待管理員確認。確認具有公共影響且資料可信後，才會加入公開地圖。${response?.submissionId ? ` 投稿編號：${response.submissionId}` : ""}`, redirect: null };
}
