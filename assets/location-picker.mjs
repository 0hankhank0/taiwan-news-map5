export const TAIWAN_BOUNDS = { minLat: 21.5, maxLat: 26.5, minLng: 118, maxLng: 122.5 };
export function validCoordinates(lat, lng) {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
    && Number(lat) >= TAIWAN_BOUNDS.minLat && Number(lat) <= TAIWAN_BOUNDS.maxLat
    && Number(lng) >= TAIWAN_BOUNDS.minLng && Number(lng) <= TAIWAN_BOUNDS.maxLng;
}
export class LocationPicker {
  constructor({ container, latInput, lngInput, status, mapboxToken, initial, onChange }) {
    Object.assign(this, { container, latInput, lngInput, status, onChange, value: null });
    if (!globalThis.mapboxgl || !mapboxToken) this.show("地圖無法載入：缺少 MAPBOX_ACCESS_TOKEN 或 Mapbox 資源。");
    else {
      mapboxgl.accessToken = mapboxToken;
      this.map = new mapboxgl.Map({ container, style: "mapbox://styles/mapbox/dark-v11", center: [120.96, 23.7], zoom: 7 });
      this.map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
      this.map.on("click", (event) => this.set({ lat: event.lngLat.lat, lng: event.lngLat.lng }));
      this.map.on("error", () => this.show("地圖載入失敗，仍可手動輸入經緯度。"));
    }
    [latInput, lngInput].filter(Boolean).forEach((input) => input.addEventListener("change", () => this.set({ lat: latInput.value, lng: lngInput.value })));
    if (initial && validCoordinates(initial.lat, initial.lng)) this.set(initial, false);
  }
  show(message) { if (this.status) this.status.textContent = message; }
  set(next, notify = true) {
    const lat = Number(next?.lat ?? next?.latitude), lng = Number(next?.lng ?? next?.longitude);
    if (!validCoordinates(lat, lng)) { this.show("座標不可為空，且須在臺灣合理範圍內（lat 21.5–26.5、lng 118–122.5）。"); return false; }
    this.value = { lat, lng };
    if (this.latInput) this.latInput.value = lat.toFixed(6);
    if (this.lngInput) this.lngInput.value = lng.toFixed(6);
    if (this.map) {
      if (!this.marker) { this.marker = new mapboxgl.Marker({ draggable: true }).setLngLat([lng, lat]).addTo(this.map); this.marker.on("dragend", () => { const point = this.marker.getLngLat(); this.set({ lat: point.lat, lng: point.lng }); }); }
      else this.marker.setLngLat([lng, lat]);
      this.map.flyTo({ center: [lng, lat], zoom: Math.max(this.map.getZoom(), 14) });
    }
    this.show(`${lat.toFixed(6)}, ${lng.toFixed(6)}`); if (notify) this.onChange?.(this.value); return true;
  }
  async search(query) {
    if (!query?.trim()) return;
    if (!this.map) throw new Error("地圖未載入，無法搜尋地址。");
    const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(query)}&limit=1&access_token=${encodeURIComponent(mapboxgl.accessToken)}`;
    const response = await fetch(url); if (!response.ok) throw new Error("地址搜尋失敗");
    const point = (await response.json()).features?.[0]?.geometry?.coordinates;
    if (!point || !this.set({ lng: point[0], lat: point[1] })) throw new Error("找不到臺灣境內地址");
  }
}
