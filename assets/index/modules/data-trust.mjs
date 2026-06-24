import { escapeHtml } from "./dom-utils.mjs";

function decodeHeaderList(headers, name) {
    const raw = headers?.get?.(name) || "";
    if (!raw) return [];
    return decodeURIComponent(raw).split(",").map((value) => value.trim()).filter(Boolean);
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

function ensureStyles() {
    if (document.getElementById("data-trust-module-style")) return;
    const style = document.createElement("style");
    style.id = "data-trust-module-style";
    style.textContent = `
      .event-trust-row--strong span[data-kind=quality],
      .event-trust-row--strong span[data-kind=report],
      .event-trust-row--strong span[data-kind=review]{border-color:color-mix(in srgb,var(--card-color,var(--accent)) 32%,rgba(138,155,184,.14));color:#d7e6fb}
      .event-trust-row span[data-kind=low-quality]{border-color:rgba(248,113,113,.34);color:#fecaca;background:rgba(127,29,29,.22)}
      .trust-mini-label{font-weight:700;color:var(--text-primary)}
    `;
    document.head.appendChild(style);
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

function renderPanel(state, visibleCount) {
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
        <strong>${escapeHtml(statusLabel)}</strong>
        <span>${escapeHtml(state.message)}</span>
      </div>
      <div class="data-trust-grid">
        <span>顯示 ${Number(visibleCount || 0).toLocaleString()} / ${Number(state.total || 0).toLocaleString()} 筆</span>
        <span>更新 ${escapeHtml(formatTime(state.lastUpdated))}</span>
        <span>來源 ${escapeHtml(sources)}</span>
        <span>非官方警報系統</span>
      </div>`;
}

export function createDataTrustController({ getEventStatusLabel, getLocationPrecisionLabel, getReviewStateLabel } = {}) {
    ensureStyles();
    const state = {
        status: "loading",
        total: 0,
        lastUpdated: "",
        sources: [],
        store: "",
        message: "正在同步事件資料"
    };

    function updateFromResponse(events = [], response = null, visibleCount = null) {
        const count = Array.isArray(events) ? events.length : 0;
        state.status = count > 0 ? "ready" : "empty";
        state.total = Number(response?.headers?.get?.("X-Event-Total") || count);
        state.lastUpdated = response?.headers?.get?.("X-Last-Event-Time") || response?.headers?.get?.("X-Cache-Updated-Time") || "";
        state.sources = decodeHeaderList(response?.headers, "X-Data-Sources");
        state.store = response?.headers?.get?.("X-Data-Store") || "";
        state.message = count > 0 ? "事件資料已同步" : "資料源目前沒有回傳事件";
        renderPanel(state, visibleCount ?? (document.querySelectorAll(".event-card-v2").length || count));
    }

    function updateError(message = "暫時讀不到事件資料，請稍後再試") {
        state.status = "error";
        state.total = 0;
        state.lastUpdated = "";
        state.sources = [];
        state.message = message;
        renderPanel(state, 0);
    }

    function updateVisibleCount(visibleCount = 0) {
        renderPanel(state, visibleCount);
    }

    function buildTrustRow(event, { reportCount = 0, compact = false } = {}) {
        const status = typeof getEventStatusLabel === "function" ? getEventStatusLabel(event) : "狀態待確認";
        const location = typeof getLocationPrecisionLabel === "function" ? getLocationPrecisionLabel(event) : "";
        const review = typeof getReviewStateLabel === "function" ? getReviewStateLabel(event) : "";
        const lowQuality = String(event?.locationQuality || "").toLowerCase() === "low" || String(event?.locationDisplayMode || "").toLowerCase() === "list_only";
        const reportHtml = reportCount ? `<span data-kind="report"><i class="fa-solid fa-flag"></i>有效回報 ${reportCount}</span>` : "";
        const reviewHtml = review && !compact ? `<span data-kind="review"><i class="fa-solid fa-user-check"></i>${escapeHtml(review)}</span>` : "";
        return `<div class="event-trust-row event-trust-row--strong">
            <span><i class="fa-solid fa-database"></i>${escapeHtml(eventSource(event))}</span>
            <span><i class="fa-regular fa-clock"></i>${escapeHtml(formatTime(eventTime(event)))}</span>
            <span><i class="fa-solid fa-signal"></i>${escapeHtml(status)}</span>
            ${location ? `<span data-kind="${lowQuality ? "low-quality" : "quality"}"><i class="fa-solid fa-location-dot"></i>${escapeHtml(location)}</span>` : ""}
            ${reviewHtml}
            ${reportHtml}
        </div>`;
    }

    return {
        updateFromResponse,
        updateError,
        updateVisibleCount,
        buildTrustRow,
    };
}
