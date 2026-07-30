function normalized(value) { return String(value || "").trim().toLowerCase(); }

export function getLocationPresentation(event = {}) {
    const precision = normalized(event.locationPrecision);
    const display = normalized(event.locationDisplayMode);
    const quality = normalized(event.locationQuality);
    const confidence = Number(event.locationConfidence);
    const highConfidence = quality === "high" || confidence >= 0.8;
    const mediumConfidence = quality === "medium" || (confidence >= 0.45 && confidence < 0.8);

    if (precision === "city") return { mode: "city_area", marker: true, flyTo: false, label: "僅提供縣市位置", description: `新聞僅提供${event.city || "縣市"}，實際地點待確認。` };
    if (display === "list_only" || precision === "unknown" || quality === "low" || (!Number.isFinite(Number(event.lat)) || !Number.isFinite(Number(event.lng)))) {
        return { mode: "unlocated", marker: false, flyTo: false, label: "位置待確認", description: "這則新聞尚無可靠位置資訊。" };
    }
    if (precision === "district" || display === "estimated" || mediumConfidence) {
        return { mode: "estimated", marker: true, flyTo: true, label: "約略位置", description: "此位置為區域推估，並非精確發生地點。" };
    }
    if (precision === "exact" && (highConfidence || !quality && !Number.isFinite(confidence))) return { mode: "exact", marker: true, flyTo: true, label: "精確位置", description: "依來源提供的精確位置顯示。" };
    return { mode: "unlocated", marker: false, flyTo: false, label: "位置待確認", description: "這則新聞尚無可靠位置資訊。" };
}
