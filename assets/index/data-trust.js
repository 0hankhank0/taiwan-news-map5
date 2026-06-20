(function(){
  const state = {
    status: "loading",
    total: 0,
    lastUpdated: "",
    sources: [],
    store: "",
    message: "正在同步事件資料"
  };

  function decodeHeaderList(headers, name) {
    const raw = headers.get(name) || "";
    if (!raw) return [];
    return decodeURIComponent(raw).split(",").map(v => v.trim()).filter(Boolean);
  }

  function formatTime(value) {
    const timestamp = Date.parse(value || "");
    if (!Number.isFinite(timestamp)) return "尚無更新時間";
    return new Date(timestamp).toLocaleString("zh-TW", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }

  function eventTime(event) {
    return event && (event.updatedAt || event.publishedAt || event.time || event.createdAt || event.startsAt || event.startAt) || "";
  }

  function eventSource(event) {
    const raw = String(event && (event.sourceName || event.source) || "").trim();
    if (!raw) return "來源未標示";
    if (/tdx/i.test(raw)) return "TDX 交通資料";
    if (/rss/i.test(raw)) return "RSS 新聞";
    if (/news/i.test(raw)) return "新聞資料";
    if (/concept demo|island pulse/i.test(raw)) return "展示資料";
    return raw;
  }

  function annotateCards(events) {
    const cards = Array.from(document.querySelectorAll(".event-card-v2"));
    if (!cards.length || !Array.isArray(events)) return;
    cards.forEach((card, index) => {
      if (card.querySelector(".event-trust-row")) return;
      const event = events[index];
      if (!event) return;
      const content = card.querySelector(".card-v2-content");
      if (!content) return;
      const row = document.createElement("div");
      row.className = "event-trust-row";
      row.innerHTML = `
        <span><i class="fa-solid fa-database"></i>${eventSource(event)}</span>
        <span><i class="fa-regular fa-clock"></i>${formatTime(eventTime(event))}</span>
        <span><i class="fa-solid fa-signal"></i>${typeof getEventStatusLabel === "function" ? getEventStatusLabel(event) : "狀態待確認"}</span>
        <span><i class="fa-solid fa-shield-halved"></i>${state.store || "資料快取"}</span>`;
      content.insertAdjacentElement("afterend", row);
    });
  }

  function ensurePanel() {
    let panel = document.getElementById("data-trust-panel");
    if (panel) return panel;
    const header = document.querySelector(".sidebar-header");
    const kpis = document.querySelector(".sidebar-kpis");
    if (!header || !kpis) return null;
    panel = document.createElement("div");
    panel.id = "data-trust-panel";
    panel.className = "data-trust-panel";
    kpis.insertAdjacentElement("afterend", panel);
    return panel;
  }

  function renderPanel(visibleCount) {
    const panel = ensurePanel();
    if (!panel) return;
    const statusLabel = {
      loading: "同步中",
      ready: "已同步",
      empty: "目前無資料",
      error: "讀取異常"
    }[state.status] || "資料狀態";
    const sources = state.sources.length ? state.sources.slice(0, 3).join("、") : "尚無來源";
    panel.dataset.status = state.status;
    panel.innerHTML = `
      <div class="data-trust-main">
        <span class="data-trust-dot"></span>
        <strong>${statusLabel}</strong>
        <span>${state.message}</span>
      </div>
      <div class="data-trust-grid">
        <span>顯示 ${Number(visibleCount || 0).toLocaleString()} / ${Number(state.total || 0).toLocaleString()} 筆</span>
        <span>更新 ${formatTime(state.lastUpdated)}</span>
        <span>來源 ${sources}</span>
        <span>非官方警報系統</span>
      </div>`;
  }

  function renderEmptyIfNeeded() {
    const cards = document.querySelectorAll(".event-card-v2").length;
    if (cards > 0) return;
    const list = document.getElementById("event-list");
    if (!list) return;
    const text = state.status === "error"
      ? ["暫時讀不到事件資料", "可能是資料服務或網路暫時異常，請稍後重新整理。"]
      : state.status === "loading"
        ? ["正在同步事件資料", "正在讀取交通、新聞與活動資料，完成後會自動更新地圖與清單。"]
        : ["目前沒有可顯示的事件", "資料源目前沒有回傳事件，或事件尚未通過座標與分類整理；可切換城市、分類或稍後重新整理。"];
    list.innerHTML = `
      <div class="empty-state data-empty-state">
        <i class="fa-solid ${state.status === "error" ? "fa-triangle-exclamation" : "fa-map-location-dot"}"></i>
        <strong>${text[0]}</strong>
        <p>${text[1]}</p>
        <small>最後更新：${formatTime(state.lastUpdated)}｜來源：${state.sources.length ? state.sources.join("、") : "尚無來源"}｜本服務不是官方警報系統</small>
      </div>`;
  }

  async function refreshDataTrust() {
    renderPanel(0);
    try {
      const response = await fetch("/api/events", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const events = await response.json();
      const count = Array.isArray(events) ? events.length : 0;
      state.status = count > 0 ? "ready" : "empty";
      state.total = Number(response.headers.get("X-Event-Total") || count);
      state.lastUpdated = response.headers.get("X-Last-Event-Time") || response.headers.get("X-Cache-Updated-Time") || "";
      state.sources = decodeHeaderList(response.headers, "X-Data-Sources");
      state.store = response.headers.get("X-Data-Store") || "";
      state.message = count > 0 ? "事件資料已同步" : "資料源目前沒有回傳事件";
      renderPanel(document.querySelectorAll(".event-card-v2").length || count);
      annotateCards(events);
      renderEmptyIfNeeded();
    } catch (error) {
      state.status = "error";
      state.total = 0;
      state.lastUpdated = "";
      state.sources = [];
      state.message = "暫時讀不到事件資料，請稍後再試";
      renderPanel(0);
      renderEmptyIfNeeded();
    }
  }

  const style = document.createElement("style");
  style.textContent = `
    .data-trust-panel{margin:-2px 0 14px;padding:10px 11px;border:1px solid rgba(138,155,184,.12);border-radius:10px;background:rgba(7,12,22,.46);color:var(--text-secondary)}
    .data-trust-main{display:flex;align-items:center;gap:7px;min-width:0;font-size:12px;line-height:1.35}
    .data-trust-main strong{color:var(--text-primary);white-space:nowrap}.data-trust-main span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .data-trust-dot{width:8px;height:8px;border-radius:50%;background:#34d399;box-shadow:0 0 0 4px rgba(52,211,153,.12);flex:0 0 auto}
    .data-trust-panel[data-status=loading] .data-trust-dot{background:#fbbf24;box-shadow:0 0 0 4px rgba(251,191,36,.12)}
    .data-trust-panel[data-status=empty] .data-trust-dot,.data-trust-panel[data-status=error] .data-trust-dot{background:#f87171;box-shadow:0 0 0 4px rgba(248,113,113,.12)}
    .data-trust-grid{display:grid;gap:4px;margin-top:8px;font-size:10.5px;line-height:1.35;color:var(--text-muted)}
    .data-trust-grid span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.event-trust-row{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px;color:var(--text-muted);font-size:10.5px;line-height:1.35}.event-trust-row span{display:inline-flex;align-items:center;gap:4px;min-width:0;max-width:100%;padding:3px 7px;border:1px solid rgba(138,155,184,.1);border-radius:999px;background:rgba(7,12,22,.34);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.event-trust-row i{font-size:10px;color:var(--accent);flex:0 0 auto}.empty-state strong{display:block;font-size:14px;color:var(--text-primary);margin-bottom:6px}.empty-state small{display:block;margin-top:8px;font-size:11px;color:var(--text-muted)}
  `;
  document.head.appendChild(style);
  document.addEventListener("DOMContentLoaded", () => setTimeout(refreshDataTrust, 900));
})();
