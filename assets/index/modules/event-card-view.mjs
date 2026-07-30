export function formatRelativeTime(event, now = Date.now()) {
    const value = event.occurredAt || event.eventAt || event.startsAt || event.publishedAt || event.updatedAt || event.createdAt || event.time;
    const time = Date.parse(value || "");
    if (!Number.isFinite(time)) return "時間待確認";
    const minutes = Math.max(0, Math.round((now - time) / 60000));
    if (minutes < 1) return "剛剛";
    if (minutes < 60) return `${minutes} 分鐘前`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} 小時前`;
    return `${Math.floor(minutes / 1440)} 天前`;
}

export function getSourceSummary(event = {}) {
    const sources = Array.isArray(event.sourceTrace) ? event.sourceTrace.filter(Boolean) : [];
    const primary = String(event.sourceName || event.source || sources[0]?.name || "資料來源").trim();
    if (sources.length > 1) return `${sources.length} 家媒體報導`;
    return primary;
}

export function getCardPreview(event = {}, now = Date.now()) {
    const summary = String(event.summary || event.content || event.description || "").trim();
    return { relativeTime: formatRelativeTime(event, now), sourceSummary: getSourceSummary(event), summary };
}
