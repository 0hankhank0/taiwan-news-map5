// ── CONFIG ──────────────────────────────────────────────
    const MAPBOX_TOKEN = "pk.eyJ1IjoiaGFua2hhbmsiLCJhIjoiY21wNWhmNHNiMDJxMzJycjB4a3FmNDY0biJ9.FK_qTU4xvkvvYq1Ze8WC4g"; 
    
    // 測試 Mapbox Token 是否有效
    async function checkMapboxToken() {
        const testUrl = `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/7/108/55.mvt?access_token=${MAPBOX_TOKEN}`;
        try {
            const res = await fetch(testUrl, { method: 'HEAD' });
            return res.ok;
        } catch (e) {
            return false;
        }
    }

    // SVG outline icons (stroke-based, clean line style)
    const CAT_SVG = {
        all:          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="18" r="1"/></svg>`,
        traffic:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17H3a2 2 0 01-2-2V9a2 2 0 012-2h2l2-3h8l2 3h2a2 2 0 012 2v6a2 2 0 01-2 2h-2"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/><line x1="10" y1="17.5" x2="14" y2="17.5"/></svg>`,
        disaster:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 19h20L12 2z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
        criminal:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
        medical:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
        activity:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`,
        other:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    };

    const CATEGORY_CONFIG = {
        all:          { text: "全部",     icon: "fa-list",                color: "#4A5878" },
        disaster:     { text: "災害事故", icon: "fa-triangle-exclamation", color: "#C0392B" },
        criminal:     { text: "刑事案件", icon: "fa-handcuffs",           color: "#8E44AD" },
        traffic:      { text: "交通事故", icon: "fa-car-burst",           color: "#2471A3" },
        medical:      { text: "醫療緊急", icon: "fa-truck-medical",       color: "#D35400" },
        activity:     { text: "活動",     icon: "fa-users",               color: "#1E8449" },
        other:        { text: "其他事件", icon: "fa-circle-info",         color: "#4A5878" }
    };

    const ALERT_COLOR_MAP = {
        traffic:  { color: "#2471A3", glow: "rgba(36, 113, 163, 0.45)" },
        fire:     { color: "#D35400", glow: "rgba(211, 84, 0, 0.42)" },
        arson:    { color: "#C0392B", glow: "rgba(192, 57, 43, 0.45)" },
        disaster: { color: "#C0392B", glow: "rgba(192, 57, 43, 0.4)" },
    };

    function getEventAlertType(ev) {
        const text = (ev.title + " " + (ev.content || ""));
        if (/縱火|放火|蓄意放火/.test(text)) return "arson";
        if (/火災|火警|爆炸|氣爆|失火|燃燒|起火/.test(text)) return "fire";
        if (ev.category === "traffic") return "traffic";
        if (ev.category === "disaster") return "disaster";
        return null;
    }

    function getEventSeverity(ev) {
        let score = 2;
        const alertType = getEventAlertType(ev);
        if (alertType === "arson") score = 5;
        else if (alertType === "fire") score = 4;
        else if (alertType === "disaster" || ev.category === "disaster") score = 4;
        else if (ev.category === "criminal") score = 3;
        else if (ev.category === "traffic" || alertType === "traffic") score = 2;
        else if (ev.category === "medical") score = 3;
        else score = 1;
        if (isMourningEvent(ev)) score = Math.max(score, 4);
        const urgent = /重大|嚴重|多車|連環|傷亡|死亡|罹難/.test((ev.title || "") + (ev.content || ""));
        if (urgent) score = Math.min(5, score + 1);
        return Math.min(5, Math.max(1, score));
    }

    function resolveMarkerStyle(ev, fallbackColor) {
        const alertType = getEventAlertType(ev);
        if (alertType && ALERT_COLOR_MAP[alertType]) return ALERT_COLOR_MAP[alertType];
        return { color: fallbackColor, glow: "rgba(90, 143, 212, 0.35)" };
    }

    const CAT_META = {
        disaster:     { rgba: "192,57,43",  tint: "#E8856A", cssVar: "--cat-disaster" },
        criminal:     { rgba: "142,68,173", tint: "#BB8FCE", cssVar: "--cat-criminal" },
        traffic:      { rgba: "36,113,163",  tint: "#7FB3D3", cssVar: "--cat-traffic" },
        medical:      { rgba: "211,84,0",    tint: "#F0B27A", cssVar: "--cat-medical" },
        activity:     { rgba: "30,132,73",   tint: "#58D68D", cssVar: "--cat-activity" },
        other:        { rgba: "74,88,120",   tint: "#AEB6BF", cssVar: "--cat-other" },
        accident:     { rgba: "142,68,173", tint: "#BB8FCE", cssVar: "--cat-criminal" },
        construction: { rgba: "211,84,0",    tint: "#F0B27A", cssVar: "--cat-medical" },
    };

    const LOC_PIN_SVG = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0112 2a8 8 0 018 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg>`;

    const REACT_SVG = {
        muyu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="10" rx="7" ry="6"/><path d="M8 16c0 2.2 1.8 4 4 4s4-1.8 4-4"/><line x1="12" y1="4" x2="12" y2="2"/></svg>`,
        candle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><path d="M8 10c0-2.2 1.8-4 4-4s4 1.8 4 4v8a4 4 0 01-8 0v-8z"/><line x1="10" y1="22" x2="14" y2="22"/></svg>`,
    };

    function getCategoryVisual(category) {
        const isOnline = currentMapMode === "online";
        const config = isOnline ? TW_ONLINE_CATEGORIES : CATEGORY_CONFIG;
        const mapConfig = isOnline ? CATEGORY_MAP.online : CATEGORY_MAP.normal;
        const mappedCat = mapConfig[category] || category;
        const c = config[mappedCat] || config.other;
        const meta = CAT_META[mappedCat] || CAT_META.other;
        return { ...c, mappedCat, meta, color: c.color };
    }

    function shouldPinPulse(ev, severity) {
        return ev.category === "disaster" || severity >= 4 || getEventAlertType(ev) === "fire" || getEventAlertType(ev) === "arson";
    }

    function formatEventTime(ev) {
        const raw = ev.updatedAt || ev.publishedAt || ev.time || ev.createdAt;
        if (!raw) return "";
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return "";
        return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
    }

    function makeCatBadgeV2(category) {
        const { text, meta, mappedCat } = getCategoryVisual(category);
        const svg = CAT_SVG[category] || CAT_SVG[mappedCat] || CAT_SVG.other;
        return `<span class="cat-badge-v2" style="background:rgba(${meta.rgba},0.15);border:1px solid rgba(${meta.rgba},0.3);color:${meta.tint};"><span class="badge-svg-icon">${svg}</span>${text}</span>`;
    }

    function makeSrcBadgeV2(source) {
        const normalized = normalizeSource(source);
        const c = SOURCE_CONFIG[normalized] || SOURCE_CONFIG.default;
        const t = c.shortText || c.text;
        return `<span class="src-badge-v2" style="background:${c.bg};color:${c.color};border:1px solid ${c.color}33;">${t}</span>`;
    }

    const EVENT_INTERACTION_KEYWORDS = {
        safety: ["disaster", "accident", "criminal", "fire", "medical", "emergency"],
        traffic: ["traffic", "construction", "road", "closure"],
        activity: ["activity", "event"],
        sports: ["sports", "game"],
        weather: ["typhoon", "earthquake", "weather", "climate"],
    };

    function getEventTypeTokens(ev) {
        return [
            ev.category,
            ev.type,
            ev.eventType,
            ev.kind,
            ev.subtype,
        ].map(v => normalizeText(v).toLowerCase()).filter(Boolean);
    }

    function eventMatchesAny(ev, keywords) {
        const tokens = getEventTypeTokens(ev);
        return tokens.some(token => keywords.some(keyword => token.includes(keyword)));
    }

    function isSafetyEvent(ev) {
        return eventMatchesAny(ev, EVENT_INTERACTION_KEYWORDS.safety);
    }

    function isTrafficEvent(ev) {
        return eventMatchesAny(ev, EVENT_INTERACTION_KEYWORDS.traffic);
    }

    function isActivityEvent(ev) {
        return eventMatchesAny(ev, EVENT_INTERACTION_KEYWORDS.activity);
    }

    function isSportsEvent(ev) {
        return eventMatchesAny(ev, EVENT_INTERACTION_KEYWORDS.sports);
    }

    function isWeatherLayerEvent(ev) {
        return eventMatchesAny(ev, EVENT_INTERACTION_KEYWORDS.weather);
    }

    function getEventInteractionType(ev) {
        if (isWeatherLayerEvent(ev)) return "report";
        if (isTrafficEvent(ev)) return "report";
        if (isSportsEvent(ev)) return "sports-rating";
        if (isActivityEvent(ev)) return "activity-rating";
        if (isSafetyEvent(ev)) return "safety";
        return "report";
    }

    function makeReportActionHtml(displayTitle, context) {
        const reportArg = encodeURIComponent(displayTitle || "");
        if (context === "popup") {
            return `<button type="button" class="popup-btn-v2 ghost" onclick='openReportModal(decodeURIComponent("${reportArg}"))'>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                回報
            </button>`;
        }
        return `<button type="button" class="card-action-btn report" data-report="${reportArg}">
            <span style="display:inline-flex;width:11px;height:11px;align-items:center;margin-right:3px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></span>回報
        </button>`;
    }

    function makeRatingActionHtml(ev, labels, context) {
        const cls = context === "popup" ? "popup-btn-v2 ghost rating-action" : "card-action-btn rating-action";
        return labels.map(label => {
            const value = encodeURIComponent(label);
            return `<button type="button" class="${cls}" data-rating="${value}" onclick="handleRatingClick(event, '${ev.id}', '${value}', this)">${label}</button>`;
        }).join("");
    }

    function renderEventActions(ev, options = {}) {
        const context = options.context || "card";
        const displayTitle = options.displayTitle || ev.title || "";
        const interactionType = getEventInteractionType(ev);
        const ratingLabels = interactionType === "sports-rating"
            ? ["精彩", "普通", "冷場"]
            : interactionType === "activity-rating"
                ? ["值得去", "還好", "不推薦"]
                : [];
        const reactionHtml = interactionType === "safety"
            ? `<div class="${context === "popup" ? "popup-reactions-wrap" : "card-reactions-wrap"} reaction-container" data-event-id="${ev.id}"></div>`
            : "";
        const buttonsHtml = `${makeRatingActionHtml(ev, ratingLabels, context)}${makeReportActionHtml(displayTitle, context)}`;
        return `
            <div class="event-actions event-actions--${context}" data-interaction-type="${interactionType}">
                ${reactionHtml}
                <div class="${context === "popup" ? "popup-action-group" : "card-action-group"}">${buttonsHtml}</div>
            </div>`;
    }

    Object.assign(window, {
        getEventInteractionType,
        renderEventActions,
        isSafetyEvent,
        isTrafficEvent,
        isActivityEvent,
        isSportsEvent,
        isWeatherLayerEvent,
    });

    function makeReactionBarHtml(eventId, data, reacted, compact = false) {
        const muyuActive = reacted === "muyu";
        const candleActive = reacted === "candle";
        const compactCls = compact ? " react-btn--compact" : "";
        const muyuCount = muyuActive ? `✓ ${data.muyu}` : String(data.muyu || 0);
        const candleCount = candleActive ? `✓ ${data.candle}` : String(data.candle || 0);
        const total = (data.muyu || 0) + (data.candle || 0);
        const totalLabel = reacted ? "已回應" : `${total.toLocaleString()} 人回應`;

        return `
            <div class="reaction-bar" data-event-id="${eventId}">
                <button type="button" class="react-btn muyu${muyuActive ? " active" : ""}${compactCls}"
                    onclick="handleReactClick(event, '${eventId}', 'muyu', this)"
                    ${reacted && !muyuActive ? "disabled" : ""}>
                    ${REACT_SVG.muyu}
                    <span>敲木魚</span>
                    <span class="react-count">${muyuCount}</span>
                </button>
                <div class="react-divider"></div>
                <button type="button" class="react-btn candle${candleActive ? " active candle-lit" : ""}${compactCls}"
                    onclick="handleReactClick(event, '${eventId}', 'candle', this)"
                    ${reacted && !candleActive ? "disabled" : ""}>
                    ${REACT_SVG.candle}
                    <span>上香</span>
                    <span class="react-count">${candleCount}</span>
                </button>
                <span class="react-total">${totalLabel}</span>
            </div>`;
    }

    function buildPopupHtml(ev, displayTitle, displayContent, markerStyle) {
        const city = ev.city || "未知城市";
        const timeStr = formatEventTime(ev);
        const timeHtml = timeStr ? `<span class="popup-location-tag">${timeStr}</span>` : "";

        return `
            <div class="popup-demo-inner" style="--popup-color:${markerStyle.color}">
                <div class="popup-header">
                    <div>
                        <div class="popup-header-meta">
                            ${makeCatBadgeV2(ev.category)}
                            <span class="popup-location-tag">${city}</span>
                            ${timeHtml}
                        </div>
                        <div class="popup-title-v2">${displayTitle}</div>
                    </div>
                </div>
                <div class="popup-summary">${displayContent}</div>
                ${renderEventActions(ev, { displayTitle, context: "popup" })}
                <div class="popup-footer">
                    ${ev.url ? `<a href="${ev.url}" target="_blank" rel="noreferrer" class="popup-btn-v2 primary">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        查看原文
                    </a>` : ""}
                </div>
            </div>`;
    }

    function buildEventCardHtml(ev, displayTitle, displayContent, catVisual) {
        const city = normalizeText(ev.city) || "未知城市";
        const timeStr = formatEventTime(ev);
        const timeHtml = timeStr ? `<span class="time-tag">${timeStr}</span>` : "";
        const sourcesHtml = ev.sources && ev.sources.length > 0 ? `
            <div class="card-sources-toggle" onclick="this.nextElementSibling.classList.toggle('visible'); event.stopPropagation();">
                <i class="fa-solid fa-newspaper"></i> ${ev.sources.length} 家報導 <i class="fa-solid fa-chevron-down"></i>
            </div>
            <div class="card-sources-list">
                ${ev.sources.map(s => `<a href="${s.url}" target="_blank" onclick="event.stopPropagation();">${s.outlet}：${s.title}</a>`).join("")}
            </div>` : "";

        return `
            <div class="card-bar" style="background:${catVisual.color};"></div>
            <div class="card-v2-left">
                <div class="card-v2-meta">
                    <span class="city-tag">${LOC_PIN_SVG}${city}</span>
                    ${makeCatBadgeV2(ev.category)}
                    ${timeHtml}
                </div>
                <div class="card-v2-title">${displayTitle}</div>
                <div class="card-v2-content">${displayContent}</div>
            </div>
            <div class="card-v2-right">${makeSrcBadgeV2(ev.source)}</div>
            <div class="card-v2-extra card-footer">
                ${sourcesHtml}
                <div class="card-actions">
                    ${renderEventActions(ev, { displayTitle, context: "card" })}
                    ${ev.url ? `<a href="${ev.url}" target="_blank" rel="noreferrer" class="card-action-btn link" onclick="event.stopPropagation();"><i class="fa-solid fa-arrow-up-right-from-square" style="margin-right:3px;font-size:10px"></i>原文</a>` : ""}
                </div>
            </div>`;
    }

    function toggleReact(btn) {
        if (btn.classList.contains("active")) return;
        btn.classList.add("active");
        const countEl = btn.querySelector(".react-count");
        if (countEl) {
            const n = parseInt(countEl.textContent.replace(/\D/g, ""), 10) || 0;
            countEl.textContent = "✓ " + (n + 1);
        }
        const bar = btn.closest(".reaction-bar");
        if (bar) {
            bar.querySelectorAll(".react-btn").forEach(s => {
                if (s !== btn) {
                    s.disabled = true;
                }
            });
            const total = bar.querySelector(".react-total");
            if (total) total.textContent = "已回應";
        }
    }

    const TW_ONLINE_TEXT = {
        // Header 
        siteTitle: "TW-01 伺服器",
        siteSubtitle: "TAIWAN ONLINE · LIVE",
        statusPrefix: "活躍警報：",

        // 側邊欄 
        listTitle: "警報清單",
        searchPlaceholder: "搜尋事件、區域、類型",
        emptyState: "目前區域平靜，無活躍警報",
        loadingState: "正在連線至 TW-01 伺服器...",

        // 頂部狀態列（TW Online 專屬） 
        serverStatus: "🟢 TW-01 伺服器運作正常",
        playerCount: "玩家數：23,000,000",
    };

    const TW_ONLINE_CATEGORIES = {
        all:          { text: "全部警報",   icon: "fa-list",                color: "#475569" },
        traffic:      { text: "區域壅塞",   icon: "fa-car-burst",           color: "#4f8cff" },
        accident:     { text: "PK 事件",    icon: "fa-handcuffs",           color: "#f05a5a" },
        construction: { text: "伺服器維護", icon: "fa-wrench",              color: "#fb923c" },
        disaster:     { text: "緊急警報",   icon: "fa-triangle-exclamation", color: "#dc2626" },
        activity:     { text: "限時任務",   icon: "fa-users",               color: "#34d399" },
        other:        { text: "系統公告",   icon: "fa-circle-info",         color: "#6b7280" }
    };

    const CATEGORY_MAP = {
        normal: {
            all: "all", disaster: "disaster", criminal: "criminal", traffic: "traffic", 
            medical: "medical", activity: "activity", other: "other"
        },
        online: {
            all: "all", disaster: "disaster", criminal: "accident", traffic: "traffic", 
            medical: "construction", activity: "activity", other: "other"
        }
    };

    const FIXED_CATEGORY_ORDER = ["all", "disaster", "criminal", "traffic", "medical", "activity", "other"];

    const SOURCE_CONFIG = {
        "TDX CMS": { text:"TDX 即時路況", shortText:"TDX",  bg:"rgba(15,118,110,0.2)", color:"#5eead4" },
        RSS:        { text:"RSS 新聞事件", shortText:"RSS",  bg:"rgba(29,78,216,0.2)",  color:"#93c5fd" },
        news:       { text:"AI 擷取事件", shortText:"AI",   bg:"rgba(124,58,237,0.2)", color:"#c4b5fd" },
        default:    { text:"其他來源", shortText:"其他", bg:"rgba(71,85,105,0.25)", color:"#94a3b8" }
    };

    const CITY_OPTIONS = [
        { value:"基隆", label:"基隆市" },{ value:"台北", label:"台北市" },{ value:"新北", label:"新北市" },
        { value:"桃園", label:"桃園市" },{ value:"新竹", label:"新竹縣市" },{ value:"苗栗", label:"苗栗縣" },
        { value:"台中", label:"台中市" },{ value:"彰化", label:"彰化縣" },{ value:"南投", label:"南投縣" },
        { value:"雲林", label:"雲林縣" },{ value:"嘉義", label:"嘉義縣市" },{ value:"台南", label:"台南市" },
        { value:"高雄", label:"高雄市" },{ value:"屏東", label:"屏東縣" },{ value:"宜蘭", label:"宜蘭縣" },
        { value:"花蓮", label:"花蓮縣" },{ value:"台東", label:"台東縣" },{ value:"澎湖", label:"澎湖縣" },
        { value:"金門", label:"金門縣" },{ value:"連江", label:"連江縣" },
        { value:"國道", label:"國道 (高速公路)" },{ value:"省道", label:"省道" }
    ];

    const taiwanView = { center:[23.6,120.9], zoom:7 };
    const globalView = { center:[20,0], zoom:2 };
    const EMPTY_GEOJSON = { type:"FeatureCollection", features:[] };

    let parsedEvents = [];
    let activeCategory = "all";
    let searchKeyword = "";
    let isTaiwanMode = true;
    let twGeoJSON = null;
    let activePopup = null;
    const renderedMarkers = [];

    // ── THEME ───────────────────────────────────────────────
    const MAPBOX_STYLES = {
        light: 'mapbox://styles/mapbox/streets-v12',
        dark: 'mapbox://styles/mapbox/dark-v11'
    };
    let currentTheme = "dark";
    let isMapboxValid = true;

    async function switchTheme(theme) {
        if (theme === "dark" && !isMapboxValid) return;
        currentTheme = theme;

        ["btn-dark", "btn-dark-mobile"].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.classList.toggle("active", theme === "dark");
        });
        ["btn-light", "btn-light-mobile"].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.classList.toggle("active", theme === "light");
        });

        if (map && typeof map.setStyle === "function") {
            map.setStyle(MAPBOX_STYLES[theme]);
        }
        console.log("切換主題:", theme);
    }

    // ── MAP INIT ────────────────────────────────────────────
    function setMapLanguageToChinese() {
        const layers = [
            'country-label',
            'state-label',
            'settlement-label',
            'settlement-subdivision-label',
            'road-label-simple'
        ];
        layers.forEach(layer => {
            if (map.getLayer(layer)) {
                map.setLayoutProperty(layer, 'text-field', ['get', 'name_zh-Hant']);
            }
        });
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
        container: "map",
        style: MAPBOX_STYLES.dark,
        center: [taiwanView.center[1], taiwanView.center[0]],
        zoom: taiwanView.zoom
    });

    map.on('style.load', () => {
        setMapLanguageToChinese();
    });

    map.on('error', (e) => {
        if (e.error?.status === 401 || e.error?.status === 403) {
            console.warn('Mapbox token 失效，切換備用地圖');
            map.remove();
            fallbackToLeaflet();
        }
    });

    function fallbackToLeaflet() {
        const fallbackMap = L.map('map').setView([23.5, 121], 7);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(fallbackMap);
        window._fallbackMap = fallbackMap;
        // 把原本的 markers 重新打在 fallbackMap 上 (這部分需要額外邏輯，但先按照指示實作結構)
        if (parsedEvents.length) {
            parsedEvents.forEach(ev => {
                const latlng = [Number(ev.lat), Number(ev.lng)];
                if (Number.isFinite(latlng[0]) && Number.isFinite(latlng[1])) {
                    L.marker([latlng[0], latlng[1]]).addTo(fallbackMap)
                        .bindPopup(`<b>${ev.title}</b><br>${ev.content}`);
                }
            });
        }
    }

    function initBaseMaps() {
        console.log("地圖語系已設定為繁體中文");
    }

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("load", async () => {
        console.log("🚀 地圖載入完成，執行初始化...");
        
        // 檢測 Mapbox Token
        checkMapboxToken().then(valid => {
            isMapboxValid = valid;
            if (!valid) {
                ["btn-dark", "btn-dark-mobile"].forEach(id => {
                    const b = document.getElementById(id);
                    if (b) {
                        b.disabled = true;
                        b.textContent = id.includes("mobile") ? "🌙(鎖)" : "🌙 深色（暫停）";
                    }
                });
            }
        });

        ensureBoundaryLayer();
        drawCityBoundary(currentCityFilter());
        applyMapMode(currentMapMode); // 確保地圖載入後再次套用模式（包含底圖層）
        if(parsedEvents.length) renderEvents();
        scheduleMapResize();
    });

    const statusText   = document.getElementById("status-text");
    const eventList    = document.getElementById("event-list");
    const catFilters   = document.getElementById("category-filters");
    const reportModal  = document.getElementById("report-modal");
    const betaModal    = document.getElementById("beta-modal");
    const settingsModal = document.getElementById("settings-modal");
    const newsSidebar  = document.getElementById("news-sidebar");
    const mapStage     = document.getElementById("map-stage");

    let currentMapMode = localStorage.getItem("map_mode") || "normal";

    function applyMapMode(mode) {
        currentMapMode = mode;
        localStorage.setItem("map_mode", mode);
        document.body.classList.toggle("tw-online-mode", mode === "online");
        document.getElementById("map-mode-select").value = mode;

        const isOnline = mode === "online";
        
        // 切換底圖
        if (map && map.isStyleLoaded()) {
            if (isOnline) {
                if (map.getSource('online-tile')) {
                    map.setLayoutProperty('online-tile-layer', 'visibility', 'visible');
                } else {
                    map.addSource('online-tile', {
                        'type': 'raster',
                        'tiles': ['https://a.basemaps.cartocdn.com/dark_matter/{z}/{x}/{y}@2x.png'],
                        'tileSize': 256
                    });
                    map.addLayer({
                        'id': 'online-tile-layer',
                        'type': 'raster',
                        'source': 'online-tile',
                        'minzoom': 0,
                        'maxzoom': 22
                    }, 'boundary-line'); 
                }
            } else {
                if (map.getLayer('online-tile-layer')) {
                    map.setLayoutProperty('online-tile-layer', 'visibility', 'none');
                }
            }
        }

        // 替換文案
        const textConfig = isOnline ? TW_ONLINE_TEXT : {
            siteTitle: "台灣新聞事件地圖",
            siteSubtitle: "REAL-TIME EVENT TRACKER",
            listTitle: "事件清單",
            searchPlaceholder: "搜尋標題、內容、城市",
            emptyState: "目前沒有符合條件的事件",
            loadingState: "正在抓取事件資料...",
            statusPrefix: "準備載入..."
        };

        document.querySelector(".brand-title").textContent = textConfig.siteTitle;
        document.querySelector(".brand-sub").textContent = textConfig.siteSubtitle;
        document.querySelector(".sidebar-title").textContent = textConfig.listTitle;
        document.getElementById("event-search").placeholder = textConfig.searchPlaceholder;
        
        // TW Online 專屬狀態列
        const onlineStatus = document.getElementById("tw-online-status");
        if (isOnline) {
            onlineStatus.style.display = "flex";
            document.getElementById("server-status").textContent = TW_ONLINE_TEXT.serverStatus;
            document.getElementById("player-count").textContent = TW_ONLINE_TEXT.playerCount;
            setStatus(TW_ONLINE_TEXT.statusPrefix + "連線中...");
        } else {
            onlineStatus.style.display = "none";
            setStatus(textConfig.statusPrefix);
        }

        renderCategoryButtons();
        renderEvents();
        scheduleMapResize();
    }
    function setStatus(t){
        if(statusText) statusText.textContent = t;
        const heroStatus = document.getElementById("hero-status-copy");
        if (heroStatus && (!heroStatus.textContent || heroStatus.textContent.includes("準備") || heroStatus.textContent.includes("載入"))) {
            heroStatus.textContent = t;
        }
    }
    function normalizeText(v){ return String(v||"").trim(); }
    function tryParseJson(t,fb){ try{ return t ? JSON.parse(t) : fb; }catch{ return fb; } }
    function flyToLatLng(latlng, zoom, duration=800){
        map.flyTo({ center:[latlng[1], latlng[0]], zoom, duration, essential:true });
    }
    function closeActivePopup(){
        if(activePopup){
            activePopup.remove();
            activePopup = null;
        }
    }
    function clearRenderedMarkers(){
        closeActivePopup();
        while(renderedMarkers.length) renderedMarkers.pop().remove();
    }
    function updateCurationMeta(events){
        const cityValue = document.getElementById("city-filter")?.value || "all";
        const cityLabel = cityValue === "all" ? "全台" : cityValue;
        const modeLabel = isTaiwanMode ? "台灣" : "統計";
        const categoryLabel = activeCategory === "all"
            ? "全部"
            : (getCategoryVisual(activeCategory)?.text || activeCategory);
        const cityCount = new Set(events.map(ev => normalizeText(ev.city)).filter(Boolean)).size;
        const categoryCount = new Set(events.map(ev => normalizeText(ev.category)).filter(Boolean)).size;

        [
            ["sidebar-summary-count", String(events.length)],
            ["sidebar-mode-label", categoryLabel],
            ["sidebar-summary-city", cityLabel],
            ["hero-event-count", String(events.length)],
            ["hero-category-count", String(categoryCount)],
            ["hero-mode-copy", modeLabel],
            ["stats-hero-count", String(events.length)],
            ["stats-hero-mode", modeLabel]
        ].forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        });

        const heroStatus = document.getElementById("hero-status-copy");
        if (heroStatus) {
            heroStatus.textContent = `目前涵蓋 ${cityCount} 個城市、${categoryCount} 種事件類別，模式為${modeLabel}視角。`;
        }
    }
    function makeMarkerElement(color, svg, severity = 2, glowColor = null, showPulse = false){
        const pinSizes = { 1: 34, 2: 38, 3: 42, 4: 46, 5: 52 };
        const glowPx = { 1: 6, 2: 10, 3: 14, 4: 20, 5: 28 };
        const bodySize = pinSizes[severity] || 38;
        const g = glowColor || color;
        const glowR = glowPx[severity] || 10;
        const outerW = Math.round(bodySize * 1.18);
        const outerH = Math.round(bodySize * 1.7);
        const iconSize = Math.round(bodySize * 0.42);
        const wrapper = document.createElement("div");
        wrapper.className = `map-pin marker-severity-${severity}`;
        wrapper.style.setProperty("--pin-color", color);
        wrapper.style.setProperty("--pin-glow", g);
        wrapper.innerHTML = `
            <span class="map-pin-visual" style="width:${outerW}px;height:${outerH}px;">
                ${showPulse ? `<span class="pin-pulse" style="background:${color};width:${bodySize}px;height:${bodySize}px;"></span>` : ""}
                <svg class="map-pin-svg" viewBox="0 0 64 92" aria-hidden="true" style="filter:drop-shadow(0 8px 16px rgba(0,0,0,0.45)) drop-shadow(0 0 ${glowR}px ${g});">
                    <path class="map-pin-shape" d="M32 4C15.432 4 2 17.432 2 34c0 26.148 30 58 30 58s30-31.852 30-58C62 17.432 48.568 4 32 4z"></path>
                    <circle cx="32" cy="34" r="16" fill="rgba(255,255,255,0.12)"></circle>
                </svg>
                <span class="map-pin-icon" style="width:${iconSize}px;height:${iconSize}px;"><span class="marker-svg-icon">${svg}</span></span>
            </span>`;
        return wrapper;
    }

    function spawnMeritEffect(btn) {
        const rect = btn.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top;
        const float = document.createElement("div");
        float.className = "merit-float";
        float.textContent = "功德 +1";
        float.style.left = `${cx}px`;
        float.style.top = `${cy - 8}px`;
        float.style.transform = "translateX(-50%)";
        document.body.appendChild(float);
        setTimeout(() => float.remove(), 1100);
        for (let i = 0; i < 3; i++) {
            const ripple = document.createElement("div");
            ripple.className = "merit-ripple";
            ripple.style.left = `${cx + (i - 1) * 14}px`;
            ripple.style.top = `${rect.top + rect.height / 2}px`;
            document.body.appendChild(ripple);
            setTimeout(() => ripple.remove(), 750);
        }
    }
    function ensureBoundaryLayer(){
        if(!map.getSource("city-boundary")){
            map.addSource("city-boundary", { type:"geojson", data: EMPTY_GEOJSON });
            map.addLayer({
                id: "city-boundary-fill",
                type: "fill",
                source: "city-boundary",
                paint: { "fill-color":"#2471A3", "fill-opacity":0.06 }
            });
            map.addLayer({
                id: "city-boundary-line",
                type: "line",
                source: "city-boundary",
                paint: { "line-color":"#2471A3", "line-width":2.5, "line-opacity":0.7 }
            });
        }
    }

    function normalizeSource(source) {
        if (!source) return "news";
        const s = source.toLowerCase();
        if (s.includes("tdx") || s.includes("traffic")) return "TDX CMS";
        if (s.includes("rss") || s.includes("feed")) return "RSS";
        if (s.includes("news") || s.includes("ai") || s.includes("scraper")) return "news";
        return "news"; // 其他不認識的來源預設當新聞
    }

    function makeSourceBadge(source, compact=false){
        const normalized = normalizeSource(source);
        const c = SOURCE_CONFIG[normalized] || SOURCE_CONFIG.default;
        const t = compact ? c.shortText : c.text;
        return `<span class="src-badge" style="background:${c.bg};color:${c.color};">${t}</span>`;
    }
    function makeCatBadge(category) {
        return makeCatBadgeV2(category);
    }

    // ── GEO ─────────────────────────────────────────────────
    async function loadTwGeoJSON(){
        try{
            const res = await fetch("https://cdn.jsdelivr.net/gh/g0v/twgeojson@master/json/twCounty2010.geo.json");
            twGeoJSON = await res.json();
            drawCityBoundary(currentCityFilter());
        }catch(e){ console.warn("GeoJSON載入失敗", e); }
    }

    function drawCityBoundary(city){
        if(!map.isStyleLoaded()) return;
        ensureBoundaryLayer();
        const source = map.getSource("city-boundary");
        if(!source) return;
        if(!city || city==="all" || !twGeoJSON){
            source.setData(EMPTY_GEOJSON);
            return;
        }
        const filteredFeatures = twGeoJSON.features.filter(f=>{
            const n=(f.properties.COUNTYNAME||f.properties.name||"").replace(/臺/g,"台");
            const t=city.replace(/臺/g,"台");
            return n.includes(t)||t.includes(n);
        });
        source.setData(filteredFeatures.length ? { ...twGeoJSON, features: filteredFeatures } : EMPTY_GEOJSON);
    }

    function currentCityFilter(){ return document.getElementById("city-filter")?.value||"all"; }

    function enableSubpixelPositioning(instance) {
        if (instance && typeof instance.setSubpixelPositioning === "function") {
            instance.setSubpixelPositioning(true);
        }
        return instance;
    }

    function scheduleMapResize() {
        const resizeNow = () => {
            if (map && typeof map.resize === "function") map.resize();
            if (window._fallbackMap && typeof window._fallbackMap.invalidateSize === "function") {
                window._fallbackMap.invalidateSize(true);
            }
        };
        requestAnimationFrame(resizeNow);
        setTimeout(resizeNow, 120);
        setTimeout(resizeNow, 360);
    }

    function removeMapOverlays() {
        document.querySelectorAll(".map-hero, .map-orbital-card").forEach(el => el.remove());
    }

    function populateCityFilters(){
        const d=document.getElementById("city-filter");
        const m=document.getElementById("city-filter-mobile");
        if(!d||!m) return;
        const html=['<option value="all">全部城市</option>',...CITY_OPTIONS.map(o=>`<option value="${o.value}">${o.label}</option>`)].join("");
        d.innerHTML=html; m.innerHTML=html;
    }

    // ── FILTERS ─────────────────────────────────────────────
    function renderCategoryButtons(){
        const isOnline = currentMapMode === "online";
        const config = isOnline ? TW_ONLINE_CATEGORIES : CATEGORY_CONFIG;
        const mapConfig = isOnline ? CATEGORY_MAP.online : CATEGORY_MAP.normal;

        catFilters.innerHTML = FIXED_CATEGORY_ORDER.map(cat=>{
            const mappedCat = mapConfig[cat] || cat;
            const c = config[mappedCat]||config.other;
            const isActive = activeCategory===cat;
            const svg = CAT_SVG[cat]||CAT_SVG.other;
            return `<button class="filter-chip filter-chip-v2${isActive?" active":""}" data-category="${cat}"
                style="--chip-bg:${c.color};${isActive ? `background:${c.color};` : ""}"
            ><span class="chip-icon">${svg}</span>${c.text}</button>`;
        }).join("");
        catFilters.querySelectorAll("[data-category]").forEach(btn=>{
            btn.addEventListener("click",()=>{
                activeCategory=btn.dataset.category||"all";
                renderCategoryButtons(); renderEvents();
            });
        });
    }

    function isValidTaiwanCoord(lat, lng) {
        return lat >= 21.5 && lat <= 26.5 && lng >= 118.0 && lng <= 122.5;
    }

    function deduplicateEvents(events) {
        const seenTitles = new Set();
        const seenContent = new Set();
        return events.filter(ev => {
            // 把標題與內容正規化：去空白、去標點、只留文字
            const titleKey = (ev.title || ev.text || "")
                .replace(/\s+/g, "")
                .replace(/[，。！？、：；「」『』【】《》〈〉\-\.\,\!\?]/g, "")
                .slice(0, 20); // 取前20字
            
            const contentKey = (ev.content || "")
                .replace(/\s+/g, "")
                .replace(/[，。！？、：；「」『』【】《》〈〉\-\.\,\!\?]/g, "")
                .slice(0, 30); // 取前30字比對

            // 如果標題或內容其中一個重複，就視為重複事件
            if (seenTitles.has(titleKey) || (contentKey && seenContent.has(contentKey))) {
                return false;
            }

            seenTitles.add(titleKey);
            if (contentKey) seenContent.add(contentKey);
            return true;
        });
    }

    function getFilteredEvents(){
        const cityFilter = isTaiwanMode ? currentCityFilter() : "all";
        const filtered = parsedEvents.filter(ev=>{
            const lat=Number(ev.lat), lng=Number(ev.lng);
            
            // 座標無效或不在台灣直接排除
            if(!Number.isFinite(lat)||!Number.isFinite(lng)) return false;
            if(!isValidTaiwanCoord(lat, lng)) return false;

            if(activeCategory!=="all"&&ev.category!==activeCategory) return false;
            if(cityFilter!=="all"){
                if(!normalizeText(ev.city).toLowerCase().includes(cityFilter.toLowerCase())) return false;
            }
            if(searchKeyword){
                const hay=[ev.title,ev.content,ev.city,ev.source].join(" ").toLowerCase();
                if(!hay.includes(searchKeyword)) return false;
            }
            return true;
        });
        return deduplicateEvents(filtered);
    }

    // ── REACTION ────────────────────────────────────────────
    async function getReactions(eventId) {
        try {
            const res = await fetch(`/api/reaction?eventId=${eventId}`);
            return await res.json();
        } catch (e) { return { muyu: 0, candle: 0 }; }
    }

    async function sendReaction(eventId, type) {
        if (localStorage.getItem(`reacted:${eventId}`)) return;
        try {
            const res = await fetch('/api/reaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId, type })
            });
            const data = await res.json();
            localStorage.setItem(`reacted:${eventId}`, type);
            return data;
        } catch (e) { return null; }
    }

    function isMourningEvent(ev) {
        if (ev.hasCasualty !== undefined) return ev.hasCasualty;
        const keywords = ["死亡", "罹難", "身亡", "喪生", "不治", "往生", "遇難"];
        const text = (ev.title + ev.content);
        return keywords.some(k => text.includes(k));
    }

    async function updateReactionUI(eventId, container) {
        if (!container) return;
        const data = await getReactions(eventId);
        const reacted = localStorage.getItem(`reacted:${eventId}`);
        const compact = container.closest(".custom-popup") !== null;
        container.innerHTML = makeReactionBarHtml(eventId, data, reacted, compact);
    }

    window.handleReactClick = async (e, eventId, type, btn) => {
        e.stopPropagation();
        if (localStorage.getItem(`reacted:${eventId}`) || btn.classList.contains("active")) return;

        toggleReact(btn);
        if (type === "muyu") spawnMeritEffect(btn);
        if (type === "candle") btn.classList.add("candle-lit");

        const data = await sendReaction(eventId, type);
        const container = btn.closest(".reaction-container") || btn.closest(".popup-reactions-wrap");
        if (data && container) {
            await updateReactionUI(eventId, container);
        } else if (!data) {
            localStorage.removeItem(`reacted:${eventId}`);
            if (container) await updateReactionUI(eventId, container);
        }
    };

    window.handleReaction = window.handleReactClick;

    window.handleRatingClick = (e, eventId, value, btn) => {
        e.stopPropagation();
        const rating = decodeURIComponent(value);
        localStorage.setItem(`rating:${eventId}`, rating);
        const group = btn.closest(".event-actions");
        if (group) {
            group.querySelectorAll(".rating-action").forEach(action => {
                action.classList.toggle("rating-active", action === btn);
            });
        }
    };

    // ── RENDER ──────────────────────────────────────────────
    function renderEvents(){
        let events = getFilteredEvents();
        const isOnline = currentMapMode === "online";
        const config = isOnline ? TW_ONLINE_CATEGORIES : CATEGORY_CONFIG;
        const mapConfig = isOnline ? CATEGORY_MAP.online : CATEGORY_MAP.normal;

        events.sort((a,b)=>{
            const aNews=(a.source==="news"||a.source==="RSS")?1:0;
            const bNews=(b.source==="news"||b.source==="RSS")?1:0;
            return bNews-aNews;
        });

        clearRenderedMarkers();
        eventList.innerHTML="";
        updateCurationMeta(events);

        if(!events.length){
            const emptyText = isOnline ? TW_ONLINE_TEXT.emptyState : "目前沒有符合條件的事件";
            eventList.innerHTML=`<div class="empty-state"><i class="fa-solid fa-map-location-dot"></i><p>${emptyText}</p></div>`;
        }

        events.forEach(ev=>{
            const mappedCat = mapConfig[ev.category] || ev.category;
            const cat = config[mappedCat]||config.other;
            const latlng = [Number(ev.lat),Number(ev.lng)];

            // Marker
            const displayTitle = (isOnline && ev.twOnlineTitle) ? ev.twOnlineTitle : (ev.title || "未命名事件");
            const displayContent = (isOnline && ev.twOnlineContent) ? ev.twOnlineContent : (ev.content || "沒有摘要");
            const severity = getEventSeverity(ev);
            const markerStyle = resolveMarkerStyle(ev, cat.color);

            const catVisual = getCategoryVisual(ev.category);
            const pinPulse = shouldPinPulse(ev, severity);
            const popupHtml = buildPopupHtml(ev, displayTitle, displayContent, markerStyle);

            const popup = new mapboxgl.Popup({
                className: "custom-popup",
                closeButton: true,
                closeOnClick: false,
                maxWidth: "328px",
                offset: 22
            });
            enableSubpixelPositioning(popup);
            popup.setHTML(popupHtml);
            popup.on("open", () => {
                activePopup = popup;
                if (getEventInteractionType(ev) === "safety") {
                    const container = popup.getElement().querySelector(".reaction-container, .popup-reactions-wrap");
                    if (container) updateReactionUI(ev.id, container);
                }
            });
            popup.on("close", () => { if (activePopup === popup) activePopup = null; });

            const marker = new mapboxgl.Marker({
                element: makeMarkerElement(
                    markerStyle.color,
                    CAT_SVG[ev.category] || CAT_SVG.other,
                    severity,
                    markerStyle.glow,
                    pinPulse
                ),
                // 使用 0x0 的外層元素當座標錨點，圖釘視覺層再往左上位移到針尖。
                // 這樣 Mapbox 縮放/平移時只追蹤座標點，不會被 DOM 尺寸量測誤差影響。
                anchor: "center",
                offset: [0, 0]
            });
            enableSubpixelPositioning(marker);
            marker
                .setLngLat([latlng[1], latlng[0]])
                .setPopup(popup)
                .addTo(map);
            
            // Tooltip on hover
            const markerEl = marker.getElement();
            markerEl.style.cursor = "pointer";

            const tooltip = new mapboxgl.Popup({
                closeButton: false,
                closeOnClick: false,
                className: "custom-tooltip",
                offset: [0, -20],
                anchor: "bottom"
            });
            enableSubpixelPositioning(tooltip);

            markerEl.addEventListener("mouseenter", () => {
                tooltip.setLngLat([latlng[1], latlng[0]])
                    .setHTML(`<div style="font-size:12px;font-weight:700;max-width:180px;line-height:1.5;">${ev.title}</div>`)
                    .addTo(map);
            });

            markerEl.addEventListener("mouseleave", () => {
                tooltip.remove();
            });

            renderedMarkers.push(marker);

            const card = document.createElement("article");
            card.className = "event-card-v2";
            card.style.setProperty("--card-color", catVisual.color);
            card.innerHTML = buildEventCardHtml(ev, displayTitle, displayContent, catVisual);

            card.addEventListener("click",e=>{
                if(e.target instanceof HTMLElement&&(e.target.tagName==="A"||e.target.tagName==="BUTTON"||e.target.closest("button"))) return;
                closeActivePopup();
                flyToLatLng(latlng, ev.source==="TDX CMS"?14:13, 800);
                popup.addTo(map);
                if(window.innerWidth<768) newsSidebar.classList.add("drawer-collapsed");
            });

            const reportBtn=card.querySelector("[data-report]");
            if(reportBtn) reportBtn.addEventListener("click",e=>{
                e.stopPropagation();
                openReportModal(decodeURIComponent(reportBtn.dataset.report||""));
            });

            eventList.appendChild(card);
            if (getEventInteractionType(ev) === "safety") {
                updateReactionUI(ev.id, card.querySelector('.reaction-container'));
            }
        });

        const cnt=document.getElementById("mobile-count");
        if(cnt) cnt.textContent=`${events.length} 筆`;
        setStatus(`顯示 ${events.length} 筆事件`);
    }

    // ── MOCK DATA ────────────────────────────────────────────
    const MOCK_EVENTS = [
        { id:"m1", title:"國道1號南向 林口段 車輛故障", category:"traffic", city:"新北", lat:25.07, lng:121.38, source:"TDX CMS", content:"林口交流道附近有車輛故障，請用路人注意行車安全。" },
        { id:"m2", title:"台北市信義區 追撞事故",        category:"accident", city:"台北", lat:25.033, lng:121.564, source:"RSS",     content:"信義路五段發生輕微追撞，已報警處理中。" },
        { id:"m3", title:"台中市北屯區 道路施工管制",    category:"construction", city:"台中", lat:24.17, lng:120.69, source:"TDX CMS", content:"文心路四段進行路面刨除工程，預計施工至下午六點。" },
        { id:"m4", title:"花蓮縣 地震後山區道路落石",    category:"disaster", city:"花蓮", lat:23.98, lng:121.60, source:"news",    content:"蘇花公路部分路段因餘震出現落石，已進行臨時管制。" },
        { id:"m5", title:"高雄市左營區 路跑活動交通管制",category:"activity", city:"高雄", lat:22.68, lng:120.30, source:"RSS",     content:"左營大路周六上午舉辦路跑，部分路段暫停停車。" },
        { id:"m6", title:"新竹縣竹北市 水管破裂搶修",   category:"other",    city:"新竹", lat:24.83, lng:121.01, source:"news",    content:"光明六路發生自來水管破裂，施工人員緊急搶修中。" }
    ];

    // ── FETCH ────────────────────────────────────────────────
    async function syncNewsAndRender(){
        setStatus("正在抓取事件資料...");
        try{
            const res = await fetch("/api/events");
            const raw = await res.text();
            if(!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = tryParseJson(raw,[]);
            const list = Array.isArray(data)?data:[];
            parsedEvents = deduplicateEvents(list);
            renderCategoryButtons(); renderEvents();
        }catch(e){
            console.warn("API無法連線，使用展示資料",e);
            parsedEvents=deduplicateEvents(MOCK_EVENTS);
            renderCategoryButtons(); renderEvents();
            setStatus("展示模式：顯示範例資料");
        }
    }

    // ── CITY SYNC ────────────────────────────────────────────
    function syncCityFilter(value){
        document.getElementById("city-filter").value=value;
        document.getElementById("city-filter-mobile").value=value;
        drawCityBoundary(value);
        renderEvents();
        const centers={
            "台北市":[25.033,121.565],"新北市":[25.011,121.466],"基隆市":[25.128,121.739],
            "桃園市":[24.994,121.301],"新竹市":[24.814,120.968],"新竹縣":[24.828,121.013],
            "苗栗縣":[24.560,120.821],"台中市":[24.148,120.674],"彰化縣":[24.052,120.539],
            "南投縣":[23.903,120.688],"雲林縣":[23.709,120.431],"嘉義市":[23.480,120.449],
            "嘉義縣":[23.452,120.255],"台南市":[23.000,120.227],"高雄市":[22.627,120.301],
            "屏東縣":[22.672,120.486],"宜蘭縣":[24.730,121.763],"花蓮縣":[23.987,121.602],
            "台東縣":[22.758,121.144],"澎湖縣":[23.571,119.579],"金門縣":[24.449,118.376],
            "連江縣":[26.150,119.936],"國道":[24.148,120.674],"省道":[23.698,120.961],
            // match by keyword
        };
        const match = Object.keys(centers).find(k=>k.startsWith(value)||value.startsWith(k));
        if(value==="all"){
            flyToLatLng([23.698,120.961],7,1500);
        } else if(match){
            flyToLatLng(centers[match],11,1500);
        }
    }

    // ── MODE ─────────────────────────────────────────────────
    const BAR_COLORS = ['#4f8cff','#a78bfa','#34d399','#fb923c','#f05a5a','#fbbf24','#5eead4','#c4b5fd','#86efac','#fdba74']; 
 
    const CAT_COLORS = { 
      traffic:   { bg:'rgba(79,140,255,0.15)',  color:'#4f8cff',  text:'交通事故' }, 
      accident:  { bg:'rgba(79,140,255,0.15)',  color:'#4f8cff',  text:'交通事故' }, 
      disaster:  { bg:'rgba(240,90,90,0.15)',   color:'#f05a5a',  text:'災害事故' }, 
      criminal:  { bg:'rgba(240,90,90,0.15)',   color:'#f05a5a',  text:'刑事案件' }, 
      medical:   { bg:'rgba(251,146,60,0.15)',  color:'#fb923c',  text:'醫療緊急' }, 
      construction:{ bg:'rgba(251,191,36,0.15)',color:'#fbbf24',  text:'施工管制' }, 
      activity:  { bg:'rgba(52,211,153,0.15)',  color:'#34d399',  text:'活動'     }, 
      other:     { bg:'rgba(107,114,128,0.15)', color:'#6b7280',  text:'其他'     }, 
    }; 
 
    function switchMode(mode){ 
      isTaiwanMode = mode; 
      const mapEl    = document.getElementById('map'); 
      const statsEl  = document.getElementById('stats-view'); 
 
      ['btn-tw','btn-tw-mobile'].forEach(id=>{ 
        const b=document.getElementById(id); 
        if(b) b.classList.toggle('active', mode); 
      }); 
      ['btn-global','btn-global-mobile'].forEach(id=>{ 
        const b=document.getElementById(id); 
        if(b) b.classList.toggle('active', !mode); 
      }); 
 
      if(mode){ 
        mapEl.style.display   = ''; 
        statsEl.style.display = 'none'; 
        flyToLatLng(taiwanView.center, taiwanView.zoom, 800); 
        renderEvents(); 
      } else { 
        mapEl.style.display   = 'none'; 
        statsEl.style.display = 'flex'; 
        renderStatsView(); 
      } 
    } 
 
    async function renderStatsView(){ 
      const events = parsedEvents.filter(ev=>{ 
        const lat=Number(ev.lat), lng=Number(ev.lng); 
        return Number.isFinite(lat) && Number.isFinite(lng) && isValidTaiwanCoord(lat,lng); 
      }); 
      updateCurationMeta(events);
 
      // 總數 
      const totalEl = document.getElementById('stat-total'); 
      if(totalEl) totalEl.textContent = events.length; 
 
      // 城市排行 
      const cityMap = {}; 
      events.forEach(ev=>{ 
        if(!ev.city) return; 
        const city = (ev.city||'').replace(/市$|縣$/,'').slice(0,3); 
        if(!city) return; 
        cityMap[city] = (cityMap[city]||0) + 1; 
      }); 
      const sorted = Object.entries(cityMap).sort((a,b)=>b[1]-a[1]).slice(0,8); 
      const max = sorted[0]?.[1] || 1; 
      const barsEl = document.getElementById('city-bars'); 
      if(barsEl){ 
        barsEl.innerHTML = sorted.map(([city,count],i)=>` 
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:9px;"> 
            <span style="font-size:12px;color:var(--text-secondary);width:52px;text-align:right;flex-shrink:0;">${city}</span> 
            <div style="flex:1;height:7px;background:rgba(99,120,180,0.1);border-radius:4px;overflow:hidden;"> 
              <div style="height:100%;border-radius:4px;width:${Math.round(count/max*100)}%;background:${BAR_COLORS[i]};"></div> 
            </div> 
            <span style="font-size:11px;color:var(--text-muted);width:24px;">${count}</span> 
          </div> 
        `).join(''); 
      } 
 
      // Reaction 總數 
      fetch('/api/reactions/total') 
        .then(r=>r.json()) 
        .then(data=>{ 
          const m=document.getElementById('stat-muyu'); 
          const c=document.getElementById('stat-candle'); 
          if(m) m.textContent=(data.muyu||0).toLocaleString(); 
          if(c) c.textContent=(data.candle||0).toLocaleString(); 
        }) 
        .catch(()=>{ 
          const m=document.getElementById('stat-muyu'); 
          const c=document.getElementById('stat-candle'); 
          if(m) m.textContent='0'; 
          if(c) c.textContent='0'; 
        }); 
 
      // 熱門事件：逐一抓 reaction，取前4 
      const hotEl = document.getElementById('hot-events'); 
      if(!hotEl) return; 
      hotEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">載入中...</div>'; 
 
      const withReactions = await Promise.all( 
        events.map(async ev=>{ 
          try{ 
            const r = await fetch(`/api/reaction?eventId=${ev.id}`); 
            const d = await r.json(); 
            return { ...ev, muyu: d.muyu||0, candle: d.candle||0, total:(d.muyu||0)+(d.candle||0) }; 
          }catch{ 
            return { ...ev, muyu:0, candle:0, total:0 }; 
          } 
        }) 
      ); 
 
      const top4 = withReactions 
        .filter(ev=>ev.total > 0) 
        .sort((a,b)=>b.total-a.total) 
        .slice(0,4); 
 
      if(!top4.length){ 
        hotEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">尚無反應資料</div>'; 
        return; 
      } 
 
      hotEl.innerHTML = top4.map((ev,i)=>{ 
        const cat = CAT_COLORS[ev.category] || CAT_COLORS.other; 
        const title = ev.twOnlineTitle || ev.title || '未命名事件'; 
        const city  = ev.city || ''; 
        const border = i < top4.length-1 ? 'border-bottom:1px solid rgba(99,120,180,0.1);' : ''; 
        return ` 
          <div style="padding:10px 0;${border}"> 
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;"> 
              <span style="font-size:10px;font-weight:500;padding:2px 7px;border-radius:99px;background:${cat.bg};color:${cat.color};">${cat.text}</span> 
              <span style="font-size:11px;color:var(--text-secondary);">🪘 ${ev.muyu} &nbsp;🕯️ ${ev.candle}</span> 
            </div> 
            <div style="font-size:12px;color:var(--text-primary);line-height:1.55;margin-bottom:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${title}</div> 
            <div style="font-size:11px;color:var(--text-muted);">📍 ${city}</div> 
          </div> 
        `; 
      }).join(''); 
    } 


    // ── SEARCH ───────────────────────────────────────────────
    function handleSearch(e){
        searchKeyword=e.target.value.trim().toLowerCase();
        renderEvents();
    }

    // ── DRAWER ───────────────────────────────────────────────
    function toggleDrawer(){
        if(window.innerWidth<768) {
            newsSidebar.classList.toggle("drawer-collapsed");
            scheduleMapResize();
        }
    }

    // ── MOBILE GESTURES ──────────────────────────────────────
    let startY = 0;
    let isDragging = false;
    const sidebar = document.getElementById("news-sidebar");

    sidebar.addEventListener("touchstart", e => {
        if (window.innerWidth >= 768) return;
        const touch = e.touches[0];
        const sidebarTop = sidebar.getBoundingClientRect().top;
        // 只有在頂部區域 (把手附近) 才觸發拖曳
        if (touch.clientY - sidebarTop > 80) return;
        
        isDragging = true;
        startY = touch.clientY;
        sidebar.style.transition = "none";
    }, { passive: true });

    sidebar.addEventListener("touchmove", e => {
        if (!isDragging) return;
        const delta = e.touches[0].clientY - startY;
        if (delta < 0) return; // 不能往上拉超過展開位置
        sidebar.style.transform = `translateY(${delta}px)`;
        
        // 展開時防止地圖被滑動干擾
        if (!sidebar.classList.contains("drawer-collapsed")) {
            // 注意：因為使用 passive: true，這裡不能 preventDefault
            // 但我們可以透過 stopPropagation 防止事件傳到地圖層
            e.stopPropagation();
        }
    }, { passive: true });

    sidebar.addEventListener("touchend", e => {
        if (!isDragging) return;
        isDragging = false;
        sidebar.style.transition = "transform 0.3s cubic-bezier(0.32,0,0.15,1)";
        
        const delta = e.changedTouches[0].clientY - startY;
        if (delta > 80) {
            sidebar.classList.add("drawer-collapsed");
            sidebar.style.transform = "";
        } else {
            sidebar.classList.remove("drawer-collapsed");
            sidebar.style.transform = "";
        }
        scheduleMapResize();
    });

    // 點擊地圖收起抽屜
    map.on("click", () => {
        if (window.innerWidth < 768) {
            sidebar.classList.add("drawer-collapsed");
            scheduleMapResize();
        }
    });
    window.addEventListener("resize", scheduleMapResize);
    if (typeof ResizeObserver !== "undefined") {
        const layoutObserver = new ResizeObserver(() => {
            scheduleMapResize();
        });
        if (mapStage) layoutObserver.observe(mapStage);
        if (newsSidebar) layoutObserver.observe(newsSidebar);
    }
    function openReportModal(title){
        document.getElementById("report-title").value=title;
        document.getElementById("report-type").value="資料錯誤";
        document.getElementById("report-message").value="";
        reportModal.classList.add("visible");
    }
    function closeReportModal(){ reportModal.classList.remove("visible"); }

    async function submitReport(){
        const title=document.getElementById("report-title").value.trim();
        const errorType=document.getElementById("report-type").value;
        const message=document.getElementById("report-message").value.trim();
        if(!message){ alert("請填寫補充說明！"); return; }
        const btn=document.getElementById("report-submit-btn");
        btn.textContent="傳送中..."; btn.disabled=true;
        try{
            const res=await fetch("/api/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,errorType,message})});
            const result=await res.json();
            if(res.ok&&result.success){ alert("✅ 回報成功！"); closeReportModal(); }
            else throw new Error(result.error||"伺服器錯誤");
        }catch(e){ alert("❌ 回報失敗，請稍後再試。"); }
        finally{ btn.textContent="送出回報"; btn.disabled=false; }
    }

    // ── BETA MODAL ───────────────────────────────────────────
    function checkBetaModal(){
        if(!localStorage.getItem("beta_accepted")) betaModal.classList.add("visible");
    }
    function closeBetaModal(){
        localStorage.setItem("beta_accepted","true");
        betaModal.classList.remove("visible");
    }

    // ── DONATE ───────────────────────────────────────────────
    async function handleDonate(amount, btn){
        try{
            const orig=btn.innerHTML;
            btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> 準備金流...'; btn.disabled=true;
            const res=await fetch('/api/create-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount,itemName:`幫地圖加油 ${amount} 元`})});
            if(!res.ok) throw new Error();
            const html=await res.text();
            const div=document.createElement('div'); div.innerHTML=html;
            document.body.appendChild(div); div.querySelector('form').submit();
        }catch(e){
            alert('金流初始化失敗，請確認後端設定。');
            btn.innerHTML='⛽ 幫地圖加油'; btn.disabled=false;
        }
    }

    // ── EVENTS ───────────────────────────────────────────────
    window.openReportModal=openReportModal;

    document.getElementById("event-search").addEventListener("input",handleSearch);
    document.getElementById("event-search-mobile").addEventListener("input",handleSearch);
    document.getElementById("city-filter").addEventListener("change",e=>syncCityFilter(e.target.value));
    document.getElementById("city-filter-mobile").addEventListener("change",e=>syncCityFilter(e.target.value));
    document.getElementById("btn-tw").addEventListener("click",()=>switchMode(true));
    document.getElementById("btn-global").addEventListener("click",()=>switchMode(false));
    document.getElementById("btn-tw-mobile").addEventListener("click",()=>switchMode(true));
    document.getElementById("btn-global-mobile").addEventListener("click",()=>switchMode(false));
    document.getElementById("btn-dark").addEventListener("click",()=>switchTheme("dark"));
    document.getElementById("btn-light").addEventListener("click",()=>switchTheme("light"));
    document.getElementById("btn-dark-mobile").addEventListener("click",()=>switchTheme("dark"));
    document.getElementById("btn-light-mobile").addEventListener("click",()=>switchTheme("light"));
    document.getElementById("drawer-handle").addEventListener("click",toggleDrawer);
    document.getElementById("report-cancel-btn").addEventListener("click",closeReportModal);
    document.getElementById("report-submit-btn").addEventListener("click",submitReport);
    
    document.getElementById("mode-normal-btn")?.addEventListener("click", () => {
        applyMapMode("normal");
        closeBetaModal();
    });
    document.getElementById("mode-online-btn")?.addEventListener("click", () => {
        applyMapMode("online");
        closeBetaModal();
    });
    document.getElementById("settings-btn").addEventListener("click", () => {
        settingsModal.classList.add("visible");
    });
    document.getElementById("settings-close-btn").addEventListener("click", () => {
        settingsModal.classList.remove("visible");
    });
    document.getElementById("map-mode-select").addEventListener("change", (e) => {
        applyMapMode(e.target.value);
    });

    document.getElementById("beta-close-btn")?.addEventListener("click",closeBetaModal);
    reportModal.addEventListener("click",e=>{ if(e.target===reportModal) closeReportModal(); });
    betaModal.addEventListener("click",e=>{ if(e.target===betaModal) closeBetaModal(); });

    document.addEventListener("DOMContentLoaded",()=>{
        populateCityFilters();
        removeMapOverlays();
        checkBetaModal();
        applyMapMode(currentMapMode); // 套用快取的模式
        syncNewsAndRender();
        loadTwGeoJSON();
    });
