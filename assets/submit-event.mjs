export const TAIWAN_BOUNDS = { minLat: 21.5, maxLat: 26.5, minLng: 118, maxLng: 122.5 };

export function hasValidTaiwanCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= TAIWAN_BOUNDS.minLat && lat <= TAIWAN_BOUNDS.maxLat
    && lng >= TAIWAN_BOUNDS.minLng && lng <= TAIWAN_BOUNDS.maxLng;
}

export function buildSubmissionPayload(formData, coordinates) {
  const payload = Object.fromEntries(formData.entries());
  payload.evidenceUrls = payload.evidenceUrl ? [payload.evidenceUrl] : [];
  delete payload.evidenceUrl;
  payload.latitude = coordinates ? Number(coordinates.latitude) : null;
  payload.longitude = coordinates ? Number(coordinates.longitude) : null;
  return payload;
}

export function getSubmissionResult(response) {
  if (response?.status === "approved" && response?.submissionId) {
    return {
      message: "投稿已通過自動檢查並發布，正在返回地圖。",
      redirect: `/?submission=${encodeURIComponent(response.submissionId)}`,
    };
  }
  return {
    message: `投稿已收到，目前等待管理員確認。核准後才會顯示在公開地圖。${response?.submissionId ? ` 投稿編號：${response.submissionId}` : ""}`,
    redirect: null,
  };
}
