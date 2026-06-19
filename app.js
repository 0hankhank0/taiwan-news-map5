// ?? CONFIG ??????????????????????????????????????????????
    const MAPBOX_TOKEN = "pk.eyJ1IjoiaGFua2hhbmsiLCJhIjoiY21wNWhmNHNiMDJxMzJycjB4a3FmNDY0biJ9.FK_qTU4xvkvvYq1Ze8WC4g"; 
    const MOBILE_EVENT_CARD_LIMIT = 24;
    const MOBILE_MARKER_LIMIT = 50;
    
    // 瑼Ｘ Mapbox Token ?臬??
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
        all:      { text: "全部事件", icon: "fa-list", color: "#64748B" },
        traffic:  { text: "交通", icon: "fa-car-burst", color: "#2F80ED" },
        disaster: { text: "災害", icon: "fa-triangle-exclamation", color: "#C0392B" },
        accident: { text: "意外", icon: "fa-kit-medical", color: "#F97316" },
        activity: { text: "活動", icon: "fa-users", color: "#22C55E" },
        other:    { text: "其他", icon: "fa-circle-info", color: "#64748B" }
    };

    const ALERT_COLOR_MAP = {
        traffic:  { color: "#2471A3", glow: "rgba(36, 113, 163, 0.45)" },
        fire:     { color: "#D35400", glow: "rgba(211, 84, 0, 0.42)" },
        arson:    { color: "#C0392B", glow: "rgba(192, 57, 43, 0.45)" },
        disaster: { color: "#C0392B", glow: "rgba(192, 57, 43, 0.4)" },
    };

    function getEventAlertType(ev) {
        const text = normalizeText(`${ev.title || ""} ${ev.content || ""}`);
        if (text.includes("縱火")) return "arson";
        if (["火災", "失火", "爆炸", "起火"].some(keyword => text.includes(keyword))) return "fire";
        if (ev.category === "traffic" || ev.category === "construction") return "traffic";
        if (["disaster", "earthquake", "typhoon"].includes(ev.category)) return "disaster";
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
        const urgentText = normalizeText(`${ev.title || ""} ${ev.content || ""}`);
        const urgent = ["緊急", "重大", "警戒", "死亡", "傷亡", "救援"].some(keyword => urgentText.includes(keyword));
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
        incense: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5c-1.5 1-1.5 2.2 0 3.2s1.5 2.2 0 3.2"/><path d="M12 4c-1.5 1.1-1.5 2.4 0 3.5s1.5 2.4 0 3.5"/><path d="M16 5c-1.5 1-1.5 2.2 0 3.2s1.5 2.2 0 3.2"/><line x1="9" y1="12" x2="9" y2="21"/><line x1="12" y1="12" x2="12" y2="21"/><line x1="15" y1="12" x2="15" y2="21"/><line x1="7" y1="21" x2="17" y2="21"/></svg>`,
    };

    function getEventCategoryText(ev) {
        if (!ev || typeof ev !== "object") return "";
        return normalizeText([ev.title, ev.summary, ev.content, ev.text, ev.location, ev.city, ev.source].filter(Boolean).join(" ")).toLowerCase();
    }

    function inferEventGroupCategory(ev) {
        const raw = normalizeText(typeof ev === "string" ? ev : (ev?.category || ev?.groupCategory || ev?.type || "other")).toLowerCase();
        const mapped = CATEGORY_GROUP_MAP[raw] || raw || "other";
        const text = typeof ev === "object" ? getEventCategoryText(ev) : "";

        if (["activity", "event", "market", "exhibition", "sports"].includes(raw) || /(活動|展覽|市集|演唱會|球賽|賽事|路跑|表演|節慶)/.test(text)) return "activity";
        if (["disaster", "earthquake", "typhoon", "weather", "climate"].includes(raw) || /(地震|颱風|豪雨|大雨|淹水|積水|土石流|落石|坍方|災害|災情|強風|停班停課)/.test(text)) return "disaster";
        if (["traffic", "construction", "road", "congestion", "jam"].includes(raw)) {
            if (/(車禍|交通事故|追撞|擦撞|對撞|自撞|撞上|翻車|摔車|肇事|事故.*(傷|死|送醫)|死亡|傷亡)/.test(text)) return "accident";
            return "traffic";
        }
        if (["accident", "incident", "safety", "criminal", "medical", "fire", "arson", "publicsafety", "public-safety"].includes(raw) || /(意外|事故|傷亡|死亡|送醫|火災|火警|爆炸|氣爆|工安|墜落|溺水|刑案|搶劫|殺人|攻擊)/.test(text)) return "accident";
        if (mapped === "all") return "all";
        return ["traffic", "disaster", "accident", "activity", "other"].includes(mapped) ? mapped : "other";
    }

    function getGroupCategory(category) {
        return inferEventGroupCategory(category);
    }

    function getCategoryVisual(category) {
        const isOnline = currentMapMode === "online";
        const config = isOnline ? TW_ONLINE_CATEGORIES : CATEGORY_CONFIG;
        const mappedCat = inferEventGroupCategory(category);
        const c = config[mappedCat] || config.other;
        const meta = CAT_META[mappedCat] || CAT_META.other;
        return { ...c, mappedCat, meta, color: c.color };
    }

    function getCategoryDetailLabel(category) {
        const detail = SUBCATEGORY_LABELS[category] || SUBCATEGORY_LABELS.other;
        const group = getCategoryVisual(category)?.text || "其他";
        if (detail === group) return group;
        return `${group}｜${detail}`;
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
        const svg = CAT_SVG[mappedCat] || CAT_SVG[category] || CAT_SVG.other;
        return `<span class="cat-badge-v2" style="background:rgba(${meta.rgba},0.15);border:1px solid rgba(${meta.rgba},0.3);color:${meta.tint};"><span class="badge-svg-icon">${svg}</span>${text}</span>`;
    }

    function makeSrcBadgeV2(source) {
        const normalized = normalizeSource(source);
        const c = SOURCE_CONFIG[normalized] || SOURCE_CONFIG.default;
        const t = c.shortText || c.text;
        return `<span class="src-badge-v2" style="background:${c.bg};color:${c.color};border:1px solid ${c.color}33;">${t}</span>`;
    }

    const MAJOR_INCIDENT_KEYWORDS = [
        "死亡", "一死", "二死", "三死", "一死一傷", "傷亡", "重傷", "送醫", "搜救",
        "墜落", "溺水", "火災", "爆炸", "倒塌", "重大事故", "工安"
    ];
    const MAJOR_INCIDENT_CATEGORIES = new Set(["accident", "incident", "safety"]);

    function getEventTextForMatch(ev) {
        return [ev.title, ev.summary, ev.content].map(v => normalizeText(v)).join(" ");
    }

    function isMajorIncidentEvent(ev) {
        const rawCategory = normalizeText(ev.category || "").toLowerCase();
        const groupCategory = normalizeText(ev.groupCategory || getGroupCategory(rawCategory)).toLowerCase();
        if (["activity", "sports", "weather"].includes(groupCategory) || ["activity", "sports", "weather"].includes(rawCategory)) {
            return false;
        }
        const inMajorCategory =
            groupCategory === "accident" ||
            rawCategory === "accident" ||
            rawCategory === "incident" ||
            rawCategory === "safety";
        const text = getEventTextForMatch(ev);
        const keywordHit = MAJOR_INCIDENT_KEYWORDS.some(keyword => text.includes(keyword));
        if (keywordHit) return true;
        if (!inMajorCategory) return false;
        if (getEventSeverity(ev) >= 4) return true;
        return normalizeText(ev.impactLevel).includes("重大");
    }

    function isSafetyEvent(ev) {
        return isMajorIncidentEvent(ev);
    }
    function isTrafficEvent(ev) {
        const rawCategory = normalizeText(ev?.category || "").toLowerCase();
        const groupCategory = normalizeText(ev?.groupCategory || getGroupCategory(rawCategory)).toLowerCase();
        return groupCategory === "traffic" || ["traffic", "construction"].includes(rawCategory);
    }
    function isActivityEvent(ev) {
        const rawCategory = normalizeText(ev?.category || "").toLowerCase();
        const groupCategory = normalizeText(ev?.groupCategory || getGroupCategory(rawCategory)).toLowerCase();
        return groupCategory === "activity" || rawCategory === "activity";
    }
    function isSportsEvent(ev) {
        const rawCategory = normalizeText(ev?.category || "").toLowerCase();
        const groupCategory = normalizeText(ev?.groupCategory || getGroupCategory(rawCategory)).toLowerCase();
        return groupCategory === "sports" || rawCategory === "sports";
    }
    function isWeatherLayerEvent(ev) {
        const rawCategory = normalizeText(ev?.category || "").toLowerCase();
        const groupCategory = normalizeText(ev?.groupCategory || getGroupCategory(rawCategory)).toLowerCase();
        return groupCategory === "weather" || rawCategory === "weather";
    }

    function makeReactionBarHtml(eventId, data, reacted, compact = false) {
        const muyuActive = reacted === "muyu";
        const compactCls = compact ? " react-btn--compact" : "";
        const muyuCount = muyuActive ? `✔ ${data.muyu}` : String(data.muyu || 0);
        const total = data.muyu || 0;
        const totalLabel = reacted ? "已回應" : `${total.toLocaleString()} 人已關注`;

        return `
            <div class="reaction-bar" data-event-id="${eventId}">
                <button type="button" class="react-btn muyu${muyuActive ? " active" : ""}${compactCls}"
                    onclick="handleReactClick(event, '${eventId}', 'muyu', this)"
                    ${reacted && !muyuActive ? "disabled" : ""}>
                    ${REACT_SVG.muyu}
                    <span>敲木魚</span>
                    <span class="react-count">${muyuCount}</span>
                </button>
                <span class="react-total">${totalLabel}</span>
            </div>`;
    }

    function toggleReact(btn) {
        if (btn.classList.contains("active")) return;
        btn.classList.add("active");
        const countEl = btn.querySelector(".react-count");
        if (countEl) {
            const n = parseInt(countEl.textContent.replace(/\D/g, ""), 10) || 0;
            countEl.textContent = "✔ " + (n + 1);
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
        siteTitle: "島嶼脈搏 Island Pulse",
        siteSubtitle: "TW Online 視覺模式",
        statusPrefix: "TW Online 視覺層",
        listTitle: "台灣即時事件清單",
        searchPlaceholder: "搜尋事件、城市或關鍵字",
        emptyState: "目前沒有符合條件的台灣即時事件地圖資料",
        loadingState: "正在同步事件資料...",
        serverStatus: "視覺模式啟用中",
        playerCount: "Concept Demo"
    };

    const TW_ONLINE_CATEGORIES = {
        all:          { text: "全部事件", icon: "fa-list", color: "#94a3b8" },
        traffic:      { text: "交通",     icon: "fa-car-side", color: "#60a5fa" },
        accident:     { text: "意外",     icon: "fa-kit-medical", color: "#f97316" },
        construction: { text: "交通",     icon: "fa-wrench", color: "#fb923c" },
        disaster:     { text: "災害",     icon: "fa-triangle-exclamation", color: "#ef4444" },
        weather:      { text: "災害",     icon: "fa-cloud-sun-rain", color: "#38bdf8" },
        activity:     { text: "活動",     icon: "fa-calendar-days", color: "#34d399" },
        event:        { text: "活動",     icon: "fa-calendar-days", color: "#34d399" },
        market:       { text: "活動",     icon: "fa-store", color: "#34d399" },
        exhibition:   { text: "活動",     icon: "fa-images", color: "#34d399" },
        sports:       { text: "活動",     icon: "fa-medal", color: "#a78bfa" },
        other:        { text: "其他",     icon: "fa-circle-info", color: "#6b7280" }
    };

    const CATEGORY_GROUP_MAP = {
        all: "all",
        traffic: "traffic",
        road: "traffic",
        congestion: "traffic",
        jam: "traffic",
        construction: "traffic",
        roadwork: "traffic",
        accident: "accident",
        incident: "accident",
        safety: "accident",
        criminal: "accident",
        medical: "accident",
        fire: "accident",
        arson: "accident",
        publicsafety: "accident",
        "public-safety": "accident",
        disaster: "disaster",
        earthquake: "disaster",
        typhoon: "disaster",
        climate: "disaster",
        weather: "disaster",
        activity: "activity",
        event: "activity",
        market: "activity",
        exhibition: "activity",
        sports: "activity",
        other: "other"
    };

    const SUBCATEGORY_LABELS = {
        traffic: "交通",
        construction: "施工",
        accident: "意外",
        incident: "意外事件",
        safety: "公共安全",
        criminal: "刑案",
        medical: "醫療",
        fire: "火災",
        disaster: "災害",
        earthquake: "環境圖層",
        typhoon: "環境圖層",
        weather: "環境圖層",
        climate: "環境圖層",
        activity: "活動",
        event: "活動",
        market: "活動",
        exhibition: "活動",
        sports: "活動",
        other: "其他"
    };

    const CATEGORY_MAP = {
        normal: { ...CATEGORY_GROUP_MAP },
        online: { ...CATEGORY_GROUP_MAP }
    };

    const FIXED_CATEGORY_ORDER = ["all", "traffic", "disaster", "accident", "activity", "other"];
    const FORTUNE_CATEGORY_ORDER = ["all", "great-risk", "risk", "good", "great-good"];
    const FORTUNE_CONFIG = {
        "great-risk": { label: "大凶", color: "#EF4444", icon: "fa-triangle-exclamation", actionText: "持續注意" },
        risk: { label: "凶", color: "#F97316", icon: "fa-circle-exclamation", actionText: "已避開" },
        good: { label: "吉", color: "#22C55E", icon: "fa-seedling", actionText: "想前往" },
        "great-good": { label: "大吉", color: "#FACC15", icon: "fa-star", actionText: "值得看看" }
    };
    const FORTUNE_GOOD_CATEGORIES = new Set(["activity", "event", "market", "exhibition", "sports", "good_weather"]);
    const FORTUNE_RISK_CATEGORIES = new Set([
        "traffic", "accident", "disaster", "construction", "fire", "criminal", "medical",
        "incident", "safety", "weather", "earthquake", "typhoon", "publicsafety", "public-safety"
    ]);

    const SOURCE_CONFIG = {
        "TDX CMS": { text:"TDX 交通資料", shortText:"TDX",  bg:"rgba(15,118,110,0.2)", color:"#5eead4" },
        RSS:        { text:"RSS 事件資料", shortText:"RSS",  bg:"rgba(29,78,216,0.2)",  color:"#93c5fd" },
        news:       { text:"公共事件資料", shortText:"資料",   bg:"rgba(124,58,237,0.2)", color:"#c4b5fd" },
        default:    { text:"展示資料", shortText:"展示", bg:"rgba(71,85,105,0.25)", color:"#94a3b8" }
    };

    Object.assign(SOURCE_CONFIG, {
        "Concept Demo": { text: "Concept Demo", shortText: "Demo", bg: "rgba(47,128,237,0.16)", color: "#93c5fd" },
        default: { text: "Concept Demo", shortText: "Demo", bg: "rgba(71,85,105,0.25)", color: "#94a3b8" }
    });

    Object.assign(CAT_SVG, {
        accident: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
        construction: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-3 3-3-3 3-3z"/></svg>`,
        weather: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H8a5 5 0 11.7-9.95A6 6 0 0120 11.5 3.75 3.75 0 0117.5 19z"/><path d="M8 22l1-2"/><path d="M13 22l1-2"/><path d="M18 22l1-2"/></svg>`,
        typhoon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 018.6 6.4c-3.1-2.6-7.8-1.6-9.6 1.7A5 5 0 116.2 5.4 8.9 8.9 0 0112 3z"/><path d="M12 21a9 9 0 01-8.6-6.4c3.1 2.6 7.8 1.6 9.6-1.7a5 5 0 114.8 5.7A8.9 8.9 0 0112 21z"/></svg>`,
        earthquake: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-6 4 12 2-6h6"/><path d="M5 20l3-3"/><path d="M16 7l3-3"/></svg>`,
        sports: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M6.5 5.5c2.5 2.2 3.8 5 3.7 8.4"/><path d="M17.5 18.5c-2.5-2.2-3.8-5-3.7-8.4"/><path d="M4.5 14.5c4-1.2 8.9-1.1 15 .3"/></svg>`,
        safety: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.7-2.8 8.4-7 10-4.2-1.6-7-5.3-7-10V6l7-3z"/><path d="M9 12l2 2 4-5"/></svg>`,
    });

    Object.assign(CATEGORY_CONFIG, {
        all: { text: "全部事件", icon: "fa-list", color: "#64748B" },
        traffic: { text: "交通", icon: "fa-car-burst", color: "#2F80ED" },
        disaster: { text: "災害", icon: "fa-triangle-exclamation", color: "#C0392B" },
        accident: { text: "意外", icon: "fa-kit-medical", color: "#F97316" },
        activity: { text: "活動", icon: "fa-users", color: "#22C55E" },
        other: { text: "其他", icon: "fa-circle-info", color: "#64748B" }
    });

    Object.assign(CAT_META, {
        traffic: { rgba: "47,128,237", tint: "#93C5FD", cssVar: "--cat-traffic" },
        accident: { rgba: "249,115,22", tint: "#FDBA74", cssVar: "--cat-accident" },
        disaster: { rgba: "192,57,43", tint: "#E8856A", cssVar: "--cat-disaster" },
        weather: { rgba: "192,57,43", tint: "#E8856A", cssVar: "--cat-disaster" },
        activity: { rgba: "34,197,94", tint: "#86EFAC", cssVar: "--cat-activity" },
        sports: { rgba: "34,197,94", tint: "#86EFAC", cssVar: "--cat-activity" },
        other: { rgba: "100,116,139", tint: "#CBD5E1", cssVar: "--cat-other" },
    });

    const CITY_OPTIONS = [
        { value: "台北市", label: "台北市" }, { value: "新北市", label: "新北市" }, { value: "基隆市", label: "基隆市" },
        { value: "桃園市", label: "桃園市" }, { value: "新竹市", label: "新竹市" }, { value: "新竹縣", label: "新竹縣" },
        { value: "苗栗縣", label: "苗栗縣" }, { value: "台中市", label: "台中市" }, { value: "彰化縣", label: "彰化縣" },
        { value: "南投縣", label: "南投縣" }, { value: "雲林縣", label: "雲林縣" }, { value: "嘉義市", label: "嘉義市" },
        { value: "嘉義縣", label: "嘉義縣" }, { value: "台南市", label: "台南市" }, { value: "高雄市", label: "高雄市" },
        { value: "屏東縣", label: "屏東縣" }, { value: "宜蘭縣", label: "宜蘭縣" }, { value: "花蓮縣", label: "花蓮縣" },
        { value: "台東縣", label: "台東縣" }, { value: "澎湖縣", label: "澎湖縣" }, { value: "金門縣", label: "金門縣" },
        { value: "連江縣", label: "連江縣" }
    ];

    const taiwanView = { center:[23.6,120.9], zoom:7 };
    const globalView = { center:[20,0], zoom:2 };
    const EMPTY_GEOJSON = { type:"FeatureCollection", features:[] };

    let parsedEvents = [];
    let dataSyncState = {
        status: "loading",
        total: 0,
        lastUpdated: "",
        sources: [],
        store: "",
        message: "正在同步事件資料"
    };
    let activeCategory = "all";
    let searchKeyword = "";
    let isTaiwanMode = true;
    let twGeoJSON = null;
    let activePopup = null;
    let currentReportEvent = null;
    let reportCloseTimer = null;
    let activeDemoType = null;
    let demoInfoCard = null;
    let demoLayerControl = null;
    let mobileFilterSummary = null;
    let lastRenderedEventCount = 0;
    let mobileFilterScrollTicking = false;
    let mobileFilterManualExpand = false;
    let mobileFilterManualAnchor = 0;
    const eventRegistry = new Map();
    const renderedMarkers = [];
    const demoLayers = new Set();
    const demoSources = new Set();
    const demoMarkers = [];

    function getEventTimestampValue(ev) {
        const raw = ev?.updatedAt || ev?.publishedAt || ev?.time || ev?.createdAt || ev?.startsAt || ev?.startAt;
        const timestamp = Date.parse(raw || "");
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    function formatDataTimestamp(value) {
        const timestamp = typeof value === "number" ? value : Date.parse(value || "");
        if (!Number.isFinite(timestamp) || timestamp <= 0) return "尚無更新時間";
        return new Date(timestamp).toLocaleString("zh-TW", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        });
    }

    function formatRelativeTime(value) {
        const timestamp = typeof value === "number" ? value : Date.parse(value || "");
        if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
        const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
        if (diffMinutes < 1) return "剛剛更新";
        if (diffMinutes < 60) return `${diffMinutes} 分鐘前`;
        const hours = Math.round(diffMinutes / 60);
        if (hours < 24) return `${hours} 小時前`;
        return `${Math.round(hours / 24)} 天前`;
    }

    function getEventSourceLabel(ev) {
        const source = normalizeText(ev?.sourceName || ev?.source);
        if (!source) return "來源未標示";
        if (/concept demo|island pulse/i.test(source)) return "展示資料";
        if (/tdx/i.test(source)) return "TDX 交通資料";
        if (/rss/i.test(source)) return "RSS 新聞";
        if (/news/i.test(source)) return "新聞資料";
        return source;
    }

    function getEventTrustMeta(ev) {
        const timestamp = getEventTimestampValue(ev);
        const relative = formatRelativeTime(timestamp);
        return {
            source: getEventSourceLabel(ev),
            updated: timestamp ? formatDataTimestamp(timestamp) : "時間未標示",
            relative
        };
    }

    function readHeaderList(headers, name) {
        const raw = headers.get(name) || "";
        if (!raw) return [];
        return decodeURIComponent(raw)
            .split(",")
            .map(item => item.trim())
            .filter(Boolean);
    }

    function buildDataStateFromEvents(events, fallback = {}) {
        const newest = events
            .map(getEventTimestampValue)
            .filter(Boolean)
            .sort((a, b) => b - a)[0] || "";
        const sources = Array.from(new Set(events.map(getEventSourceLabel).filter(Boolean))).slice(0, 6);
        return {
            status: events.length ? "ready" : "empty",
            total: events.length,
            lastUpdated: newest ? new Date(newest).toISOString() : "",
            sources,
            store: fallback.store || "",
            message: events.length ? "事件資料已同步" : "資料源目前沒有回傳事件",
            ...fallback
        };
    }

    function setDataSyncState(nextState = {}) {
        dataSyncState = { ...dataSyncState, ...nextState };
        updateDataTrustPanel(lastRenderedEventCount);
    }

    function ensureDataTrustPanel() {
        const header = newsSidebar?.querySelector(".sidebar-header");
        if (!header) return null;
        let panel = document.getElementById("data-trust-panel");
        if (!panel) {
            panel = document.createElement("div");
            panel.id = "data-trust-panel";
            panel.className = "data-trust-panel";
            const kpis = header.querySelector(".sidebar-kpis");
            if (kpis?.nextSibling) header.insertBefore(panel, kpis.nextSibling);
            else header.appendChild(panel);
        }
        return panel;
    }

    function updateDataTrustPanel(visibleCount = lastRenderedEventCount) {
        const panel = ensureDataTrustPanel();
        if (!panel) return;
        const lastUpdated = dataSyncState.lastUpdated ? formatDataTimestamp(dataSyncState.lastUpdated) : "尚無更新時間";
        const relative = dataSyncState.lastUpdated ? formatRelativeTime(dataSyncState.lastUpdated) : "";
        const sourceLabel = dataSyncState.sources?.length ? dataSyncState.sources.slice(0, 3).join("、") : "尚無來源";
        const statusLabel = {
            loading: "同步中",
            ready: "已同步",
            empty: "目前無資料",
            error: "讀取異常",
            demo: "展示資料"
        }[dataSyncState.status] || "資料狀態";
        panel.dataset.status = dataSyncState.status || "loading";
        panel.innerHTML = `
            <div class="data-trust-main">
                <span class="data-trust-dot"></span>
                <strong>${statusLabel}</strong>
                <span>${dataSyncState.message || ""}</span>
            </div>
            <div class="data-trust-grid">
                <span>顯示 ${Number(visibleCount || 0).toLocaleString()} / ${Number(dataSyncState.total || 0).toLocaleString()} 筆</span>
                <span>更新 ${lastUpdated}${relative ? `（${relative}）` : ""}</span>
                <span>來源 ${sourceLabel}</span>
            </div>`;
    }

    // ?? THEME ???????????????????????????????????????????????
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

    // ?? MAP INIT ????????????????????????????????????????????
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
        if (userLocation) drawUserLocationOverlay();
        if (activeDemoType) {
            window.setTimeout(() => showDemoLayer(activeDemoType), 0);
        }
    });

    map.on('error', (e) => {
        if (e.error?.status === 401 || e.error?.status === 403) {
            console.warn('Mapbox token invalid, switched to Leaflet fallback.');
            map.remove();
            fallbackToLeaflet();
            if (demoLayerControl) demoLayerControl.hidden = true;
        }
    });

    function fallbackToLeaflet() {
        const fallbackMap = L.map('map').setView([23.5, 121], 7);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(fallbackMap);
        window._fallbackMap = fallbackMap;
        if (parsedEvents.length) {
            parsedEvents.forEach(ev => {
                const latlng = [Number(ev.lat), Number(ev.lng)];
                if (Number.isFinite(latlng[0]) && Number.isFinite(latlng[1])) {
                    const severity = getEventSeverity(ev);
                    const cat = getCategoryVisual(ev.category);
                    const markerStyle = resolveMarkerStyle(ev, cat.color);
                    const displayTitle = ev.title || "未命名事件";
                    const displayContent = getEventSummary(ev);
                    const element = makeMarkerElement(
                        markerStyle.color,
                        CAT_SVG[inferEventGroupCategory(ev)] || CAT_SVG.other,
                        severity,
                        markerStyle.glow,
                        shouldPinPulse(ev, severity)
                    );
                    const pinW = Number(element.dataset.pinWidth) || 45;
                    const pinH = Number(element.dataset.pinHeight) || 65;
                    const marker = L.marker([latlng[0], latlng[1]], {
                        icon: L.divIcon({
                            html: element.outerHTML,
                            className: "leaflet-demo-pin",
                            iconSize: [0, 0],
                            iconAnchor: [0, 0],
                            popupAnchor: [0, -pinH]
                        })
                    }).addTo(fallbackMap)
                        .bindPopup(buildPopupHtml(ev, displayTitle, displayContent, markerStyle), {
                            className: "custom-popup",
                            maxWidth: 328
                        });
                    renderedMarkers.push(marker);
                }
            });
        }
    }

    function initBaseMaps() {
        console.log("初始化地圖設定完成");
    }

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("load", async () => {
        console.log("地圖載入完成，初始化資料...");
        
        // 瑼Ｘ葫 Mapbox Token
        checkMapboxToken().then(valid => {
            isMapboxValid = valid;
            if (!valid) {
                ["btn-dark", "btn-dark-mobile"].forEach(id => {
                    const b = document.getElementById(id);
                    if (b) {
                        b.disabled = true;
                        b.textContent = id.includes("mobile") ? "深色不可用" : "深色不可用";
                    }
                });
            }
        });

        ensureBoundaryLayer();
        drawCityBoundary(currentCityFilter());
        applyMapMode(currentMapMode); // 依目前模式套用底圖與介面文案。
        if(parsedEvents.length) renderEvents();
        createDemoLayerControl();
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
    const mobileTopbar = document.getElementById("mobile-topbar");

    let currentMapMode = "normal";
    let isNearbyMode = false;
    let userLocation = null;
    let nearbyEventsCache = [];
    let nearbyRadiusMeters = 500;
    let userLocationMarker = null;
    let userLocationCircle = null;
    const MAPBOX_USER_SOURCE_ID = "user-location-source";
    const MAPBOX_USER_CIRCLE_SOURCE_ID = "user-location-circle-source";
    const MAPBOX_USER_CIRCLE_FILL_ID = "user-location-circle-fill";
    const MAPBOX_USER_CIRCLE_LINE_ID = "user-location-circle-line";

    const DEMO_LAYER_IDS = [
        "demo-earthquake-zone",
        "demo-earthquake-ring",
        "demo-earthquake-epicenter",
        "demo-earthquake-label",
        "demo-typhoon-wind-radius",
        "demo-typhoon-path",
        "demo-typhoon-center",
        "demo-typhoon-forecast",
        "demo-typhoon-label",
        "demo-weather-zone",
        "demo-weather-alert",
        "demo-weather-marker",
    ];

    const DEMO_SOURCE_IDS = [
        "demo-earthquake-zone",
        "demo-earthquake-ring",
        "demo-earthquake-epicenter",
        "demo-earthquake-label",
        "demo-typhoon-wind-radius",
        "demo-typhoon-path",
        "demo-typhoon-center",
        "demo-typhoon-forecast",
        "demo-typhoon-label",
        "demo-weather-zone",
        "demo-weather-alert",
        "demo-weather-marker",
    ];

    function makeCirclePolygon(center, radius, steps = 64) {
        const [lng, lat] = center;
        const coords = [];
        for (let i = 0; i <= steps; i += 1) {
            const angle = (i / steps) * Math.PI * 2;
            coords.push([
                lng + Math.cos(angle) * radius,
                lat + Math.sin(angle) * radius * 0.82,
            ]);
        }
        return coords;
    }

    function makeEllipsePolygon(center, radiusLng, radiusLat, rotationDeg = 0, steps = 72) {
        const [lng, lat] = center;
        const rot = (rotationDeg * Math.PI) / 180;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const coords = [];
        for (let i = 0; i <= steps; i += 1) {
            const t = (i / steps) * Math.PI * 2;
            const x = Math.cos(t) * radiusLng;
            const y = Math.sin(t) * radiusLat;
            coords.push([
                lng + x * cos - y * sin,
                lat + x * sin + y * cos
            ]);
        }
        return coords;
    }

    const DEMO_DATA = {
        earthquake: {
            info: {
                title: "地震 Demo",
                tone: "earthquake",
                rows: ["規模 M5.8", "深度 12 km", "花蓮近海", "更新 07:42"],
            },
            epicenter: {
                type: "FeatureCollection",
                features: [{ type: "Feature", properties: { label: "震央" }, geometry: { type: "Point", coordinates: [121.72, 24.02] } }],
            },
            label: {
                type: "FeatureCollection",
                features: [{ type: "Feature", properties: { label: "M 5.6 花蓮近海" }, geometry: { type: "Point", coordinates: [121.78, 24.06] } }],
            },
            ring: {
                type: "FeatureCollection",
                features: [
                    { type: "Feature", properties: { radius: 28, opacity: 0.55 }, geometry: { type: "Point", coordinates: [121.72, 24.02] } },
                    { type: "Feature", properties: { radius: 48, opacity: 0.48 }, geometry: { type: "Point", coordinates: [121.72, 24.02] } },
                    { type: "Feature", properties: { radius: 72, opacity: 0.42 }, geometry: { type: "Point", coordinates: [121.72, 24.02] } },
                    { type: "Feature", properties: { radius: 104, opacity: 0.36 }, geometry: { type: "Point", coordinates: [121.72, 24.02] } },
                ],
            },
            zone: {
                type: "FeatureCollection",
                features: [{ type: "Feature", properties: { radius: 126 }, geometry: { type: "Point", coordinates: [121.72, 24.02] } }],
            },
        },
        typhoon: {
            info: {
                title: "颱風 Demo",
                tone: "typhoon",
                rows: ["颱風預測路徑", "風圈範圍", "未來 48 小時", "持續更新"],
            },
            center: {
                type: "FeatureCollection",
                features: [{ type: "Feature", properties: { label: "Demo Typhoon" }, geometry: { type: "Point", coordinates: [123.25, 21.55] } }],
            },
            path: {
                type: "FeatureCollection",
                features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[126.2, 18.7], [125.0, 19.6], [124.1, 20.55], [123.25, 21.55], [122.25, 22.35], [121.35, 22.75]] } }],
            },
            windRadius: {
                type: "FeatureCollection",
                features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [makeCirclePolygon([123.25, 21.55], 1.2)] } }],
            },
            forecast: {
                type: "FeatureCollection",
                features: [
                    { type: "Feature", properties: { hour: "12h" }, geometry: { type: "Point", coordinates: [122.25, 22.35] } },
                    { type: "Feature", properties: { hour: "24h" }, geometry: { type: "Point", coordinates: [121.35, 22.75] } },
                    { type: "Feature", properties: { hour: "36h" }, geometry: { type: "Point", coordinates: [120.7, 23.25] } },
                    { type: "Feature", properties: { hour: "48h" }, geometry: { type: "Point", coordinates: [120.15, 23.9] } }
                ]
            },
            label: {
                type: "FeatureCollection",
                features: [{ type: "Feature", properties: { label: "颱風預測路徑" }, geometry: { type: "Point", coordinates: [122.6, 22.2] } }]
            },
        },
        weather: {
            info: {
                title: "天氣 Demo",
                tone: "weather",
                rows: ["北部降雨區", "降雨機率 70%", "高溫 33°C", "午後雷陣雨提醒"],
            },
            zone: {
                type: "FeatureCollection",
                features: [
                    { type: "Feature", properties: { level: "rain" }, geometry: { type: "Polygon", coordinates: [makeEllipsePolygon([121.45, 25.0], 0.88, 0.42, -16)] } },
                    { type: "Feature", properties: { level: "rain" }, geometry: { type: "Polygon", coordinates: [makeEllipsePolygon([121.85, 23.95], 1.02, 0.56, 22)] } },
                    { type: "Feature", properties: { level: "rain" }, geometry: { type: "Polygon", coordinates: [makeEllipsePolygon([120.62, 22.65], 0.84, 0.4, -8)] } }
                ]
            },
            alert: {
                type: "FeatureCollection",
                features: [
                    { type: "Feature", properties: { label: "高溫提醒" }, geometry: { type: "Point", coordinates: [121.56, 25.04] } },
                    { type: "Feature", properties: { label: "降雨提醒" }, geometry: { type: "Point", coordinates: [120.31, 22.63] } }
                ],
            },
            marker: {
                type: "FeatureCollection",
                features: [
                    { type: "Feature", properties: { tone: "rain" }, geometry: { type: "Point", coordinates: [121.62, 24.9] } },
                    { type: "Feature", properties: { tone: "rain" }, geometry: { type: "Point", coordinates: [121.83, 24.24] } },
                    { type: "Feature", properties: { tone: "rain" }, geometry: { type: "Point", coordinates: [120.48, 22.52] } }
                ]
            }
        },
    };

    function isMapboxDemoAvailable() {
        return map && !window._fallbackMap && typeof map.addSource === "function" && typeof map.getStyle === "function";
    }

    function runWhenMapStyleReady(callback) {
        if (!isMapboxDemoAvailable()) {
            console.warn("Demo layers require Mapbox; fallback map is active or Mapbox is unavailable.");
            return;
        }
        if (map.isStyleLoaded && map.isStyleLoaded()) {
            callback();
            return;
        }
        map.once("style.load", callback);
    }

    function addDemoSource(id, data) {
        if (!isMapboxDemoAvailable()) return;
        if (map.getSource(id)) {
            map.getSource(id).setData(data);
            demoSources.add(id);
            return;
        }
        map.addSource(id, { type: "geojson", data });
        demoSources.add(id);
    }

    function addDemoLayer(layerConfig, beforeId) {
        if (!isMapboxDemoAvailable() || !layerConfig?.id || map.getLayer(layerConfig.id)) return;
        if (beforeId && map.getLayer(beforeId)) map.addLayer(layerConfig, beforeId);
        else map.addLayer(layerConfig);
        demoLayers.add(layerConfig.id);
    }

    function removeDemoLayer(id) {
        if (!isMapboxDemoAvailable() || !map.getLayer(id)) return;
        map.removeLayer(id);
        demoLayers.delete(id);
    }

    function removeDemoSource(id) {
        if (!isMapboxDemoAvailable() || !map.getSource(id)) return;
        map.removeSource(id);
        demoSources.delete(id);
    }

    function clearDemoMarkers() {
        while (demoMarkers.length) demoMarkers.pop().remove();
    }

    function clearDemoLayers() {
        clearDemoMarkers();
        DEMO_LAYER_IDS.forEach(removeDemoLayer);
        DEMO_SOURCE_IDS.forEach(removeDemoSource);
        activeDemoType = null;
        updateDemoControlState(null);
        hideDemoInfoCard();
    }

    function addEarthquakePulseMarker() {
        const el = document.createElement("div");
        el.className = "demo-earthquake-pulse data-layer-point";
        el.innerHTML = "<span></span><span></span><span></span>";
        const marker = new mapboxgl.Marker({ element: el, anchor: "center" }).setLngLat([121.72, 24.02]).addTo(map);
        demoMarkers.push(marker);
    }

    function showDemoInfoCard(type) {
        const info = DEMO_DATA[type]?.info;
        if (!info || !mapStage) return;
        if (!demoInfoCard) {
            demoInfoCard = document.createElement("aside");
            demoInfoCard.className = "demo-info-card data-layer-overlay";
            mapStage.appendChild(demoInfoCard);
        }
        demoInfoCard.className = `demo-info-card data-layer-overlay ${info.tone}`;
        demoInfoCard.innerHTML = `
            <button type="button" class="demo-info-close" aria-label="關閉示範圖層資訊">×</button>
            <div class="demo-info-kicker">示範圖層</div>
            <div class="demo-info-title">${info.title}</div>
            <div class="demo-info-list">${info.rows.map(row => `<div>${row}</div>`).join("")}</div>
        `;
        demoInfoCard.hidden = false;
    }

    function hideDemoInfoCard() {
        if (demoInfoCard) demoInfoCard.hidden = true;
    }

    function updateDemoControlState(type) {
        if (!demoLayerControl) return;
        demoLayerControl.querySelectorAll("[data-demo-layer]").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.demoLayer === type);
        });
    }

    function isMobileViewport() {
        return window.matchMedia("(max-width: 767px)").matches;
    }

    function getMobileTopbarRow(selectorClass) {
        if (!mobileTopbar) return null;
        let row = mobileTopbar.querySelector(`.${selectorClass}`);
        if (!row && selectorClass === "mobile-row3") {
            row = document.createElement("div");
            row.className = "mobile-row3";
            mobileTopbar.appendChild(row);
        }
        return row;
    }

    function openSettingsModal() {
        if (settingsModal) settingsModal.classList.add("visible");
    }

    function ensureMobileSettingsButton() {
        if (!mobileTopbar) return null;
        const row1 = getMobileTopbarRow("mobile-row1");
        if (!row1) return null;
        const donateBtn = mobileTopbar.querySelector(".donate-btn");
        if (donateBtn) {
            donateBtn.classList.add("mobile-donate-hidden");
            donateBtn.textContent = "支持作品";
            donateBtn.title = "支持作品";
            donateBtn.setAttribute("aria-label", "支持作品");
        }

        let button = document.getElementById("settings-btn-mobile");
        if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.id = "settings-btn-mobile";
            button.className = "mobile-settings-btn";
            button.setAttribute("aria-label", "開啟設定");
            button.innerHTML = '<i class="fa-solid fa-gear" aria-hidden="true"></i>';
            button.addEventListener("click", openSettingsModal);
        }
        if (button.parentElement !== row1) row1.appendChild(button);
        button.setAttribute("aria-label", "設定");
        button.hidden = false;
        return button;
    }

    function ensureMobileDemoControlPlacement() {
        if (!demoLayerControl) return;
        const row3 = getMobileTopbarRow("mobile-row3");
        if (isMobileViewport() && row3) {
            if (demoLayerControl.parentElement !== row3) row3.appendChild(demoLayerControl);
            return;
        }
        if (mapStage && demoLayerControl.parentElement !== mapStage) {
            mapStage.appendChild(demoLayerControl);
        }
    }

    function updateResponsiveControlsPlacement() {
        ensureMobileSettingsButton();
        ensureMobileDemoControlPlacement();
        if (!isMobileViewport() && newsSidebar) {
            newsSidebar.classList.remove("filters-collapsed");
        }
        updateMobileFilterSummary();
    }

    function showEarthquakeDemo() {
        const data = DEMO_DATA.earthquake;
        addDemoSource("demo-earthquake-zone", data.zone);
        addDemoSource("demo-earthquake-ring", data.ring);
        addDemoSource("demo-earthquake-epicenter", data.epicenter);
        addDemoSource("demo-earthquake-label", data.label);
        addDemoLayer({
            id: "demo-earthquake-zone",
            type: "circle",
            source: "demo-earthquake-zone",
            paint: {
                "circle-radius": ["get", "radius"],
                "circle-color": "rgba(220,38,38,0.08)",
                "circle-opacity": 0.14
            }
        });
        addDemoLayer({
            id: "demo-earthquake-ring",
            type: "circle",
            source: "demo-earthquake-ring",
            paint: {
                "circle-radius": ["get", "radius"],
                "circle-color": "rgba(220,38,38,0.02)",
                "circle-stroke-color": "#d97745",
                "circle-stroke-width": 1.2,
                "circle-stroke-opacity": ["get", "opacity"]
            }
        });
        addDemoLayer({
            id: "demo-earthquake-epicenter",
            type: "circle",
            source: "demo-earthquake-epicenter",
            paint: {
                "circle-radius": 4,
                "circle-color": "#f9d7c2",
                "circle-stroke-color": "rgba(239,68,68,0.7)",
                "circle-stroke-width": 1.2,
                "circle-opacity": 0.9
            }
        });
        addDemoLayer({
            id: "demo-earthquake-label",
            type: "symbol",
            source: "demo-earthquake-label",
            layout: {
                "text-field": ["get", "label"],
                "text-size": 11.6,
                "text-anchor": "left",
                "text-offset": [0.35, -0.25]
            },
            paint: {
                "text-color": "rgba(255,242,232,0.94)",
                "text-halo-color": "rgba(15,23,42,0.78)",
                "text-halo-width": 1
            }
        });
        addEarthquakePulseMarker();
        showDemoInfoCard("earthquake");
    }

    function showTyphoonDemo() {
        const data = DEMO_DATA.typhoon;
        addDemoSource("demo-typhoon-wind-radius", data.windRadius);
        addDemoSource("demo-typhoon-path", data.path);
        addDemoSource("demo-typhoon-center", data.center);
        addDemoSource("demo-typhoon-forecast", data.forecast);
        addDemoSource("demo-typhoon-label", data.label);
        addDemoLayer({
            id: "demo-typhoon-wind-radius",
            type: "fill",
            source: "demo-typhoon-wind-radius",
            paint: {
                "fill-color": "rgba(56,189,248,0.14)",
                "fill-opacity": 0.11,
                "fill-outline-color": "rgba(103,232,249,0.24)"
            }
        });
        addDemoLayer({
            id: "demo-typhoon-path",
            type: "line",
            source: "demo-typhoon-path",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": "rgba(125,211,252,0.56)",
                "line-width": 1.4,
                "line-opacity": 0.56,
                "line-dasharray": [1, 1.8]
            }
        });
        addDemoLayer({
            id: "demo-typhoon-center",
            type: "circle",
            source: "demo-typhoon-center",
            paint: {
                "circle-radius": 3.5,
                "circle-color": "#a5f3fc",
                "circle-stroke-color": "rgba(186,230,253,0.68)",
                "circle-stroke-width": 1,
                "circle-opacity": 0.88
            }
        });
        addDemoLayer({
            id: "demo-typhoon-forecast",
            type: "circle",
            source: "demo-typhoon-forecast",
            paint: {
                "circle-radius": 5.8,
                "circle-color": "rgba(186,230,253,0.84)",
                "circle-stroke-color": "rgba(14,116,144,0.7)",
                "circle-stroke-width": 0.9,
                "circle-opacity": 0.82
            }
        });
        addDemoLayer({
            id: "demo-typhoon-label",
            type: "symbol",
            source: "demo-typhoon-label",
            layout: {
                "text-field": ["get", "label"],
                "text-size": 11,
                "text-anchor": "left",
                "text-offset": [0.3, -0.2]
            },
            paint: {
                "text-color": "rgba(219,234,254,0.9)",
                "text-halo-color": "rgba(15,23,42,0.78)",
                "text-halo-width": 1
            }
        });
        showDemoInfoCard("typhoon");
    }

    function showWeatherDemo() {
        const data = DEMO_DATA.weather;
        addDemoSource("demo-weather-zone", data.zone);
        addDemoSource("demo-weather-alert", data.alert);
        addDemoSource("demo-weather-marker", data.marker);
        addDemoLayer({
            id: "demo-weather-zone",
            type: "fill",
            source: "demo-weather-zone",
            paint: {
                "fill-color": "rgba(56,189,248,0.2)",
                "fill-opacity": 0.16,
                "fill-outline-color": "rgba(125,211,252,0.26)"
            }
        });
        addDemoLayer({
            id: "demo-weather-alert",
            type: "symbol",
            source: "demo-weather-alert",
            layout: {
                "text-field": ["get", "label"],
                "text-size": 10.5,
                "text-anchor": "top",
                "text-offset": [0, 0.85]
            },
            paint: {
                "text-color": [
                    "case",
                    ["==", ["get", "label"], "高溫提醒"],
                    "rgba(251,191,36,0.82)",
                    "rgba(224,242,254,0.82)"
                ],
                "text-halo-color": "rgba(15,23,42,0.76)",
                "text-halo-width": 1
            }
        });
        addDemoLayer({
            id: "demo-weather-marker",
            type: "circle",
            source: "demo-weather-marker",
            paint: {
                "circle-radius": 2.6,
                "circle-color": "rgba(125,211,252,0.75)",
                "circle-stroke-color": "rgba(14,116,144,0.66)",
                "circle-stroke-width": 0.8,
                "circle-opacity": 0.72
            }
        });
        showDemoInfoCard("weather");
    }

    function showDemoLayer(type) {
        runWhenMapStyleReady(() => {
            const nextType = type === activeDemoType ? type : type;
            clearDemoLayers();
            activeDemoType = nextType;
            if (nextType === "earthquake") showEarthquakeDemo();
            else if (nextType === "typhoon") showTyphoonDemo();
            else if (nextType === "weather") showWeatherDemo();
            updateDemoControlState(nextType);
        });
    }

    function createDemoLayerControl() {
        if (!mapStage) return;
        if (!demoLayerControl) {
            demoLayerControl = document.createElement("div");
            demoLayerControl.className = "demo-layer-control data-layer-overlay";
            demoLayerControl.innerHTML = `
                <div class="demo-layer-label data-layer-label">環境圖層（輔助資訊）</div>
                <button type="button" data-demo-layer="earthquake">環境｜地震</button>
                <button type="button" data-demo-layer="typhoon">環境｜颱風</button>
                <button type="button" data-demo-layer="weather">環境｜天氣</button>
                <button type="button" data-demo-clear>清除</button>
            `;
            mapStage.appendChild(demoLayerControl);
        }
        if (!isMapboxDemoAvailable()) {
            demoLayerControl.hidden = true;
            updateResponsiveControlsPlacement();
            return;
        }
        demoLayerControl.hidden = false;
        updateResponsiveControlsPlacement();
        if (demoLayerControl.dataset.bound === "true") return;
        demoLayerControl.dataset.bound = "true";
        demoLayerControl.addEventListener("click", e => {
            const target = e.target instanceof HTMLElement ? e.target.closest("button") : null;
            if (!target) return;
            e.stopPropagation();
            if (target.dataset.demoClear !== undefined) {
                clearDemoLayers();
                return;
            }
            if (target.dataset.demoLayer) showDemoLayer(target.dataset.demoLayer);
        });
        mapStage.addEventListener("click", e => {
            const closeBtn = e.target instanceof HTMLElement ? e.target.closest(".demo-info-close") : null;
            if (!closeBtn) return;
            e.stopPropagation();
            hideDemoInfoCard();
        });
    }

    createDemoLayerControl();

    function applyMapMode(mode) {
        currentMapMode = mode;
        localStorage.setItem("map_mode", mode);
        document.body.classList.toggle("tw-online-mode", mode === "online");
        document.body.classList.toggle("fortune-mode", mode === "fortune");
        document.getElementById("map-mode-select").value = mode;

        const isOnline = mode === "online";
        const isFortune = mode === "fortune";
        
        // 切換底圖視覺風格。
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

        const textConfig = {
            siteTitle: "島嶼脈搏 Island Pulse",
            siteSubtitle: isOnline
                ? "TW ONLINE 視覺模式"
                : (isFortune ? "趨吉避凶模式｜吉凶事件判讀" : "台灣即時事件地圖｜Concept Demo"),
            listTitle: isFortune ? "周邊事件判定" : "台灣即時事件清單",
            searchPlaceholder: isFortune ? "搜尋附近事件、地點或分類" : "搜尋事件、城市或關鍵字",
            emptyState: "目前沒有符合條件的台灣即時事件地圖資料",
            loadingState: "正在同步事件資料...",
            statusPrefix: isOnline
                ? "TW Online 視覺層啟用中"
                : (isFortune ? "趨吉避凶模式｜吉凶事件判讀" : "台灣即時事件地圖｜Concept Demo")
        };

        document.querySelector(".brand-title").textContent = textConfig.siteTitle;
        document.querySelector(".brand-sub").textContent = textConfig.siteSubtitle;
        document.querySelector(".sidebar-title").textContent = textConfig.listTitle;
        const sidebarSubtitle = document.getElementById("sidebar-subtitle");
        if (sidebarSubtitle) {
            sidebarSubtitle.textContent = isFortune
                ? "以目前位置為中心，整理附近值得靠近與需要避開的事件。"
                : "";
        }
        const toolbarCaption = document.querySelector(".toolbar-caption");
        if (toolbarCaption) toolbarCaption.textContent = isFortune ? "以你的位置為中心判讀附近事件" : "台灣即時事件地圖";
        document.getElementById("event-search").placeholder = textConfig.searchPlaceholder;
        const mobileSearch = document.getElementById("event-search-mobile");
        if (mobileSearch) mobileSearch.placeholder = textConfig.searchPlaceholder;
        activeCategory = "all";
        
        const onlineStatus = document.getElementById("tw-online-status");
        if (isOnline) {
            if (onlineStatus) onlineStatus.style.display = "flex";
            const serverStatus = document.getElementById("server-status");
            const playerCount = document.getElementById("player-count");
            if (serverStatus) serverStatus.textContent = "視覺模式啟用中";
            if (playerCount) playerCount.textContent = "Concept Demo";
            setStatus("TW Online 視覺層啟用中｜公共事件資料不變");
        } else {
            if (onlineStatus) onlineStatus.style.display = "none";
            setStatus(textConfig.statusPrefix);
        }

        renderCategoryButtons();
        renderEvents();
        if (userLocation && isNearbyMode) drawUserLocationOverlay();
        setStatus(isOnline ? "TW Online 視覺層啟用中｜公共事件資料不變" : textConfig.statusPrefix);
        scheduleMapResize();
    }
    function setStatus(t){
        if(statusText) statusText.textContent = t;
        const heroStatus = document.getElementById("hero-status-copy");
        if (heroStatus && !heroStatus.textContent) {
            heroStatus.textContent = t;
        }
    }
    function normalizeText(v){ return String(v||"").trim(); }
    function formatRadiusLabel(meters) {
        if (meters >= 1000) return `${meters / 1000}km`;
        return `${meters}m`;
    }
    function getDistanceMeters(lat1, lng1, lat2, lng2) {
        const toRad = (deg) => deg * Math.PI / 180;
        const R = 6371000;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    function getEventsNearUser(events, radiusMeters = 500) {
        if (!userLocation) return [];
        return events
            .map((ev) => {
                const lat = Number(ev.lat);
                const lng = Number(ev.lng);
                const distanceMeters = getDistanceMeters(userLocation.lat, userLocation.lng, lat, lng);
                return { ...ev, distanceMeters };
            })
            .filter((ev) => Number.isFinite(ev.distanceMeters) && ev.distanceMeters <= radiusMeters)
            .sort((a, b) => a.distanceMeters - b.distanceMeters);
    }
    function normalizeFortuneFilterValue(filterValue) {
        const raw = normalizeText(filterValue || "all");
        const normalized = raw.toLowerCase();
        const mapping = {
            all: "all",
            "全部": "all",
            "fortune-all": "all",
            "great-risk": "great-risk",
            greatbad: "great-risk",
            "大凶": "great-risk",
            risk: "risk",
            bad: "risk",
            badonly: "risk",
            "凶": "risk",
            good: "good",
            goodonly: "good",
            "吉": "good",
            "中吉": "good",
            "great-good": "great-good",
            greatgood: "great-good",
            "大吉": "great-good"
        };
        return mapping[normalized] || mapping[raw] || "all";
    }
    function getEventFortuneType(event) {
        const text = normalizeText(`${event?.title || ""} ${event?.content || ""} ${event?.category || ""}`);
        const rawCategory = normalizeText(event?.category || "").toLowerCase();
        const groupCategory = normalizeText(event?.groupCategory || getGroupCategory(rawCategory)).toLowerCase();
        const severity = getEventSeverity(event);
        const riskWords = ["交通", "災害", "意外", "施工", "刑案", "火災", "醫療", "公共安全", "事故", "壅塞", "延誤", "管制"];
        const highRiskWords = ["死亡", "受傷", "封閉", "爆炸", "坍塌", "淹水", "地震", "颱風", "火災", "刑案", "重大"];
        const opportunityWords = ["活動", "賽事", "市集", "展覽", "好消息", "散步", "開放", "登場"];
        const premiumGoodWords = ["大型", "熱門", "節慶", "人流聚集"];
        const isRiskCategory = FORTUNE_RISK_CATEGORIES.has(rawCategory) || FORTUNE_RISK_CATEGORIES.has(groupCategory);
        const isGoodCategory = FORTUNE_GOOD_CATEGORIES.has(rawCategory) || FORTUNE_GOOD_CATEGORIES.has(groupCategory);

        if (isRiskCategory || highRiskWords.some((k) => text.includes(k)) || riskWords.some((k) => text.includes(k))) {
            const level = (severity >= 4 || highRiskWords.some((k) => text.includes(k))) ? "great-risk" : "risk";
            return { type: "bad", level, label: FORTUNE_CONFIG[level].label, key: level };
        }
        if (isGoodCategory || premiumGoodWords.some((k) => text.includes(k)) || opportunityWords.some((k) => text.includes(k))) {
            const level = (["market", "exhibition", "sports", "good_weather"].includes(rawCategory)
                || ["market", "exhibition", "sports", "good_weather"].includes(groupCategory)
                || premiumGoodWords.some((k) => text.includes(k)))
                ? "great-good"
                : "good";
            return { type: "good", level, label: FORTUNE_CONFIG[level].label, key: level };
        }
        return { type: "neutral", level: "neutral", label: "觀察", key: "neutral" };
    }
    function eventMatchesFortuneFilter(event, filterValue = activeCategory) {
        const filter = normalizeFortuneFilterValue(filterValue);
        if (filter === "all") return true;
        const fortune = getEventFortuneType(event);
        if (filter === "great-risk") return fortune.level === "great-risk";
        if (filter === "risk") return fortune.level === "risk";
        if (filter === "good") return fortune.level === "good";
        if (filter === "great-good") return fortune.level === "great-good";
        return true;
    }
    function getFortuneFilterLabel(filterValue = activeCategory) {
        const filter = normalizeFortuneFilterValue(filterValue);
        if (filter === "all") return "全部事件";
        if (filter === "neutral") return "觀察";
        return FORTUNE_CONFIG[filter]?.label || filterValue || "全部事件";
    }
    function getEventFortuneLevel(event) {
        const text = normalizeText(`${event?.title || ""} ${event?.content || ""}`.toLowerCase());
        const rawCategory = normalizeText(event?.category || "").toLowerCase();
        const groupCategory = normalizeText(event?.groupCategory || getGroupCategory(rawCategory)).toLowerCase();
        const severity = getEventSeverity(event);
        const fortuneType = getEventFortuneType(event);

        const highRiskWords = ["死亡", "受傷", "封閉", "爆炸", "坍塌", "淹水", "地震", "颱風", "火災", "刑案", "重大"];
        const riskWords = ["壅塞", "管制", "施工", "事故", "異常", "延誤"];
        const greatGoodWords = ["大型", "市集", "展覽", "節慶", "賽事", "熱門"];

        const isRiskCategory = FORTUNE_RISK_CATEGORIES.has(rawCategory) || FORTUNE_RISK_CATEGORIES.has(groupCategory);
        const isGoodCategory = FORTUNE_GOOD_CATEGORIES.has(rawCategory) || FORTUNE_GOOD_CATEGORIES.has(groupCategory);
        let level = fortuneType.level;
        if (
            ["disaster", "criminal", "fire", "incident", "safety"].includes(groupCategory) ||
            (isRiskCategory && severity >= 4) ||
            highRiskWords.some((k) => text.includes(k)) ||
            severity >= 4
        ) level = "great-risk";
        else if (
            isRiskCategory ||
            ["traffic", "construction", "accident", "weather"].includes(groupCategory) ||
            riskWords.some((k) => text.includes(k))
        ) level = "risk";
        else if (
            ["sports", "market", "exhibition", "good_weather"].includes(rawCategory) ||
            ["sports", "market", "exhibition"].includes(groupCategory) ||
            greatGoodWords.some((k) => text.includes(k))
        ) level = "great-good";
        else if (isGoodCategory || groupCategory === "activity") level = "good";
        else if (!isRiskCategory && !isGoodCategory && !riskWords.some((k) => text.includes(k)) && !highRiskWords.some((k) => text.includes(k))) level = "neutral";

        const cfg = level === "neutral"
            ? { label: "觀察", color: "#94A3B8", icon: "fa-circle-info", actionText: "先觀察" }
            : FORTUNE_CONFIG[level];
        const titleByLevel = {
            "great-risk": ["建議避開", "周邊風險上升", "小心通行"],
            risk: ["小心通行", "建議避開", "周邊風險上升"],
            good: ["可前往", "值得靠近", "附近有活動"],
            "great-good": ["值得靠近", "可前往", "附近有活動"],
            neutral: ["持續觀察", "留意後續變化", "暫無明確吉凶"]
        };
        const contentByLevel = {
            "great-risk": "附近風險較高，建議先避開這一帶並改走其他路線。",
            risk: "附近事件可能影響通行或安全，建議放慢速度並小心通過。",
            good: "附近有可前往的事件，適合順路靠近查看現場狀況。",
            "great-good": "附近活動吸引力較高，值得靠近停留或安排前往。",
            neutral: "目前沒有明確偏吉或偏凶訊號，可先列入觀察。"
        };
        const seed = Array.from(String(event?.id || event?.title || "0")).reduce((a, ch) => a + ch.charCodeAt(0), 0);
        const titles = titleByLevel[level];
        return {
            level,
            label: cfg.label,
            title: titles[seed % titles.length],
            content: contentByLevel[level],
            color: cfg.color,
            actionText: cfg.actionText
        };
    }
    function makeCirclePolygon(centerLat, centerLng, radiusMeters, steps = 64) {
        const earthRadius = 6378137;
        const latRadius = (radiusMeters / earthRadius) * (180 / Math.PI);
        const lngRadius = latRadius / Math.cos(centerLat * Math.PI / 180);
        const coordinates = [];
        for (let i = 0; i <= steps; i += 1) {
            const angle = (i / steps) * Math.PI * 2;
            coordinates.push([
                centerLng + Math.cos(angle) * lngRadius,
                centerLat + Math.sin(angle) * latRadius
            ]);
        }
        return {
            type: "Feature",
            geometry: {
                type: "Polygon",
                coordinates: [coordinates]
            },
            properties: {}
        };
    }
    function getNearbyPalette() {
        if (document.body.classList.contains("fortune-mode")) {
            return {
                fill: "rgba(250,204,21,0.11)",
                line: "#f97316",
                marker: "#facc15",
                lineWidth: 2.4,
                fillOpacity: 0.13,
                lineOpacity: 0.95,
                dashArray: [7, 4]
            };
        }
        if (currentMapMode === "online" || document.body.classList.contains("tw-online-mode")) {
            return {
                fill: "rgba(0,255,170,0.12)",
                line: "#00ffaa",
                marker: "#00ffaa",
                lineWidth: 2.4,
                fillOpacity: 0.12,
                lineOpacity: 0.95,
                dashArray: [5, 3]
            };
        }
        return {
            fill: "rgba(63,140,255,0.14)",
            line: "#3f8cff",
            marker: "#3f8cff",
            lineWidth: 1.8,
            fillOpacity: 0.14,
            lineOpacity: 0.9,
            dashArray: []
        };
    }
    function getUserLocationLabel() {
        if (document.body.classList.contains("fortune-mode")) return "我在此處";
        if (currentMapMode === "online" || document.body.classList.contains("tw-online-mode")) return "PLAYER";
        return "你的位置";
    }
    function isMapboxRuntime() {
        return !window._fallbackMap && map && typeof map.getSource === "function";
    }
    function clearUserLocationOverlay() {
        if (userLocationMarker) {
            userLocationMarker.remove();
            userLocationMarker = null;
        }
        if (userLocationCircle) {
            userLocationCircle.remove();
            userLocationCircle = null;
        }
        if (!isMapboxRuntime()) return;
        if (map.getLayer(MAPBOX_USER_CIRCLE_FILL_ID)) map.removeLayer(MAPBOX_USER_CIRCLE_FILL_ID);
        if (map.getLayer(MAPBOX_USER_CIRCLE_LINE_ID)) map.removeLayer(MAPBOX_USER_CIRCLE_LINE_ID);
        if (map.getSource(MAPBOX_USER_SOURCE_ID)) map.removeSource(MAPBOX_USER_SOURCE_ID);
        if (map.getSource(MAPBOX_USER_CIRCLE_SOURCE_ID)) map.removeSource(MAPBOX_USER_CIRCLE_SOURCE_ID);
    }
    function drawUserLocationOverlay() {
        if (!userLocation) return;
        const palette = getNearbyPalette();
        const radiusScale = Math.max(0.5, Math.min(1, 1000 / Math.max(nearbyRadiusMeters, 300)));
        const dynamicFillOpacity = document.body.classList.contains("fortune-mode")
            ? (palette.fillOpacity || 0.12) * radiusScale
            : (palette.fillOpacity || 0.14);
        if (isMapboxRuntime()) {
            if (userLocationMarker) userLocationMarker.remove();
            const markerEl = document.createElement("div");
            markerEl.className = "user-location-marker";
            markerEl.innerHTML = `
                <div class="user-location-pulse"></div>
                <div class="user-location-core"></div>
                <div class="user-location-crosshair" aria-hidden="true"></div>
                <div class="user-location-label">${getUserLocationLabel()}</div>`;
            userLocationMarker = new mapboxgl.Marker({ element: markerEl, anchor: "center" })
                .setLngLat([userLocation.lng, userLocation.lat])
                .addTo(map);

            const pointData = {
                type: "FeatureCollection",
                features: [{
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [userLocation.lng, userLocation.lat] },
                    properties: {}
                }]
            };
            const circleData = {
                type: "FeatureCollection",
                features: [makeCirclePolygon(userLocation.lat, userLocation.lng, nearbyRadiusMeters)]
            };

            if (!map.getSource(MAPBOX_USER_SOURCE_ID)) map.addSource(MAPBOX_USER_SOURCE_ID, { type: "geojson", data: pointData });
            else map.getSource(MAPBOX_USER_SOURCE_ID).setData(pointData);
            if (!map.getSource(MAPBOX_USER_CIRCLE_SOURCE_ID)) map.addSource(MAPBOX_USER_CIRCLE_SOURCE_ID, { type: "geojson", data: circleData });
            else map.getSource(MAPBOX_USER_CIRCLE_SOURCE_ID).setData(circleData);

            if (!map.getLayer(MAPBOX_USER_CIRCLE_FILL_ID)) {
                map.addLayer({
                    id: MAPBOX_USER_CIRCLE_FILL_ID,
                    type: "fill",
                    source: MAPBOX_USER_CIRCLE_SOURCE_ID,
                    paint: { "fill-color": palette.fill, "fill-opacity": dynamicFillOpacity }
                });
            } else {
                map.setPaintProperty(MAPBOX_USER_CIRCLE_FILL_ID, "fill-color", palette.fill);
                map.setPaintProperty(MAPBOX_USER_CIRCLE_FILL_ID, "fill-opacity", dynamicFillOpacity);
            }
            if (!map.getLayer(MAPBOX_USER_CIRCLE_LINE_ID)) {
                map.addLayer({
                    id: MAPBOX_USER_CIRCLE_LINE_ID,
                    type: "line",
                    source: MAPBOX_USER_CIRCLE_SOURCE_ID,
                    paint: {
                        "line-color": palette.line,
                        "line-width": palette.lineWidth,
                        "line-opacity": palette.lineOpacity,
                        "line-dasharray": palette.dashArray
                    }
                });
            } else {
                map.setPaintProperty(MAPBOX_USER_CIRCLE_LINE_ID, "line-color", palette.line);
                map.setPaintProperty(MAPBOX_USER_CIRCLE_LINE_ID, "line-width", palette.lineWidth);
                map.setPaintProperty(MAPBOX_USER_CIRCLE_LINE_ID, "line-opacity", palette.lineOpacity);
                map.setPaintProperty(MAPBOX_USER_CIRCLE_LINE_ID, "line-dasharray", palette.dashArray);
            }
            return;
        }

        if (!window._fallbackMap) return;
        if (userLocationMarker) userLocationMarker.remove();
        if (userLocationCircle) userLocationCircle.remove();
        userLocationMarker = L.circleMarker([userLocation.lat, userLocation.lng], {
            radius: 8,
            color: "#ffffff",
            weight: 3,
            fillColor: palette.marker,
            fillOpacity: 1
        }).addTo(window._fallbackMap);
        userLocationCircle = L.circle([userLocation.lat, userLocation.lng], {
            radius: nearbyRadiusMeters,
            color: palette.line,
            weight: palette.lineWidth || 2,
            dashArray: Array.isArray(palette.dashArray) && palette.dashArray.length ? palette.dashArray.join(" ") : undefined,
            fillColor: palette.line,
            fillOpacity: dynamicFillOpacity
        }).addTo(window._fallbackMap);
    }
    function setNearbyStatusText() {
        const el = document.getElementById("sidebar-nearby-status");
        const labelEl = document.getElementById("sidebar-nearby-label");
        if (labelEl) labelEl.textContent = `附近範圍：${formatRadiusLabel(nearbyRadiusMeters)}`;
        if (!el) return;
        if (!userLocation) {
            el.textContent = "未定位";
            return;
        }
        if (!isNearbyMode) {
            el.textContent = "已定位";
            return;
        }
        el.textContent = nearbyEventsCache.length > 0 ? `${nearbyEventsCache.length} 件事件` : "目前沒有事件";
    }
    function getFortuneCounts(events = []) {
        const counts = { "great-risk": 0, risk: 0, good: 0, "great-good": 0 };
        events.forEach((ev) => {
            const level = getEventFortuneLevel(ev).level;
            if (counts[level] !== undefined) counts[level] += 1;
        });
        return counts;
    }
    function setNearbyStatusTextV2() {
        const el = document.getElementById("sidebar-nearby-status");
        const labelEl = document.getElementById("sidebar-nearby-label");
        if (labelEl) {
            labelEl.textContent = currentMapMode === "fortune"
                ? "周邊判定範圍"
                : `附近範圍：${formatRadiusLabel(nearbyRadiusMeters)}`;
        }
        if (!el) return;
        if (currentMapMode === "fortune") {
            if (!userLocation) {
                el.textContent = "尚未定位｜請啟用我的周邊";
                return;
            }
            const counts = getFortuneCounts(nearbyEventsCache);
            el.textContent = `範圍 ${formatRadiusLabel(nearbyRadiusMeters)}｜大凶 ${counts["great-risk"]}｜凶 ${counts.risk}｜吉 ${counts.good}｜大吉 ${counts["great-good"]}`;
            return;
        }
        if (!userLocation) {
            el.textContent = "未定位";
            return;
        }
        if (!isNearbyMode) {
            el.textContent = currentMapMode === "fortune" ? "全台總覽中" : "查看全台中";
            return;
        }
        el.textContent = nearbyEventsCache.length > 0
            ? `附近 ${formatRadiusLabel(nearbyRadiusMeters)}：${nearbyEventsCache.length} 件事件`
            : `附近 ${formatRadiusLabel(nearbyRadiusMeters)} 目前沒有事件`;
    }
    function updateNearbyButtonsV2() {
        const active = isNearbyMode;
        const isFortune = currentMapMode === "fortune";
        const text = isFortune
            ? (active ? "全台總覽" : "查看周邊")
            : (active ? "查看全台" : `附近 ${formatRadiusLabel(nearbyRadiusMeters)}`);
        ["nearby-toggle-btn", "nearby-toggle-mobile"].forEach((id) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.classList.toggle("active", active);
            btn.classList.toggle("nearby-secondary", isFortune && active);
            const span = btn.querySelector("span");
            if (span) span.textContent = text;
        });
    }
    function updateNearbyButtons() {
        const active = isNearbyMode;
        const isFortune = currentMapMode === "fortune";
        const text = isFortune
            ? (active ? "全台總覽" : "查看周邊")
            : (active ? "查看全台" : `附近 ${formatRadiusLabel(nearbyRadiusMeters)}`);
        ["nearby-toggle-btn", "nearby-toggle-mobile"].forEach((id) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.classList.toggle("active", active);
            btn.classList.toggle("nearby-secondary", isFortune && active);
            const span = btn.querySelector("span");
            if (span) span.textContent = text;
        });
    }
    function syncNearbyRadiusSelectors() {
        ["nearby-radius-select", "nearby-radius-mobile"].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.value = String(nearbyRadiusMeters);
        });
    }
    function handleNearbyRadiusChange(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return;
        nearbyRadiusMeters = parsed;
        syncNearbyRadiusSelectors();
        updateNearbyButtonsV2();
        setNearbyStatusTextV2();
        if (!userLocation) return;
        if (isNearbyMode) {
            renderEvents();
            setStatus(`附近 ${formatRadiusLabel(nearbyRadiusMeters)}：${nearbyEventsCache.length} 件事件`);
        }
    }
    function focusUserLocation() {
        if (!userLocation) return;
        if (window._fallbackMap && typeof window._fallbackMap.setView === "function") {
            window._fallbackMap.setView([userLocation.lat, userLocation.lng], 16, { animate: true });
            return;
        }
        if (map && typeof map.flyTo === "function") {
            map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 16, duration: 900, essential: true });
        }
    }
    function enterNearbyMode() {
        if (!userLocation) return;
        isNearbyMode = true;
        drawUserLocationOverlay();
        focusUserLocation();
        renderEvents();
        setStatus(`已切換為附近 ${formatRadiusLabel(nearbyRadiusMeters)}`);
    }
    function exitNearbyMode() {
        isNearbyMode = false;
        clearUserLocationOverlay();
        renderEvents();
        setStatus("已回到全台事件");
    }
    function requestUserLocation() {
        if (!navigator.geolocation) {
            setStatus("此瀏覽器不支援定位功能。");
            return;
        }
        navigator.geolocation.getCurrentPosition((position) => {
            userLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            enterNearbyMode();
        }, () => {
            setStatus("無法取得位置，請開啟瀏覽器定位權限。");
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 120000 });
    }
    function handleNearbyRadiusChangeV2(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return;
        nearbyRadiusMeters = parsed;
        syncNearbyRadiusSelectors();
        updateNearbyButtonsV2();
        setNearbyStatusTextV2();
        if (!userLocation) return;
        if (isNearbyMode || currentMapMode === "fortune") {
            renderEvents();
            setStatus(`附近 ${formatRadiusLabel(nearbyRadiusMeters)}：${nearbyEventsCache.length} 件事件`);
        }
    }
    function enterNearbyModeV2() {
        if (!userLocation) return;
        isNearbyMode = true;
        drawUserLocationOverlay();
        focusUserLocation();
        renderEvents();
        setStatus(`已切換為附近 ${formatRadiusLabel(nearbyRadiusMeters)}`);
    }
    function exitNearbyModeV2() {
        isNearbyMode = false;
        clearUserLocationOverlay();
        renderEvents();
        setStatus("已切換回全台事件");
    }
    function requestUserLocationV2() {
        if (!navigator.geolocation) {
            setStatus("此瀏覽器不支援定位功能。");
            return;
        }
        navigator.geolocation.getCurrentPosition((position) => {
            userLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            enterNearbyModeV2();
        }, () => {
            setStatus("無法取得位置，請開啟瀏覽器定位權限。");
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 120000 });
    }
    function tryParseJson(t,fb){ try{ return t ? JSON.parse(t) : fb; }catch{ return fb; } }
    function flyToLatLng(latlng, zoom, duration=800){
        if (window._fallbackMap && typeof window._fallbackMap.flyTo === "function") {
            window._fallbackMap.flyTo([latlng[0], latlng[1]], zoom, { duration: duration / 1000 });
            return;
        }
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
        const modeLabel = currentMapMode === "online"
            ? "TW Online 視覺模式"
            : (isTaiwanMode ? "台灣地圖" : "統計視圖");
        const categoryLabel = currentMapMode === "fortune"
            ? getFortuneFilterLabel(activeCategory)
            : (activeCategory === "all" ? "全部事件" : (getCategoryVisual(activeCategory)?.text || activeCategory));
        const cityCount = new Set(events.map(ev => normalizeText(ev.city)).filter(Boolean)).size;
        const categoryCount = new Set(events.map(ev => inferEventGroupCategory(ev)).filter(Boolean)).size;

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
            heroStatus.textContent = currentMapMode === "online"
                ? "TW Online：事件地圖的遊戲化展示模式"
                : "用地圖看見台灣正在發生的事";
        }
    }
    function makeMarkerElement(color, svg, severity = 2, glowColor = null, showPulse = false){
        const isMobile = typeof isMobileViewport === "function" ? isMobileViewport() : false;
        const pinSizes = { 1: 34, 2: 38, 3: 42, 4: 46, 5: 52 };
        const glowPx = { 1: 6, 2: 10, 3: 14, 4: 20, 5: 28 };
        const bodySize = pinSizes[severity] || 38;
        const g = isMobile ? "transparent" : (glowColor || color);
        const glowR = glowPx[severity] || 10;
        const outerW = Math.round(bodySize * 1.18);
        const outerH = Math.round(bodySize * 1.7);
        const iconSize = Math.round(bodySize * 0.42);
        const band = severity >= 4 ? "high" : severity >= 2 ? "medium" : "low";
        const wrapper = document.createElement("div");
        wrapper.className = `map-pin event-marker marker-severity-${severity} marker-${band}${isMobile ? " marker-mobile-simple" : ""}`;
        wrapper.dataset.pinWidth = String(outerW);
        wrapper.dataset.pinHeight = String(outerH);

        // 重要：外層只代表地圖座標點，維持 0x0；真正圖釘由內層視覺元素往左上偏移。
        // 這樣縮放、拖曳、pitch 時，Mapbox 錨點不會再受圖釘尺寸影響而漂移。
        wrapper.style.position = "relative";
        wrapper.style.display = "block";
        wrapper.style.width = "0px";
        wrapper.style.height = "0px";
        wrapper.style.overflow = "visible";
        wrapper.style.pointerEvents = "auto";
        wrapper.style.transformOrigin = "0 0";
        wrapper.style.setProperty("--pin-color", color);
        wrapper.style.setProperty("--pin-glow", g);
        const svgFilter = isMobile ? "" : ` style="filter:drop-shadow(0 8px 16px rgba(0,0,0,0.45)) drop-shadow(0 0 ${glowR}px ${g});"`;
        wrapper.innerHTML = `
            <span class="map-pin-visual" style="position:absolute;left:0;top:0;display:block;width:${outerW}px;height:${outerH}px;transform:translate(-50%,-100%);transform-origin:center bottom;overflow:visible;">
                ${showPulse && !isMobile ? `<span class="pin-pulse" style="background:${color};width:${bodySize}px;height:${bodySize}px;"></span>` : ""}
                <svg class="map-pin-svg" viewBox="0 0 64 92" aria-hidden="true"${svgFilter}>
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
        return "news";
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

    // ?? GEO ?????????????????????????????????????????????????
    async function loadTwGeoJSON(){
        try{
            const res = await fetch("https://cdn.jsdelivr.net/gh/g0v/twgeojson@master/json/twCounty2010.geo.json");
            twGeoJSON = await res.json();
            drawCityBoundary(currentCityFilter());
        }catch(e){ console.warn("GeoJSON 載入失敗", e); }
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
            const n = normalizeText(f.properties.COUNTYNAME || f.properties.name || "");
            const t = normalizeText(city);
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
        if (isMobileViewport()) {
            if (scheduleMapResize._raf) return;
            scheduleMapResize._raf = requestAnimationFrame(() => {
                scheduleMapResize._raf = 0;
                resizeNow();
                clearTimeout(scheduleMapResize._timer);
                scheduleMapResize._timer = setTimeout(resizeNow, 180);
            });
            return;
        }
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
        const html=['<option value="all">全部縣市</option>',...CITY_OPTIONS.map(o=>`<option value="${o.value}">${o.label}</option>`)].join("");
        d.innerHTML=html; m.innerHTML=html;
    }

    // ?? FILTERS ?????????????????????????????????????????????
    function renderCategoryButtons(){
        const isFortune = currentMapMode === "fortune";
        const isOnline = currentMapMode === "online";
        const config = isOnline ? TW_ONLINE_CATEGORIES : CATEGORY_CONFIG;
        const mapConfig = isOnline ? CATEGORY_MAP.online : CATEGORY_MAP.normal;

        const order = isFortune ? FORTUNE_CATEGORY_ORDER : FIXED_CATEGORY_ORDER;
        catFilters.innerHTML = order.map(cat=>{
            if (isFortune) {
                const isActive = activeCategory===cat;
                const levelCfg = cat === "all" ? null : FORTUNE_CONFIG[cat];
                const label = cat === "all" ? "全部" : levelCfg.label;
                const color = cat === "all" ? "#63789a" : levelCfg.color;
                return `<button class="filter-chip filter-chip-v2${isActive?" active":""}" data-category="${cat}"
                    style="--chip-bg:${color};${isActive ? `background:${color};` : ""}"
                ><span class="chip-icon"><i class="fa-solid ${cat==="all"?"fa-layer-group":levelCfg.icon}"></i></span>${label}</button>`;
            }
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
                activeCategory = isFortune
                    ? normalizeFortuneFilterValue(btn.dataset.category || "all")
                    : (btn.dataset.category || "all");
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
            const titleKey = normalizeText(ev.title || ev.text || "")
                .replace(/\s+/g, "")
                .replace(/[，。！？、：；「」『』【】《》〈〉\-\.\,\!\?]/g, "")
                .slice(0, 20);
            const contentKey = normalizeText(ev.content || ev.summary || "")
                .replace(/\s+/g, "")
                .replace(/[，。！？、：；「」『』【】《》〈〉\-\.\,\!\?]/g, "")
                .slice(0, 30);
            if (seenTitles.has(titleKey) || (contentKey && seenContent.has(contentKey))) return false;
            seenTitles.add(titleKey);
            if (contentKey) seenContent.add(contentKey);
            return true;
        });
    }

    function normalizeDisplayEvent(ev) {
        const originalCategory = normalizeText(ev.category || ev.type || "other").toLowerCase();
        const groupCategory = inferEventGroupCategory({ ...ev, category: originalCategory });
        return {
            ...ev,
            originalCategory,
            category: groupCategory,
            groupCategory,
            displayCategory: getCategoryVisual(groupCategory)?.text || "其他"
        };
    }

    function getFilteredEvents(options = {}){
        const { forMap = false } = options;
        const cityFilter = isTaiwanMode ? currentCityFilter() : "all";
        const filtered = parsedEvents.filter(ev=>{
            const lat=Number(ev.lat), lng=Number(ev.lng);
            
            if(!Number.isFinite(lat)||!Number.isFinite(lng)) return false;
            if(!isValidTaiwanCoord(lat, lng)) return false;

            const groupCategory = inferEventGroupCategory(ev);
            if (currentMapMode === "fortune") {
                if (!eventMatchesFortuneFilter(ev, activeCategory)) return false;
            } else if(activeCategory!=="all"&&groupCategory!==activeCategory) return false;
            if(cityFilter!=="all"){
                if(!normalizeText(ev.city).toLowerCase().includes(cityFilter.toLowerCase())) return false;
            }
            if(searchKeyword){
                const hay=[ev.title,ev.content,ev.city,ev.source].join(" ").toLowerCase();
                if(!hay.includes(searchKeyword)) return false;
            }
            return true;
        });
        if (!forMap && isNearbyMode && userLocation) {
            nearbyEventsCache = getEventsNearUser(filtered, nearbyRadiusMeters);
            return nearbyEventsCache;
        }
        if (!forMap) nearbyEventsCache = [];
        console.log("filtered events length", filtered.length);
        return filtered;
    }

    function getCurrentCategoryLabel() {
        if (currentMapMode === "fortune") return getFortuneFilterLabel(activeCategory);
        if (activeCategory === "all") return "全部事件";
        const visual = getCategoryVisual(activeCategory);
        return visual?.text || activeCategory || "全部事件";
    }

    function ensureMobileFilterSummary() {
        if (!newsSidebar) return null;
        const header = newsSidebar.querySelector(".sidebar-header");
        if (!header) return null;
        if (!mobileFilterSummary) {
            mobileFilterSummary = header.querySelector(".mobile-filter-summary");
        }
        if (!mobileFilterSummary) {
            mobileFilterSummary = document.createElement("button");
            mobileFilterSummary.type = "button";
            mobileFilterSummary.className = "mobile-filter-summary";
            mobileFilterSummary.setAttribute("aria-label", "展開篩選條件");
            header.appendChild(mobileFilterSummary);
        }
        return mobileFilterSummary;
    }

    function updateMobileFilterSummary(count = lastRenderedEventCount) {
        const summary = ensureMobileFilterSummary();
        if (!summary) return;
        const label = getCurrentCategoryLabel();
        const countLabel = Number.isFinite(count) ? `${count} 筆` : "";
        summary.innerHTML = `<span>目前分類：${label}</span><strong>${countLabel}</strong>`;
    }

    function getEventAlertType(ev) {
        const cat = inferEventGroupCategory(ev);
        if (cat === "disaster") return "disaster";
        if (cat === "traffic") return "traffic";
        if (cat === "accident") return "accident";
        return null;
    }

    function getEventSeverity(ev) {
        const raw = ev.severity;
        if (typeof raw === "number" && Number.isFinite(raw)) return Math.min(5, Math.max(1, Math.round(raw)));
        if (raw === "high") return 5;
        if (raw === "medium") return 3;
        if (raw === "low") return 1;
        const cat = inferEventGroupCategory(ev);
        if (cat === "disaster") return 4;
        if (cat === "accident") return 3;
        if (cat === "traffic") return 2;
        return 1;
    }

    function getSeverityBand(ev) {
        const severity = getEventSeverity(ev);
        if (severity >= 4) return "high";
        if (severity >= 2) return "medium";
        return "low";
    }

    function resolveMarkerStyle(ev, fallbackColor) {
        const visual = getCategoryVisual(inferEventGroupCategory(ev));
        const color = visual?.color || fallbackColor || "#64748B";
        const meta = visual?.meta || CAT_META.other;
        const band = getSeverityBand(ev);
        const glow = band === "high"
            ? `rgba(${meta.rgba},0.62)`
            : band === "medium"
                ? `rgba(${meta.rgba},0.38)`
                : `rgba(${meta.rgba},0.18)`;
        return { color, glow };
    }

    function shouldPinPulse(ev, severity) {
        if (["activity", "sports"].includes(ev.category)) return false;
        return severity >= 2;
    }

    function getEventSummary(ev) {
        return ev.summary || ev.content || "目前尚無摘要資訊。";
    }

    function formatEventDateTime(value) {
        if (!value) return "";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return "";
        return d.toLocaleString("zh-TW", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        });
    }

    function formatEventDateRange(ev) {
        const start = formatEventDateTime(ev.startsAt || ev.startAt);
        const end = formatEventDateTime(ev.endsAt || ev.endAt);
        if (start && end && start !== end) return `${start} - ${end}`;
        return start || end || "";
    }

    function makeEventDetailRows(ev, context = "card") {
        const rows = [];
        const isActivity = inferEventGroupCategory(ev) === "activity" || ev.category === "activity";
        const timeRange = formatEventDateRange(ev);
        const place = normalizeText([ev.venue, ev.address || ev.location].filter(Boolean).join("｜"));
        const area = normalizeText([ev.city, ev.district].filter(Boolean).join(" "));

        if (isActivity && timeRange) rows.push(["時間", timeRange]);
        if (place) rows.push([isActivity ? "場地" : "地點", place]);
        else if (area) rows.push(["地區", area]);
        if (ev.impact) rows.push(["影響", ev.impact]);
        if (ev.advice) rows.push(["建議", ev.advice]);

        if (!rows.length) return "";
        const maxRows = context === "popup" ? 4 : 3;
        return `<div class="event-detail-list event-detail-list--${context}">
            ${rows.slice(0, maxRows).map(([label, value]) => `
                <div class="event-detail-item">
                    <span class="event-detail-label">${label}</span>
                    <span class="event-detail-value">${value}</span>
                </div>`).join("")}
        </div>`;
    }

    function getImpactLabel(ev) {
        const raw = normalizeText(ev.impactLevel);
        if (raw) return raw;
        const severity = getEventSeverity(ev);
        if (severity <= 1) return "低度影響";
        if (severity === 2) return "輕度影響";
        if (severity === 3) return "中度影響";
        if (severity === 4) return "高度影響";
        return "緊急影響";
    }

    function getSeverityLabel(ev) {
        const severity = getEventSeverity(ev);
        if (severity <= 1) return "低度影響";
        if (severity === 2) return "輕度影響";
        if (severity === 3) return "中度影響";
        if (severity === 4) return "高度影響";
        return "緊急影響";
    }

    function formatAttentionCount(ev) {
        return `${Number(ev.interactionCount || 0).toLocaleString()} 人已關注`;
    }

    function formatSourceLabel(ev) {
        const raw = normalizeText(ev.sourceName || ev.source);
        const lowered = raw.toLowerCase();
        if (!raw || lowered.includes("concept demo") || lowered.includes("island pulse")) {
            return "來源｜Island Pulse 展示資料";
        }
        return `來源｜${raw}`;
    }

    function getEventInteractionType(ev) {
        const rawCategory = normalizeText(ev.category || "").toLowerCase();
        const groupCategory = normalizeText(ev.groupCategory || getGroupCategory(rawCategory)).toLowerCase();
        if (groupCategory === "activity" || rawCategory === "activity") return "activity-rating";
        if (groupCategory === "sports" || rawCategory === "sports") return "sports-rating";
        if (groupCategory === "weather" || rawCategory === "weather") return "weather-ack";
        if (isMajorIncidentEvent(ev)) return "major-incident";
        if (groupCategory === "traffic" || ["traffic", "construction"].includes(rawCategory)) return "traffic-ack";
        return "traffic-ack";
    }

    function isTwOnlineMode() {
        return currentMapMode === "online" || document.body.classList.contains("tw-online-mode");
    }

    function getTwOnlineEventCopy(event) {
        const rawCategory = normalizeText(event?.category || "").toLowerCase();
        const groupCategory = normalizeText(event?.groupCategory || getGroupCategory(rawCategory)).toLowerCase();
        const category = groupCategory || rawCategory || "accident";
        const severity = getEventSeverity(event);
        const severityLabel = severity <= 2 ? "輕度" : (severity === 3 ? "中度" : "高度");
        const seedBase = normalizeText(event?.id || event?.title || "0");
        const seed = Array.from(seedBase).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
        const pick = list => list[seed % list.length];
        const copyMap = {
            traffic: {
                titles: ["道路節點壅塞警報", "城市移動路線受阻", "通勤路徑發生干擾"],
                contents: ["該區域移動效率下降，建議玩家重新規劃路線。", "交通節點出現異常負載，通行速度降低。"],
                categoryLabel: "移動事件",
                impactLabel: "移動受阻"
            },
            disaster: {
                titles: ["區域災害事件觸發", "城市安全警戒升級", "環境異常事件出現"],
                contents: ["該區域安全值下降，建議避開事件範圍。", "環境風險上升，系統已標記為高注意區。"],
                categoryLabel: "災害事件",
                impactLabel: "安全值下降"
            },
            accident: {
                titles: ["突發意外事件生成", "公共安全事件觸發", "區域異常狀態出現"],
                contents: ["此區出現突發事件，周邊通行與安全狀態受到影響。", "系統偵測到異常事件，建議保持注意。"],
                categoryLabel: "突發事件",
                impactLabel: "注意力提升"
            },
            activity: {
                titles: ["城市活動節點開啟", "限時地點事件出現", "人流聚集事件啟動"],
                contents: ["該地點出現活動節點，可能帶來人流與交通變化。", "城市互動事件開啟，可前往查看現場資訊。"],
                categoryLabel: "活動事件",
                impactLabel: "人流增加"
            }
        };
        const mappedCategory = ["traffic", "disaster", "activity"].includes(category) ? category : "accident";
        const rule = copyMap[mappedCategory];
        return {
            title: pick(rule.titles),
            content: pick(rule.contents),
            categoryLabel: rule.categoryLabel,
            severityLabel,
            impactLabel: rule.impactLabel,
            primaryAction: "已知悉",
            secondaryAction: "值得注意",
            sourceLabel: formatSourceLabel(event)
        };
    }

    function makeReportActionHtml(ev, context) {
        const eventId = encodeURIComponent(ev.id || "");
        const cls = context === "popup" ? "popup-btn-v2 ghost" : "card-action-btn report";
        return `<button type="button" class="${cls}" data-action="report" data-event-id="${eventId}">回報</button>`;
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
        if (currentMapMode === "fortune") {
            const fortune = getEventFortuneLevel(ev);
            const labels = ["great-risk", "risk"].includes(fortune.level)
                ? ["已避開", "持續注意"]
                : ["good", "great-good"].includes(fortune.level)
                    ? ["想前往", "值得看看"]
                    : ["已知悉", "先觀察"];
            const cls = context === "popup" ? "popup-btn-v2 ghost rating-action" : "card-action-btn rating-action";
            const buttons = labels.map(label => `<button type="button" class="${cls}" onclick="event.stopPropagation();">${label}</button>`).join("");
            const report = makeReportActionHtml(ev, context);
            const sourceUrl = ev.sourceUrl || ev.url || "";
            const sourceBtn = sourceUrl
                ? `<a href="${sourceUrl}" target="_blank" rel="noreferrer" class="${context === "popup" ? "popup-btn-v2 ghost" : "card-action-btn link"}" onclick="event.stopPropagation();">來源</a>`
                : "";
            return `<div class="event-actions event-actions--${context}" data-interaction-type="fortune"><div class="${context === "popup" ? "popup-action-group" : "card-action-group"}">${buttons}${report}${sourceBtn}</div></div>`;
        }
        if (isTwOnlineMode()) {
            const labels = [options.twCopy?.primaryAction || "已知悉", options.twCopy?.secondaryAction || "值得注意"];
            const buttonsHtml = `${makeRatingActionHtml(ev, labels, context)}${makeReportActionHtml(ev, context)}`;
            return `
                <div class="event-actions event-actions--${context}" data-interaction-type="tw-online">
                    <div class="${context === "popup" ? "popup-action-group" : "card-action-group"}">${buttonsHtml}</div>
                </div>`;
        }
        const interactionType = getEventInteractionType(ev);
        let labels = ["已知悉", "值得注意"];
        if (interactionType === "major-incident") labels = ["已知悉"];
        if (interactionType === "activity-rating") labels = ["值得去", "還好", "不推薦"];
        if (interactionType === "sports-rating") labels = ["精彩", "普通", "冷場"];
        if (interactionType === "weather-ack") labels = ["已知悉"];
        const reactionHtml = interactionType === "major-incident"
            ? makeReactionBarHtml(
                ev.id,
                { muyu: Number(ev.interactionCount || 0), candle: 0 },
                (typeof localStorage !== "undefined" ? localStorage.getItem(`reacted:${ev.id}`) : null),
                context === "popup"
              )
            : "";
        const buttonsHtml = `${makeRatingActionHtml(ev, labels, context)}${makeReportActionHtml(ev, context)}`;
        return `
            <div class="event-actions event-actions--${context}" data-interaction-type="${interactionType}">
                ${reactionHtml}
                <div class="${context === "popup" ? "popup-action-group" : "card-action-group"}">${buttonsHtml}</div>
            </div>`;
    }

    function catVisualMeta(category) {
        const visual = getCategoryVisual(category);
        return visual?.meta || CAT_META.other;
    }

    function buildPopupHtml(ev, displayTitle, displayContent, markerStyle, twCopy = null) {
        if (currentMapMode === "fortune") {
            const f = getEventFortuneLevel(ev);
            const mapTitle = {
                "great-risk": "大凶｜高風險事件",
                risk: "凶｜注意事件",
                good: "吉｜可前往事件",
                "great-good": "大吉｜推薦事件",
                neutral: "觀察｜持續留意"
            }[f.level];
            return `
                <div class="popup-demo-inner fortune-popup fortune-${f.level}" style="--popup-color:${f.color}">
                    <div class="fortune-popup-level">${mapTitle}</div>
                    <div class="popup-summary">${f.content}</div>
                    <div class="fortune-popup-raw">原始事件：${displayTitle}</div>
                    ${renderEventActions(ev, { displayTitle, context: "popup" })}
                </div>`;
        }
        const city = ev.city || "未標示城市";
        const timeStr = formatEventTime(ev);
        const trustMeta = getEventTrustMeta(ev);
        const sourceLabel = twCopy?.sourceLabel || formatSourceLabel(ev);
        const detailLabel = twCopy?.categoryLabel || getCategoryDetailLabel(ev.category);
        const impactLabel = twCopy?.impactLabel || getImpactLabel(ev);
        const severityLabel = twCopy?.severityLabel || getSeverityLabel(ev);
        const badgeHtml = twCopy
            ? `<span class="cat-badge-v2" style="background:rgba(${catVisualMeta(ev.category).rgba},0.15);border:1px solid rgba(${catVisualMeta(ev.category).rgba},0.3);color:${catVisualMeta(ev.category).tint};">${twCopy.categoryLabel}</span>`
            : makeCatBadgeV2(ev.category);
        const detailsHtml = makeEventDetailRows(ev, "popup");
        return `
            <div class="popup-demo-inner" style="--popup-color:${markerStyle.color}">
                <div class="popup-header">
                    <div>
                        <div class="popup-title-v2">${displayTitle}</div>
                        <div class="popup-header-meta">
                            ${badgeHtml}
                            <span class="popup-location-tag">${detailLabel}</span>
                            <span class="popup-location-tag">${city}</span>
                            ${timeStr ? `<span class="popup-location-tag">${timeStr}</span>` : ""}
                        </div>
                    </div>
                </div>
                <div class="popup-summary">${displayContent}</div>
                ${detailsHtml}
                <div class="event-impact-row">
                    <span class="impact-chip impact-${getSeverityBand(ev)}">${impactLabel}</span>
                    <span class="severity-chip">${severityLabel}</span>
                    <span class="interaction-chip">${formatAttentionCount(ev)}</span>
                </div>
                <div class="popup-source-row"><span>${sourceLabel}</span></div>
                ${renderEventActions(ev, { displayTitle, context: "popup", twCopy })}
                ${ev.sourceUrl || ev.url ? `<div class="popup-footer"><a href="${ev.sourceUrl || ev.url}" target="_blank" rel="noreferrer" class="popup-btn-v2 primary">查看來源</a></div>` : ""}
            </div>`;
    }

    function buildEventCardHtml(ev, displayTitle, displayContent, catVisual, twCopy = null) {
        if (currentMapMode === "fortune") {
            const f = getEventFortuneLevel(ev);
            const sourceUrl = ev.sourceUrl || ev.url || "";
            return `
                <div class="fortune-card fortune-card-${f.level}">
                    <div class="fortune-level-badge">${f.label}</div>
                    <div class="fortune-card-title">${f.label}｜${f.title}</div>
                    <div class="fortune-card-content">${f.content}</div>
                    <div class="fortune-card-raw">來源資料：${displayTitle}</div>
                    <div class="card-actions">
                        ${renderEventActions(ev, { displayTitle, context: "card" })}
                        ${sourceUrl ? `<a href="${sourceUrl}" target="_blank" rel="noreferrer" class="card-action-btn link" onclick="event.stopPropagation();">來源</a>` : ""}
                    </div>
                </div>`;
        }
        const city = normalizeText(ev.city) || "未標示城市";
        const timeStr = formatEventTime(ev);
        const sourceLabel = twCopy?.sourceLabel || formatSourceLabel(ev);
        const detailLabel = twCopy?.categoryLabel || getCategoryDetailLabel(ev.category);
        const impactLabel = twCopy?.impactLabel || getImpactLabel(ev);
        const severityLabel = twCopy?.severityLabel || getSeverityLabel(ev);
        const badgeHtml = twCopy
            ? `<span class="cat-badge-v2" style="background:rgba(${catVisualMeta(ev.category).rgba},0.15);border:1px solid rgba(${catVisualMeta(ev.category).rgba},0.3);color:${catVisualMeta(ev.category).tint};">${twCopy.categoryLabel}</span>`
            : makeCatBadgeV2(ev.category);
        const trustMeta = getEventTrustMeta(ev);
        const sourceUrl = ev.sourceUrl || ev.url || "";
        const sourcesHtml = sourceUrl ? `
            <div class="card-sources-toggle" onclick="this.nextElementSibling.classList.toggle('visible'); event.stopPropagation();">
                <i class="fa-solid fa-newspaper"></i> 來源資料 <i class="fa-solid fa-chevron-down"></i>
            </div>
            <div class="card-sources-list">
                <a href="${sourceUrl}" target="_blank" rel="noreferrer" onclick="event.stopPropagation();">${sourceLabel}</a>
            </div>` : "";
        const detailsHtml = makeEventDetailRows(ev, "card");
        return `
            <div class="card-bar" style="background:${catVisual.color};"></div>
            <div class="card-v2-left">
                <div class="card-v2-meta">
                    ${badgeHtml}
                    <span class="time-tag">${detailLabel}</span>
                    <span class="city-tag">${LOC_PIN_SVG}${city}</span>
                    ${timeStr ? `<span class="time-tag">${timeStr}</span>` : ""}
                </div>
                <div class="card-v2-title">${displayTitle}</div>
                <div class="card-v2-content">${displayContent}</div>
                <div class="event-trust-row">
                    <span><i class="fa-solid fa-database"></i>${trustMeta.source}</span>
                    <span><i class="fa-regular fa-clock"></i>${trustMeta.relative || trustMeta.updated}</span>
                    <span><i class="fa-solid fa-shield-halved"></i>${dataSyncState.store || "資料快取"}</span>
                </div>
                ${detailsHtml}
                <div class="event-impact-row">
                    <span class="impact-chip impact-${getSeverityBand(ev)}">${impactLabel}</span>
                    <span class="severity-chip">${severityLabel}</span>
                    <span class="interaction-chip">${formatAttentionCount(ev)}</span>
                </div>
            </div>
            <div class="card-v2-right">${makeSrcBadgeV2(ev.source)}</div>
            <div class="card-v2-extra card-footer">
                ${sourcesHtml}
                <div class="card-actions">
                    ${renderEventActions(ev, { displayTitle, context: "card", twCopy })}
                    ${sourceUrl ? `<a href="${sourceUrl}" target="_blank" rel="noreferrer" class="card-action-btn link" onclick="event.stopPropagation();">來源</a>` : ""}
                </div>
            </div>`;
    }

    function updateCurationMeta(events){
        const cityValue = document.getElementById("city-filter")?.value || "all";
        const cityLabel = cityValue === "all" ? "全台" : cityValue;
        const modeLabel = currentMapMode === "online"
            ? "TW Online 視覺模式"
            : (isTaiwanMode ? "台灣地圖" : "統計視圖");
        const categoryLabel = currentMapMode === "fortune"
            ? getFortuneFilterLabel(activeCategory)
            : (activeCategory === "all" ? "全部事件" : (getCategoryVisual(activeCategory)?.text || activeCategory));
        const cityCount = new Set(events.map(ev => normalizeText(ev.city)).filter(Boolean)).size;
        const categoryCount = new Set(events.map(ev => inferEventGroupCategory(ev)).filter(Boolean)).size;
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
            heroStatus.textContent = currentMapMode === "online"
                ? "以遊戲化介面觀看同一份公共事件資料｜事件資料不變，僅切換視覺風格"
                : `共 ${events.length} 筆事件，涵蓋 ${cityCount} 城市、${categoryCount} 類別`;
        }
    }

    function removeMapOverlays() {
        document.querySelectorAll(".map-hero, .map-orbital-card").forEach(el => el.remove());
    }

    function setMobileFiltersCollapsed(collapsed) {
        if (!newsSidebar) return;
        newsSidebar.classList.toggle("filters-collapsed", Boolean(collapsed));
    }

    function handleMobileFilterScroll() {
        mobileFilterScrollTicking = false;
        if (!eventList || !newsSidebar) return;
        if (!isMobileViewport()) {
            setMobileFiltersCollapsed(false);
            return;
        }
        const top = eventList.scrollTop || 0;
        if (top < 8) {
            mobileFilterManualExpand = false;
            setMobileFiltersCollapsed(false);
            return;
        }
        if (top > 16) {
            if (mobileFilterManualExpand && top <= mobileFilterManualAnchor + 8) return;
            mobileFilterManualExpand = false;
            setMobileFiltersCollapsed(true);
        }
    }

    function initMobileFilterCollapse() {
        const summary = ensureMobileFilterSummary();
        if (!eventList || !summary) return;
        if (summary.dataset.bound !== "true") {
            summary.dataset.bound = "true";
            summary.addEventListener("click", () => {
                mobileFilterManualExpand = true;
                mobileFilterManualAnchor = eventList.scrollTop || 0;
                setMobileFiltersCollapsed(false);
            });
        }
        if (eventList.dataset.mobileCollapseBound !== "true") {
            eventList.dataset.mobileCollapseBound = "true";
            eventList.addEventListener("scroll", () => {
                if (mobileFilterScrollTicking) return;
                mobileFilterScrollTicking = true;
                requestAnimationFrame(handleMobileFilterScroll);
            }, { passive: true });
        }
        updateMobileFilterSummary();
    }

    // ?? REACTION ????????????????????????????????????????????
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
        const keywords = ["死亡", "傷亡", "重傷", "送醫", "搜救", "重大事故", "工安"];
        const text = `${ev.title || ""}${ev.content || ""}`;
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
        if (type === "candle") btn.classList.add("incense-lit");

        const data = await sendReaction(eventId, type);
        const container = btn.closest(".reaction-container") || btn.closest(".popup-reactions-wrap") || btn.closest(".reaction-bar")?.parentElement;
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

    // ?? RENDER ??????????????????????????????????????????????
    function renderEventActionsV2(ev, options = {}) {
        const context = options.context || "card";
        if (currentMapMode === "fortune") {
            const fortune = getEventFortuneLevel(ev);
            const labels = ["great-risk", "risk"].includes(fortune.level)
                ? ["已避開", "持續注意"]
                : ["good", "great-good"].includes(fortune.level)
                    ? ["想前往", "值得看看"]
                    : ["已知悉", "先觀察"];
            const cls = context === "popup" ? "popup-btn-v2 ghost rating-action" : "card-action-btn rating-action";
            const buttons = labels.map(label => `<button type="button" class="${cls}" onclick="event.stopPropagation();">${label}</button>`).join("");
            const report = makeReportActionHtml(ev, context);
            const sourceUrl = ev.sourceUrl || ev.url || "";
            const sourceBtn = sourceUrl
                ? `<a href="${sourceUrl}" target="_blank" rel="noreferrer" class="${context === "popup" ? "popup-btn-v2 ghost" : "card-action-btn link"}" onclick="event.stopPropagation();">來源</a>`
                : "";
            return `<div class="event-actions event-actions--${context}" data-interaction-type="fortune"><div class="${context === "popup" ? "popup-action-group" : "card-action-group"}">${buttons}${report}${sourceBtn}</div></div>`;
        }
        return renderEventActions(ev, options);
    }
    function buildPopupHtmlV2(ev, displayTitle, displayContent, markerStyle, twCopy = null) {
        if (currentMapMode === "fortune") {
            const f = getEventFortuneLevel(ev);
            const mapTitle = {
                "great-risk": "大凶｜高風險事件",
                risk: "凶｜注意事件",
                good: "吉｜可前往事件",
                "great-good": "大吉｜推薦事件",
                neutral: "觀察｜持續留意"
            }[f.level];
            return `
                <div class="popup-demo-inner fortune-popup fortune-${f.level}" style="--popup-color:${f.color}">
                    <div class="fortune-popup-level">${mapTitle}</div>
                    <div class="popup-summary">${f.content}</div>
                    <div class="fortune-popup-raw">原始事件：${displayTitle}</div>
                    ${renderEventActionsV2(ev, { displayTitle, context: "popup" })}
                </div>`;
        }
        return buildPopupHtml(ev, displayTitle, displayContent, markerStyle, twCopy);
    }
    function buildEventCardHtmlV2(ev, displayTitle, displayContent, catVisual, twCopy = null) {
        if (currentMapMode === "fortune") {
            const f = getEventFortuneLevel(ev);
            const sourceUrl = ev.sourceUrl || ev.url || "";
            return `
                <div class="fortune-card fortune-card-${f.level}">
                    <div class="fortune-level-badge">${f.label}</div>
                    <div class="fortune-card-title">${f.label}｜${f.title}</div>
                    <div class="fortune-card-content">${f.content}</div>
                    <div class="fortune-card-raw">來源資料：${displayTitle}</div>
                    <div class="card-actions">
                        ${renderEventActionsV2(ev, { displayTitle, context: "card" })}
                        ${sourceUrl ? `<a href="${sourceUrl}" target="_blank" rel="noreferrer" class="card-action-btn link" onclick="event.stopPropagation();">來源</a>` : ""}
                    </div>
                </div>`;
        }
        return buildEventCardHtml(ev, displayTitle, displayContent, catVisual, twCopy);
    }

    function getDataEmptyStateHtml(nearbyPreferred = false) {
        let icon = "fa-map-location-dot";
        let title = "目前沒有可顯示的事件";
        let body = "資料源目前沒有回傳事件，或事件尚未通過座標與分類整理。";

        if (dataSyncState.status === "loading") {
            icon = "fa-rotate";
            title = "正在同步事件資料";
            body = "正在讀取交通、新聞與活動資料，完成後會自動更新地圖與清單。";
        } else if (dataSyncState.status === "error") {
            icon = "fa-triangle-exclamation";
            title = "暫時讀不到事件資料";
            body = "可能是資料服務或網路暫時異常，請稍後重新整理。";
        } else if (nearbyPreferred) {
            icon = "fa-location-crosshairs";
            title = `附近 ${formatRadiusLabel(nearbyRadiusMeters)} 沒有事件`;
            body = "可以放大附近範圍，或切回全台事件查看其他區域。";
        } else if (parsedEvents.length > 0) {
            icon = "fa-filter";
            title = "沒有符合目前條件的事件";
            body = "試著清除搜尋、改選全部分類，或切回全台範圍。";
        }

        return `
            <div class="empty-state data-empty-state">
                <i class="fa-solid ${icon}"></i>
                <strong>${title}</strong>
                <p>${body}</p>
                <small>最後更新：${dataSyncState.lastUpdated ? formatDataTimestamp(dataSyncState.lastUpdated) : "尚無更新時間"}</small>
            </div>`;
    }

    function renderEvents(){
        const mapEvents = getFilteredEvents({ forMap: true });
        const isFortune = currentMapMode === "fortune";
        const nearbyPreferred = (isNearbyMode || isFortune) && userLocation;
        let events = nearbyPreferred
            ? getEventsNearUser(mapEvents, nearbyRadiusMeters)
            : mapEvents;
        nearbyEventsCache = nearbyPreferred ? events : [];
        const isOnline = currentMapMode === "online";
        const isMobile = isMobileViewport();
        const markerLimit = isMobile ? MOBILE_MARKER_LIMIT : Infinity;
        const cardLimit = isMobile ? MOBILE_EVENT_CARD_LIMIT : Infinity;
        const config = isOnline ? TW_ONLINE_CATEGORIES : CATEGORY_CONFIG;
        const mapConfig = isOnline ? CATEGORY_MAP.online : CATEGORY_MAP.normal;

        events.sort((a,b)=>{
            const aNews=(a.source==="news"||a.source==="RSS")?1:0;
            const bNews=(b.source==="news"||b.source==="RSS")?1:0;
            return bNews-aNews;
        });

        clearRenderedMarkers();
        eventRegistry.clear();
        eventList.innerHTML="";
        updateCurationMeta(events);
        updateDataTrustPanel(events.length);
        updateNearbyButtonsV2();
        setNearbyStatusTextV2();
        let renderedCardCount = 0;

        if(!events.length){
            if (isFortune && !userLocation) {
                eventList.innerHTML = `
                    <div class="empty-state fortune-empty-state">
                        <i class="fa-solid fa-location-crosshairs"></i>
                        <p>請先啟用我的周邊</p>
                        <small>趨吉避凶模式會依照你的位置判讀附近事件。</small>
                        <button type="button" id="fortune-nearby-cta" class="card-action-btn primary">啟用定位</button>
                    </div>`;
                const cta = document.getElementById("fortune-nearby-cta");
                if (cta) cta.addEventListener("click", () => requestUserLocationV2());
            } else {
                const emptyText = nearbyPreferred
                    ? (isFortune ? "目前範圍內沒有吉凶事件，可放大搜尋範圍。" : `附近 ${formatRadiusLabel(nearbyRadiusMeters)} 目前沒有事件`)
                    : (isOnline ? TW_ONLINE_TEXT.emptyState : "目前沒有符合條件的台灣即時事件地圖資料");
                eventList.innerHTML=`<div class="empty-state"><i class="fa-solid fa-map-location-dot"></i><p>${emptyText}</p></div>`;
            }
        }
        if (!events.length && !(isFortune && !userLocation)) {
            eventList.innerHTML = getDataEmptyStateHtml(nearbyPreferred);
        }

        mapEvents.forEach((ev, index)=>{
            const mappedCat = inferEventGroupCategory(ev);
            const cat = config[mappedCat]||config.other;
            const latlng = [Number(ev.lat),Number(ev.lng)];

            // Marker
            const twCopy = isTwOnlineMode() ? getTwOnlineEventCopy(ev) : null;
            const displayTitle = twCopy ? twCopy.title : (ev.title || "未命名事件");
            const displayContent = twCopy ? twCopy.content : (ev.content || "目前尚無內容");
            eventRegistry.set(String(ev.id), { ...ev, displayTitle });
            const severity = getEventSeverity(ev);
            const fortune = isFortune ? getEventFortuneLevel(ev) : null;
            const markerSeverity = fortune && ["great-risk", "great-good"].includes(fortune.level)
                ? Math.min(5, severity + 1)
                : severity;
            const markerStyle = fortune
                ? { color: fortune.color, glow: `${fortune.color}AA` }
                : resolveMarkerStyle(ev, cat.color);
            const markerIcon = fortune
                ? ({
                    "great-risk": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3L2.8 19h18.4L12 3z"></path><path d="M12 9v4"></path><circle cx="12" cy="16.4" r="0.9" fill="currentColor"></circle></svg>`,
                    risk: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v6"></path><circle cx="12" cy="16.5" r="1" fill="currentColor"></circle></svg>`,
                    good: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4l2.3 4.7L19.5 9l-3.8 3.6.9 5.2L12 15.4 7.4 17.8l.9-5.2L4.5 9l5.2-.3L12 4z"></path></svg>`,
                    "great-good": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2.8l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6-4.3-4.2 6-.9L12 2.8z"></path></svg>`,
                    neutral: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"></circle><path d="M12 8.5h.01"></path><path d="M11.2 11.5H12v4"></path></svg>`
                }[fortune.level])
                : (CAT_SVG[inferEventGroupCategory(ev)] || CAT_SVG.other);

            const catVisual = getCategoryVisual(ev.category);
            let popup = null;

            if (index < markerLimit && isMapboxRuntime()) {
            const pinPulse = shouldPinPulse(ev, severity);
            const popupHtml = buildPopupHtmlV2(ev, displayTitle, displayContent, markerStyle, twCopy);

            popup = new mapboxgl.Popup({
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
                // 敲木魚已在 popup HTML 直接渲染。
            });
            popup.on("close", () => { if (activePopup === popup) activePopup = null; });

            const markerElement = makeMarkerElement(
                markerStyle.color,
                markerIcon,
                markerSeverity,
                markerStyle.glow,
                fortune ? ["great-risk", "great-good"].includes(fortune.level) : pinPulse
            );
            const marker = new mapboxgl.Marker({
                element: markerElement,
                // 圖釘座標要鎖在「尖端」，縮放時才不會看起來漂移。
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
            if (isNearbyMode && nearbyEventsCache.some((n) => String(n.id) === String(ev.id))) {
                markerEl.classList.add("marker-active");
            }

            if (!isMobile) {
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
            }

            renderedMarkers.push(marker);
            }
            else if (index < markerLimit && window._fallbackMap) {
                const element = makeMarkerElement(
                    markerStyle.color,
                    markerIcon,
                    markerSeverity,
                    markerStyle.glow,
                    fortune ? ["great-risk", "great-good"].includes(fortune.level) : shouldPinPulse(ev, severity)
                );
                const pinW = Number(element.dataset.pinWidth) || 45;
                const pinH = Number(element.dataset.pinHeight) || 65;
                const marker = L.marker([latlng[0], latlng[1]], {
                    icon: L.divIcon({
                        html: element.outerHTML,
                        className: "leaflet-demo-pin",
                        iconSize: [0, 0],
                        iconAnchor: [0, 0],
                        popupAnchor: [0, -pinH]
                    })
                }).addTo(window._fallbackMap)
                    .bindPopup(buildPopupHtmlV2(ev, displayTitle, displayContent, markerStyle), {
                        className: "custom-popup",
                        maxWidth: 328
                    });
                renderedMarkers.push(marker);
            }

            if (nearbyPreferred && !nearbyEventsCache.some((n) => String(n.id) === String(ev.id))) return;
            if (renderedCardCount >= cardLimit) return;

            const card = document.createElement("article");
            card.className = `event-card-v2${isFortune ? " fortune-event-card" : ""}`;
            card.style.setProperty("--card-color", catVisual.color);
            card.innerHTML = buildEventCardHtmlV2(ev, displayTitle, displayContent, catVisual, twCopy);

            card.addEventListener("click",e=>{
                if(e.target instanceof HTMLElement&&(e.target.tagName==="A"||e.target.tagName==="BUTTON"||e.target.closest("button"))) return;
                closeActivePopup();
                eventList.querySelectorAll(".event-card-v2.selected").forEach(el => el.classList.remove("selected"));
                card.classList.add("selected");
                flyToLatLng(latlng, ev.source==="TDX CMS"?14:13, 800);
                if (popup && isMapboxRuntime()) popup.addTo(map);
                if(window.innerWidth<768) newsSidebar.classList.add("drawer-collapsed");
            });

            eventList.appendChild(card);
            renderedCardCount += 1;
            // 敲木魚已在 renderEventActions() 直接渲染，避免 /api/reaction 載入失敗時按鈕消失。
        });

        if (isNearbyMode && userLocation) drawUserLocationOverlay();
        const cnt=document.getElementById("mobile-count");
        if(cnt) cnt.textContent=`${events.length} 筆`;
        lastRenderedEventCount = events.length;
        updateMobileFilterSummary(events.length);
        if (isNearbyMode) {
            setStatus(events.length > 0 ? `附近 ${formatRadiusLabel(nearbyRadiusMeters)}：${events.length} 件事件` : `附近 ${formatRadiusLabel(nearbyRadiusMeters)} 目前沒有事件`);
        } else {
            setStatus(currentMapMode === "online"
                ? "TW Online 視覺層啟用中｜公共事件資料不變"
                : `已載入 ${events.length} 筆事件`);
        }
    }

    // ?? MOCK DATA ????????????????????????????????????????????
    const MOCK_EVENTS = [
    { id: "m1", title: "國道北上車流回堵", category: "traffic", city: "台北市", lat: 25.07, lng: 121.56, source: "Concept Demo", content: "尖峰車流較高，建議提前改道。" },
    { id: "m2", title: "新北工地吊掛作業提醒", category: "construction", city: "新北市", lat: 25.02, lng: 121.46, source: "Concept Demo", content: "施工區周邊採單線通行。" },
    { id: "m3", title: "花蓮近海有感地震", category: "earthquake", city: "花蓮縣", lat: 24.02, lng: 121.62, source: "Concept Demo", content: "目前無重大災情通報。" }
];

const DEMO_LOCATIONS = [
    { city: "台北市", lat: 25.0478, lng: 121.5170 },
    { city: "新北市", lat: 25.0120, lng: 121.4650 },
    { city: "基隆市", lat: 25.1283, lng: 121.7392 },
    { city: "桃園市", lat: 24.9936, lng: 121.3010 },
    { city: "新竹市", lat: 24.8138, lng: 120.9675 },
    { city: "苗栗縣", lat: 24.5602, lng: 120.8214 },
    { city: "台中市", lat: 24.1477, lng: 120.6736 },
    { city: "彰化縣", lat: 24.0800, lng: 120.5380 },
    { city: "南投縣", lat: 23.9609, lng: 120.9719 },
    { city: "雲林縣", lat: 23.7092, lng: 120.4313 },
    { city: "嘉義市", lat: 23.4801, lng: 120.4491 },
    { city: "台南市", lat: 22.9997, lng: 120.2270 },
    { city: "高雄市", lat: 22.6273, lng: 120.3014 },
    { city: "屏東縣", lat: 22.5519, lng: 120.5487 },
    { city: "宜蘭縣", lat: 24.7021, lng: 121.7378 },
    { city: "花蓮縣", lat: 23.9911, lng: 121.6112 },
    { city: "台東縣", lat: 22.7583, lng: 121.1444 },
    { city: "澎湖縣", lat: 23.5711, lng: 119.5793 },
    { city: "金門縣", lat: 24.4321, lng: 118.3171 },
    { city: "連江縣", lat: 26.1602, lng: 119.9517 }
];

const makeDemoTemplate = (title, category, severity, impactLevel, summary) => ({
    title,
    category,
    severity,
    impactLevel,
    summary
});

const TRAFFIC_DEMO_TEMPLATES = [
    makeDemoTemplate("台北車站周邊公車專用道調整", "traffic", 3, "中度", "尖峰時段車流回堵，警方啟動分流與號誌調整。"),
    makeDemoTemplate("新北板橋文化路地下道施工壅塞", "traffic", 2, "中度", "施工占用外側車道，通勤車潮行進速度下降。"),
    makeDemoTemplate("基隆港西岸貨櫃車進出管制", "traffic", 3, "中度", "港區聯外道路車多，建議改走替代路線。"),
    makeDemoTemplate("桃園機場捷運接駁車延誤", "traffic", 2, "低度", "接駁車班距拉長，旅客轉乘需預留時間。"),
    makeDemoTemplate("新竹科學園區匝道車流回堵", "traffic", 3, "中度", "下班尖峰匝道排隊，交通隊現場疏導。"),
    makeDemoTemplate("苗栗台十三線路面刨鋪交管", "traffic", 2, "低度", "局部單線雙向通行，工程車輛進出頻繁。"),
    makeDemoTemplate("台中台灣大道快捷公車改道", "traffic", 3, "中度", "活動封街導致多線公車改停臨時站位。"),
    makeDemoTemplate("彰化員林交流道事故排除後仍壅塞", "traffic", 3, "中度", "車流回堵至平面道路，警力持續調節路口。"),
    makeDemoTemplate("南投台十四甲山區午後車潮增加", "traffic", 2, "低度", "觀光車輛集中上山，部分路段速率偏低。"),
    makeDemoTemplate("雲林斗六市區道路標線重繪", "traffic", 2, "低度", "夜間施工縮減車道，提醒駕駛減速慢行。"),
    makeDemoTemplate("嘉義火車站前圓環號誌故障", "traffic", 3, "中度", "員警手控指揮，周邊公車班次略受影響。"),
    makeDemoTemplate("台南中西區停車場滿位外溢", "traffic", 2, "低度", "商圈車潮增加，市府啟動停車導引資訊。"),
    makeDemoTemplate("高雄中正路輕軌施工改道", "traffic", 3, "中度", "多處路口縮減車道，機車與公車需依標誌通行。"),
    makeDemoTemplate("屏東潮州省道水管工程交管", "traffic", 2, "低度", "工程圍籬占用慢車道，尖峰時段易形成瓶頸。"),
    makeDemoTemplate("宜蘭國五交流道返程車流升高", "traffic", 3, "中度", "高公局建議分散時段，匝道儀控已啟動。"),
    makeDemoTemplate("花蓮市區觀光巴士臨停熱點管制", "traffic", 2, "低度", "熱門景點周邊設臨停區，減少車輛交織。")
];

const MAJOR_DEMO_TEMPLATES = [
    makeDemoTemplate("台東海岸遊客溺水送醫不治", "accident", 5, "重大", "海域突遇離岸流，搜救人員到場搶救，仍傳出死亡。"),
    makeDemoTemplate("澎湖漁港吊掛作業工安重傷", "safety", 5, "重大", "吊臂滑落波及作業員，現場啟動工安調查與停工。"),
    makeDemoTemplate("金門民宅火災延燒一人送醫", "incident", 5, "重大", "深夜火災造成濃煙竄出，住戶吸入性嗆傷送醫。"),
    makeDemoTemplate("連江碼頭堆高機翻覆事故", "accident", 4, "重大", "堆高機作業時翻覆，駕駛重傷送醫觀察。"),
    makeDemoTemplate("台北大樓外牆施工墜落意外", "safety", 5, "重大", "施工平台疑固定失效，工人墜落造成重傷。"),
    makeDemoTemplate("新北工地鷹架倒塌壓傷工人", "safety", 5, "重大", "工安事故造成多人送醫，勞檢單位要求停工改善。"),
    makeDemoTemplate("基隆倉庫火災濃煙影響鄰里", "incident", 4, "重大", "倉庫火災延燒雜物，消防隊布線灌救並疏散居民。"),
    makeDemoTemplate("桃園砂石車擦撞機車重傷", "accident", 4, "重大", "路口轉彎視線死角釀禍，騎士重傷送醫。"),
    makeDemoTemplate("新竹化學槽車洩漏工安事件", "safety", 5, "重大", "槽車閥件異常導致刺鼻氣味外洩，廠區啟動工安應變。"),
    makeDemoTemplate("苗栗登山步道墜落救援", "accident", 4, "重大", "山友失足墜落邊坡，消防搜救隊以繩索系統吊掛送醫。"),
    makeDemoTemplate("台中市場瓦斯爆炸多人受傷", "incident", 5, "重大", "疑瓦斯外洩引發爆炸，現場有重傷與輕傷民眾。"),
    makeDemoTemplate("彰化工廠機台夾傷工安事故", "safety", 5, "重大", "作業員手部遭機台捲入重傷，廠方通報勞檢。"),
    makeDemoTemplate("南投溪谷戲水溺水搜救", "accident", 5, "重大", "溪水暴漲造成民眾受困，搜救後確認一人死亡。"),
    makeDemoTemplate("雲林農舍火災波及鄰屋", "incident", 4, "重大", "火災延燒倉儲空間，消防隊阻止火勢擴大。"),
    makeDemoTemplate("嘉義工人屋頂修繕墜落", "safety", 5, "重大", "屋頂修繕期間失足墜落，傷者重傷送醫。"),
    makeDemoTemplate("台南夜市攤位油鍋起火", "incident", 4, "重大", "攤位油鍋起火造成驚慌，消防到場後迅速撲滅火災。"),
    makeDemoTemplate("高雄港區貨櫃車碰撞死亡事故", "accident", 5, "重大", "港區道路發生碰撞，駕駛受困救出後宣告死亡。"),
    makeDemoTemplate("屏東加工廠電氣火災停工", "safety", 5, "重大", "電氣室火災造成設備受損，工安單位要求檢修後復工。")
];

const DISASTER_DEMO_TEMPLATES = [
    makeDemoTemplate("宜蘭山區土石流黃色警戒", "disaster", 4, "重大", "連日降雨使溪水混濁，保全戶名冊已完成更新。"),
    makeDemoTemplate("花蓮近海規模5.4地震", "earthquake", 4, "重大", "地震造成部分地區有感，交通與水電設施巡檢中。"),
    makeDemoTemplate("台東縱谷餘震頻繁通報", "earthquake", 3, "中度", "地震後小區域餘震增加，校舍與橋梁進行安全巡查。"),
    makeDemoTemplate("澎湖強風浪海上警戒", "typhoon", 3, "中度", "颱風外圍環流影響，離島航線視海象調整。"),
    makeDemoTemplate("金門沿岸暴潮防範通知", "typhoon", 3, "中度", "颱風接近期間沿岸低窪區加強巡查。"),
    makeDemoTemplate("連江港區防颱加固作業", "typhoon", 4, "重大", "船舶進港避風，港務單位完成纜繩與設施檢查。"),
    makeDemoTemplate("台北山坡地落石封閉步道", "disaster", 3, "中度", "山區步道邊坡鬆動，市府暫停開放並派員巡檢。"),
    makeDemoTemplate("新北溪流水位快速上升", "disaster", 4, "重大", "豪雨使溪流水位逼近警戒，區公所通知低窪住戶。"),
    makeDemoTemplate("基隆短延時強降雨積淹水", "disaster", 3, "中度", "排水系統滿載，市區低窪路段短暫積水。"),
    makeDemoTemplate("桃園沿海風力達停班課標準邊緣", "typhoon", 3, "中度", "颱風外圍風勢增強，市府評估晚間交通安全。"),
    makeDemoTemplate("新竹丘陵坡地滑動監測", "disaster", 3, "中度", "監測點位移增加，相關單位加密觀測頻率。"),
    makeDemoTemplate("苗栗近海地震震度三級", "earthquake", 3, "中度", "地震造成短暫搖晃，消防與電力單位回報正常。")
];

const WEATHER_DEMO_TEMPLATES = [
    makeDemoTemplate("台中午後雷陣雨機率升高", "weather", 2, "低度", "氣象單位提醒午後對流旺盛，外出攜帶雨具。"),
    makeDemoTemplate("彰化沿海空氣濕度偏高", "weather", 2, "低度", "清晨能見度略降，用路人留意視線變化。"),
    makeDemoTemplate("南投山區午後雲量增多", "weather", 2, "低度", "山區天氣變化快，登山行程建議提早下撤。"),
    makeDemoTemplate("雲林平原高溫橙色燈號", "weather", 2, "低度", "午後溫度偏高，戶外工作者注意補水休息。"),
    makeDemoTemplate("嘉義市區紫外線指數偏高", "weather", 2, "低度", "白天日照強，民眾外出建議做好防曬。"),
    makeDemoTemplate("台南沿海晚間風勢增強", "weather", 2, "低度", "海風明顯，騎乘機車與戶外活動注意風勢。"),
    makeDemoTemplate("高雄空品擴散條件普通", "weather", 2, "低度", "午後海陸風轉換，敏感族群留意即時空品。"),
    makeDemoTemplate("屏東恆春半島局部陣風", "weather", 2, "低度", "落山風增強，行經空曠路段注意穩定車速。")
];

const ACTIVITY_DEMO_TEMPLATES = [
    makeDemoTemplate("宜蘭童玩市集周末登場", "activity", 1, "低度", "親子攤位與表演活動集中於河岸廣場。"),
    makeDemoTemplate("花蓮港濱音樂展演開放入場", "activity", 1, "低度", "傍晚安排在地樂團與餐車，周邊設臨時接駁。"),
    makeDemoTemplate("台東鐵花村手作小旅行", "activity", 1, "低度", "文化工作坊與導覽路線串聯市區店家。"),
    makeDemoTemplate("澎湖海洋生活節試營運", "activity", 1, "低度", "展區介紹潮間帶生態與海島工藝。"),
    makeDemoTemplate("金門古城夜間導覽開放報名", "activity", 1, "低度", "導覽路線結合歷史建築與地方小吃。"),
    makeDemoTemplate("連江藍眼淚觀測季說明會", "activity", 1, "低度", "遊客中心提供觀測時段與交通資訊。"),
    makeDemoTemplate("台北河岸電影放映活動", "activity", 1, "低度", "戶外放映區採自由入座，現場有交通導引。")
];

const SPORTS_DEMO_TEMPLATES = [
    makeDemoTemplate("新北河濱馬拉松分組起跑", "sports", 1, "低度", "賽道沿河岸設補給站，周邊道路採時段管制。"),
    makeDemoTemplate("基隆港灣自行車挑戰賽", "sports", 1, "低度", "參賽路線串聯港區與海岸景點。"),
    makeDemoTemplate("桃園棒球主場系列賽", "sports", 1, "低度", "晚間賽事入場人潮增加，捷運加開疏運班次。"),
    makeDemoTemplate("新竹城市三對三籃球賽", "sports", 1, "低度", "市民廣場設置臨時球場與觀眾區。"),
    makeDemoTemplate("苗栗山城越野跑", "sports", 1, "低度", "路線經丘陵步道，主辦單位設補給與醫護站。"),
    makeDemoTemplate("台中洲際青少棒邀請賽", "sports", 1, "低度", "多校隊伍參與，球場周邊停車需求升高。")
];

const DEMO_EVENT_TEMPLATES = [
    ...TRAFFIC_DEMO_TEMPLATES,
    ...MAJOR_DEMO_TEMPLATES,
    ...DISASTER_DEMO_TEMPLATES,
    ...WEATHER_DEMO_TEMPLATES,
    ...ACTIVITY_DEMO_TEMPLATES,
    ...SPORTS_DEMO_TEMPLATES
];

const EXTRA_DEMO_EVENTS = [
    {
        id: "demo-tn-01",
        title: "台南小東路車流回堵",
        content: "小東路與長榮路周邊車流增加，通勤時段可能影響行車速度。",
        summary: "小東路與長榮路周邊車流增加，通勤時段可能影響行車速度。",
        category: "traffic",
        city: "台南市",
        area: "東區",
        lat: 22.9996,
        lng: 120.2218,
        severity: 3,
        source: "展示資料",
        sourceName: "展示資料",
        isDemo: true,
        impactLevel: "中度",
        interactionCount: 246,
        publishedAt: new Date(Date.UTC(2026, 5, 2, 0, 5)).toISOString()
    },
    {
        id: "demo-tn-02",
        title: "成大周邊路口事故處理",
        content: "成功大學周邊路口發生輕微事故，現場處理中，建議行人與車輛小心通行。",
        summary: "成功大學周邊路口發生輕微事故，現場處理中，建議行人與車輛小心通行。",
        category: "accident",
        city: "台南市",
        area: "東區",
        lat: 22.9979,
        lng: 120.2199,
        severity: 4,
        source: "展示資料",
        sourceName: "展示資料",
        isDemo: true,
        impactLevel: "高度",
        interactionCount: 312,
        hasCasualty: false,
        publishedAt: new Date(Date.UTC(2026, 5, 2, 0, 12)).toISOString()
    },
    {
        id: "demo-tn-03",
        title: "台南公園午後市集",
        content: "台南公園周邊出現午後市集與人流聚集，可前往散步，但需留意周邊交通。",
        summary: "台南公園周邊出現午後市集與人流聚集，可前往散步，但需留意周邊交通。",
        category: "activity",
        city: "台南市",
        area: "北區",
        lat: 23.0018,
        lng: 120.2107,
        severity: 2,
        source: "展示資料",
        sourceName: "展示資料",
        isDemo: true,
        impactLevel: "輕度",
        interactionCount: 198,
        publishedAt: new Date(Date.UTC(2026, 5, 2, 0, 18)).toISOString()
    }
];

const DEMO_EVENTS = [
    ...DEMO_EVENT_TEMPLATES.slice(0, 67).map((base, i) => {
    const location = DEMO_LOCATIONS[i % DEMO_LOCATIONS.length];
    const latOffset = ((i * 37) % 100 - 50) * 0.0018;
    const lngOffset = ((i * 53) % 100 - 50) * 0.0018;
    const category = normalizeText(base.category).toLowerCase();
    const hasCasualty = ["accident", "incident", "safety"].includes(category) && base.severity >= 4;
    return normalizeDisplayEvent({
        id: `demo-${String(i + 1).padStart(2, "0")}`,
        title: base.title,
        summary: base.summary,
        content: base.summary,
        category,
        city: location.city,
        lat: Number((location.lat + latOffset).toFixed(6)),
        lng: Number((location.lng + lngOffset).toFixed(6)),
        severity: base.severity,
        impactLevel: base.impactLevel,
        interactionCount: Math.max(80, 680 - i * 7 + (base.severity * 11)),
        hasCasualty,
        source: "Concept Demo",
        sourceName: "Island Pulse Concept Demo",
        sourceUrl: "https://example.com/island-pulse-concept-demo",
        publishedAt: new Date(Date.UTC(2026, 4, 30, 0, i * 7)).toISOString(),
    });
    }),
    ...EXTRA_DEMO_EVENTS.map(normalizeDisplayEvent)
];

console.log("DEMO_EVENTS length", DEMO_EVENTS.length);
console.log("unique cities", new Set(DEMO_EVENTS.map(e => e.city)).size);
console.log("unique coords", new Set(DEMO_EVENTS.map(e => `${e.lat},${e.lng}`)).size);

async function syncNewsAndRender(){
        setStatus("Concept Demo 載入中...");
        parsedEvents = DEMO_EVENTS.map(normalizeDisplayEvent);
        console.log("parsedEvents length", parsedEvents.length);
        renderCategoryButtons();
        renderEvents();
        setStatus(currentMapMode === "online"
            ? "TW Online 視覺層啟用中｜公共事件資料不變"
            : `Golden Pin Concept Edition｜${parsedEvents.length} 筆事件`);
    }

    // ?? CITY SYNC ????????????????????????????????????????????
    async function syncLiveEventsAndRender(){
        setStatus("正在同步事件資料...");
        setDataSyncState({ status: "loading", message: "正在同步事件資料" });

        try {
            const response = await fetch("/api/events", { cache: "no-store" });
            if (!response.ok) throw new Error(`events api ${response.status}`);
            const records = await response.json();
            const events = Array.isArray(records) ? records.map(normalizeDisplayEvent) : [];
            const headerSources = readHeaderList(response.headers, "X-Data-Sources");
            const total = Number(response.headers.get("X-Event-Total") || events.length);
            const lastEventTime = response.headers.get("X-Last-Event-Time") || "";
            const cacheUpdatedTime = response.headers.get("X-Cache-Updated-Time") || "";
            const store = response.headers.get("X-Data-Store") || "";

            parsedEvents = deduplicateEvents(events);
            setDataSyncState(buildDataStateFromEvents(parsedEvents, {
                total: Number.isFinite(total) ? total : parsedEvents.length,
                sources: headerSources.length ? headerSources : undefined,
                lastUpdated: lastEventTime || cacheUpdatedTime || undefined,
                store,
                message: parsedEvents.length ? "事件資料已同步" : "資料源目前沒有回傳事件"
            }));
        } catch (error) {
            console.warn("events sync failed", error);
            parsedEvents = [];
            setDataSyncState({
                status: "error",
                total: 0,
                lastUpdated: "",
                sources: [],
                message: "暫時讀不到事件資料，請稍後再試"
            });
        }

        console.log("parsedEvents length", parsedEvents.length);
        renderCategoryButtons();
        renderEvents();
        if (parsedEvents.length) setStatus(`已同步 ${parsedEvents.length} 筆事件`);
        else if (dataSyncState.status === "error") setStatus("事件資料讀取失敗");
        else setStatus("目前沒有可顯示的事件資料");
    }

    function syncCityFilter(value){
        document.getElementById("city-filter").value=value;
        document.getElementById("city-filter-mobile").value=value;
        drawCityBoundary(value);
        renderEvents();
        const centers = {
            "台北市":[25.033,121.565], "新北市":[25.011,121.466], "基隆市":[25.128,121.739],
            "桃園市":[24.994,121.301], "新竹市":[24.814,120.968], "新竹縣":[24.828,121.013],
            "苗栗縣":[24.560,120.821], "台中市":[24.148,120.674], "彰化縣":[24.052,120.539],
            "南投縣":[23.903,120.688], "雲林縣":[23.709,120.431], "嘉義市":[23.480,120.449],
            "嘉義縣":[23.452,120.255], "台南市":[23.000,120.227], "高雄市":[22.627,120.301],
            "屏東縣":[22.672,120.486], "宜蘭縣":[24.730,121.763], "花蓮縣":[23.987,121.602],
            "台東縣":[22.758,121.144], "澎湖縣":[23.571,119.579], "金門縣":[24.449,118.376],
            "連江縣":[26.150,119.936]
        };
        const match = Object.keys(centers).find(k=>k.startsWith(value)||value.startsWith(k));
        if(value==="all"){
            flyToLatLng([23.698,120.961],7,1500);
        } else if(match){
            flyToLatLng(centers[match],11,1500);
        }
    }

    // ?? MODE ?????????????????????????????????????????????????
    const BAR_COLORS = ['#4f8cff','#a78bfa','#34d399','#fb923c','#f05a5a','#fbbf24','#5eead4','#c4b5fd','#86efac','#fdba74'];

    const CAT_COLORS = {
      traffic:    { bg:'rgba(79,140,255,0.15)',  color:'#4f8cff',  text:'交通' },
      accident:   { bg:'rgba(249,115,22,0.15)',  color:'#f97316',  text:'意外' },
      disaster:   { bg:'rgba(240,90,90,0.15)',   color:'#f05a5a',  text:'災害' },
      weather:    { bg:'rgba(56,189,248,0.15)',  color:'#38bdf8',  text:'天氣' },
      activity:   { bg:'rgba(52,211,153,0.15)',  color:'#34d399',  text:'活動' },
      sports:     { bg:'rgba(167,139,250,0.15)', color:'#a78bfa',  text:'賽事' },
      other:      { bg:'rgba(107,114,128,0.15)', color:'#6b7280',  text:'其他' },
    };


    function updateMobileDrawerVisibilityForMode(){
      if (!newsSidebar) return;
      const shouldHideDrawer = !isTaiwanMode && isMobileViewport();
      newsSidebar.style.display = shouldHideDrawer ? "none" : "";
      if (shouldHideDrawer) {
        newsSidebar.classList.remove("drawer-collapsed");
        newsSidebar.classList.remove("filters-collapsed");
      }
    }
 
    function switchMode(mode){ 
      isTaiwanMode = mode; 
      const mapEl    = document.getElementById('map'); 
      const statsEl  = document.getElementById('stats-view'); 
      const isStatsMode = !mode;
      document.body.classList.toggle('stats-mode', isStatsMode);
 
      ['btn-tw','btn-tw-mobile'].forEach(id=>{ 
        const b=document.getElementById(id); 
        if(b) b.classList.toggle('active', mode); 
      }); 
      ['btn-global','btn-global-mobile'].forEach(id=>{ 
        const b=document.getElementById(id); 
        if(b) b.classList.toggle('active', !mode); 
      }); 

      updateMobileDrawerVisibilityForMode();
 
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
 
      // 蝮賣 
      const totalEl = document.getElementById('stat-total'); 
      if(totalEl) totalEl.textContent = events.length; 
 
      // ???? 
      const cityMap = {}; 
      events.forEach(ev=>{ 
        if(!ev.city) return; 
        const city = (ev.city||'').replace(/撣?|蝮?/,'').slice(0,3); 
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
 
      // Reaction 蝮賣 
      fetch('/api/reactions/total') 
        .then(r=>r.json()) 
        .then(data=>{ 
          const m=document.getElementById('stat-muyu'); 
          const incense=document.getElementById('stat-incense'); 
          if(m) m.textContent=(data.muyu||0).toLocaleString(); 
          if(incense) incense.textContent=(data.candle||0).toLocaleString(); 
        }) 
        .catch(()=>{ 
          const m=document.getElementById('stat-muyu'); 
          const incense=document.getElementById('stat-incense'); 
          if(m) m.textContent='0'; 
          if(incense) incense.textContent='0'; 
        }); 
 
      // 讀取熱門事件的互動統計。
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
        hotEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">目前沒有互動資料</div>'; 
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
              <span style="font-size:11px;color:var(--text-secondary);">木魚 ${ev.muyu} &nbsp;上香 ${ev.candle}</span> 
            </div> 
            <div style="font-size:12px;color:var(--text-primary);line-height:1.55;margin-bottom:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${title}</div> 
            <div style="font-size:11px;color:var(--text-muted);">地點 ${city}</div> 
          </div> 
        `; 
      }).join(''); 
    } 


    // ?? SEARCH ???????????????????????????????????????????????
    async function renderStatsView(){
      const events = parsedEvents.filter(ev => {
        const lat = Number(ev.lat), lng = Number(ev.lng);
        return Number.isFinite(lat) && Number.isFinite(lng) && isValidTaiwanCoord(lat, lng);
      });
      updateCurationMeta(events);

      const totalEl = document.getElementById('stat-total');
      if (totalEl) totalEl.textContent = events.length.toLocaleString();

      const statMuyu = document.getElementById('stat-muyu');
      const statIncense = document.getElementById('stat-incense');
      const totalSignals = events.reduce((sum, ev) => sum + Number(ev.interactionCount || 0), 0);
      const highRisk = events.filter(ev => getSeverityBand(ev) === "high").length;
      if (statMuyu) statMuyu.textContent = totalSignals.toLocaleString();
      if (statIncense) statIncense.textContent = highRisk.toLocaleString();

      const cityMap = {};
      events.forEach(ev => {
        if (!ev.city) return;
        cityMap[ev.city] = (cityMap[ev.city] || 0) + 1;
      });
      const sortedCities = Object.entries(cityMap).sort((a,b) => b[1] - a[1]).slice(0, 8);
      const maxCity = sortedCities[0]?.[1] || 1;
      const barsEl = document.getElementById('city-bars');
      if (barsEl) {
        barsEl.innerHTML = sortedCities.map(([city,count],i) => `
          <div class="stats-bar-row">
            <span class="stats-bar-label">${city}</span>
            <div class="stats-bar-track">
              <div class="stats-bar-fill" style="width:${Math.round(count / maxCity * 100)}%;background:${BAR_COLORS[i % BAR_COLORS.length]};"></div>
            </div>
            <span class="stats-bar-count">${count}</span>
          </div>
        `).join('');
      }

      const catMap = {};
      events.forEach(ev => {
        const key = inferEventGroupCategory(ev) || "other";
        catMap[key] = (catMap[key] || 0) + 1;
      });
      const sortedCats = FIXED_CATEGORY_ORDER
        .filter(cat => cat !== "all" && catMap[cat])
        .map(cat => [cat, catMap[cat]]);
      const maxCat = Math.max(...sortedCats.map(([, count]) => count), 1);
      const catBarsEl = document.getElementById('cat-bars');
      if (catBarsEl) {
        catBarsEl.innerHTML = sortedCats.map(([category,count]) => {
          const visual = getCategoryVisual(category);
          return `
            <div class="stats-bar-row">
              <span class="stats-bar-label">${visual.text}</span>
              <div class="stats-bar-track">
                <div class="stats-bar-fill" style="width:${Math.round(count / maxCat * 100)}%;background:${visual.color};"></div>
              </div>
              <span class="stats-bar-count">${count}</span>
            </div>
          `;
        }).join('');
      }

      const hotEl = document.getElementById('hot-events');
      if (!hotEl) return;
      const apiBoosts = new Map();
      await Promise.all(events.slice(0, 12).map(async ev => {
        try {
          const r = await fetch(`/api/reaction?eventId=${ev.id}`);
          const d = await r.json();
          apiBoosts.set(ev.id, Number(d.muyu || 0) + Number(d.candle || 0));
        } catch {}
      }));
      const topEvents = events
        .map(ev => ({ ...ev, total: Number(ev.interactionCount || 0) + Number(apiBoosts.get(ev.id) || 0) }))
        .sort((a,b) => b.total - a.total)
        .slice(0, 6);
      hotEl.innerHTML = topEvents.map((ev,i) => {
        const cat = getCategoryVisual(ev.category);
        return `
          <div class="hot-event-row">
            <div class="hot-event-rank">${String(i + 1).padStart(2, "0")}</div>
            <div class="hot-event-main">
              <div class="hot-event-meta">
                <span style="color:${cat.color}">${cat.text}</span>
                <span>${ev.city}</span>
                <span>${getImpactLabel(ev)}</span>
              </div>
              <div class="hot-event-title">${ev.title}</div>
            </div>
            <div class="hot-event-score">${ev.total.toLocaleString()} 人已關注</div>
          </div>`;
      }).join('');
    }

    let searchRenderTimer = null;
    function handleSearch(e){
        const rawValue = e.target.value;
        searchKeyword = rawValue.trim().toLowerCase();
        ["event-search", "event-search-mobile"].forEach(id => {
            const input = document.getElementById(id);
            if (input && input !== e.target) input.value = rawValue;
        });
        clearTimeout(searchRenderTimer);
        searchRenderTimer = setTimeout(renderEvents, 150);
    }

    // ?? DRAWER ???????????????????????????????????????????????
    function toggleDrawer(){
        if(window.innerWidth<768) {
            newsSidebar.classList.toggle("drawer-collapsed");
            scheduleMapResize();
        }
    }

    // ?? MOBILE GESTURES ??????????????????????????????????????
    let startY = 0;
    let isDragging = false;
    let pendingDrawerDelta = 0;
    let drawerDragFrame = 0;
    const sidebar = document.getElementById("news-sidebar");

    sidebar.addEventListener("touchstart", e => {
        if (window.innerWidth >= 768) return;
        const touch = e.touches[0];
        const sidebarTop = sidebar.getBoundingClientRect().top;
        // 只在抽屜頂部拖曳區啟用手勢
        if (touch.clientY - sidebarTop > 80) return;
        
        isDragging = true;
        startY = touch.clientY;
        pendingDrawerDelta = 0;
        sidebar.style.transition = "none";
    }, { passive: true });

    sidebar.addEventListener("touchmove", e => {
        if (!isDragging) return;
        const delta = e.touches[0].clientY - startY;
        if (delta < 0) return;
        pendingDrawerDelta = delta;
        if (!drawerDragFrame) {
            drawerDragFrame = requestAnimationFrame(() => {
                drawerDragFrame = 0;
                sidebar.style.transform = `translateY(${pendingDrawerDelta}px)`;
            });
        }
        if (delta < 0) return; // 只處理向下拖曳。
        sidebar.style.transform = `translateY(${delta}px)`;
        
        // 展開狀態時保留內容捲動。
        if (!sidebar.classList.contains("drawer-collapsed")) {
            // touchmove 使用 passive listener，不呼叫 preventDefault。
            e.stopPropagation();
        }
    }, { passive: true });

    sidebar.addEventListener("touchend", e => {
        if (!isDragging) return;
        isDragging = false;
        if (drawerDragFrame) {
            cancelAnimationFrame(drawerDragFrame);
            drawerDragFrame = 0;
        }
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

    // 暺??啣??嗉絲?賢?
    map.on("click", () => {
        if (window.innerWidth < 768) {
            sidebar.classList.add("drawer-collapsed");
            scheduleMapResize();
        }
    });
    window.addEventListener("resize", () => {
        scheduleMapResize();
        updateResponsiveControlsPlacement();
        updateMobileDrawerVisibilityForMode();
        handleMobileFilterScroll();
    });
    window.addEventListener("orientationchange", () => {
        scheduleMapResize();
        updateResponsiveControlsPlacement();
        updateMobileDrawerVisibilityForMode();
        handleMobileFilterScroll();
    });
    if (typeof ResizeObserver !== "undefined") {
        const layoutObserver = new ResizeObserver(() => {
            scheduleMapResize();
        });
        if (mapStage) layoutObserver.observe(mapStage);
        if (newsSidebar) layoutObserver.observe(newsSidebar);
    }
    function getReportOptionsForEvent(ev) {
    const resolvedOption = isActivityEvent(ev) || isSportsEvent(ev)
        ? "活動資訊錯誤"
        : isTrafficEvent(ev)
            ? "路況資訊錯誤"
            : "事件資訊錯誤";

    return ["位置錯誤", resolvedOption, "重複事件", "不是此類事件", "資料過期", "其他"];
}

function renderReportTypeOptions(ev) {
    const typeEl = document.getElementById("report-type");
    if (!typeEl) return;

    const options = getReportOptionsForEvent(ev);
    typeEl.innerHTML = `<option value="">請選擇回報類型</option>` +
        options.map(option => `<option value="${option}">${option}</option>`).join("");
}

function showReportError(message) {
    const errorEl = document.getElementById("report-error");
    const successEl = document.getElementById("report-success");
    if (successEl) successEl.style.display = "none";
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = "block";
    }
}

function showReportSuccess(message) {
    const errorEl = document.getElementById("report-error");
    const successEl = document.getElementById("report-success");
    if (errorEl) errorEl.style.display = "none";
    if (successEl) {
        successEl.textContent = message;
        successEl.style.display = "block";
    }
}

function clearReportMessages() {
    const errorEl = document.getElementById("report-error");
    const successEl = document.getElementById("report-success");
    if (errorEl) {
        errorEl.textContent = "";
        errorEl.style.display = "none";
    }
    if (successEl) {
        successEl.textContent = "";
        successEl.style.display = "none";
    }
}

function closeReportModal() {
    const modal = document.getElementById("report-modal");
    if (modal) modal.classList.remove("visible");
    currentReportEvent = null;
}

function openReportModal(eventOrId) {
    const ev = typeof eventOrId === "string"
        ? eventRegistry.get(String(eventOrId))
        : eventOrId;
    if (!ev) return;

    currentReportEvent = ev;
    clearReportMessages();
    renderReportTypeOptions(ev);

    const titleEl = document.getElementById("report-event-title") || document.getElementById("report-title");
    const noteEl = document.getElementById("report-note") || document.getElementById("report-message");
    const submitBtn = document.getElementById("report-submit-btn");
    if (titleEl) titleEl.value = ev.displayTitle || ev.title || "未命名事件";
    if (noteEl) noteEl.value = "";
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "送出回報";
    }

    const modal = document.getElementById("report-modal");
    if (modal) modal.classList.add("visible");
}

async function submitReport() {
    const ev = currentReportEvent;
    if (!ev) {
        showReportError("找不到事件資料，請重新開啟回報。");
        return;
    }

    const typeEl = document.getElementById("report-type");
    const noteEl = document.getElementById("report-note") || document.getElementById("report-message");
    const submitBtn = document.getElementById("report-submit-btn");
    const type = typeEl?.value || "";
    const note = noteEl?.value || "";

    if (!type) {
        showReportError("請選擇回報類型。");
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "送出中...";
    }

    try {
        await fetch("/api/report", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                eventId: ev.id,
                eventTitle: ev.displayTitle || ev.title || "未命名事件",
                type,
                note,
                createdAt: new Date().toISOString()
            })
        });
        showReportSuccess("已收到回報");
        if (reportCloseTimer) clearTimeout(reportCloseTimer);
        reportCloseTimer = setTimeout(closeReportModal, 900);
    } catch (error) {
        console.warn("Report submit failed", error);
        showReportError("回報送出失敗，請稍後再試。");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "送出回報";
        }
    }
}
    // CONCEPT DEMO MODAL ???????????????????????????????????
    function checkBetaModal(){
        localStorage.setItem("beta_accepted", "true");
        betaModal.classList.remove("visible");
    }
    function closeBetaModal(){
        localStorage.setItem("beta_accepted","true");
        betaModal.classList.remove("visible");
    }

    function applyConceptCopy(){
        const isOnline = currentMapMode === "online";
        const textPairs = [
            [".brand-title", "島嶼脈搏 Island Pulse"],
            [".brand-sub", isOnline ? "TW Online 視覺模式" : "GOLDEN PIN CONCEPT EDITION"],
            [".brand-note", "台灣即時事件地圖｜Concept Demo"],
            [".sidebar-title", "台灣即時事件清單"],
            [".toolbar-caption", "台灣即時事件地圖"],
            ["#server-status", "視覺模式啟用中"],
            ["#player-count", "Concept Demo"],
            ["#tw-online-count", "Concept Demo"],
            ["#hero-mode-copy", isOnline ? "TW Online 視覺模式" : "台灣地圖"]
        ];
        textPairs.forEach(([selector, text]) => {
            const el = document.querySelector(selector);
            if (el) el.textContent = text;
        });
        document.querySelectorAll(".donate-btn").forEach(btn => {
            btn.textContent = "支持作品";
            btn.setAttribute("aria-label", "支持作品");
            btn.setAttribute("title", "支持作品");
        });
        ["search-input", "event-search", "event-search-mobile"].forEach(id => {
            const searchEl = document.getElementById(id);
            if (searchEl) searchEl.placeholder = "搜尋城市、分類或事件";
        });
    }

    // ?? DONATE ???????????????????????????????????????????????
    // Override copy mapper to keep mode labels consistent (normal / fortune / online).
    function applyConceptCopy(){
        const isOnline = currentMapMode === "online";
        const isFortune = currentMapMode === "fortune";
        const textPairs = [
            [".brand-title", "島嶼脈搏 Island Pulse"],
            [".brand-sub", isOnline ? "TW ONLINE 視覺模式" : (isFortune ? "趨吉避凶模式｜吉凶事件判讀" : "台灣即時事件地圖｜Concept Demo")],
            [".brand-note", "台灣即時事件地圖｜Concept Demo"],
            [".sidebar-title", isFortune ? "周邊事件判定" : "台灣即時事件清單"],
            [".toolbar-caption", isFortune ? "以你的位置為中心判讀附近事件" : "台灣即時事件地圖"],
            ["#server-status", "視覺模式啟用中"],
            ["#player-count", "Concept Demo"],
            ["#tw-online-count", "Concept Demo"],
            ["#hero-mode-copy", isOnline ? "TW ONLINE 視覺模式" : (isFortune ? "趨吉避凶模式" : "台灣地圖")]
        ];
        textPairs.forEach(([selector, text]) => {
            const el = document.querySelector(selector);
            if (el) el.textContent = text;
        });
        const sidebarSubtitle = document.getElementById("sidebar-subtitle");
        if (sidebarSubtitle) {
            sidebarSubtitle.textContent = isFortune
                ? "以目前位置為中心，整理附近值得靠近與需要避開的事件。"
                : "";
        }
        document.querySelectorAll(".donate-btn").forEach(btn => {
            btn.textContent = "支持作品";
            btn.setAttribute("aria-label", "支持作品");
            btn.setAttribute("title", "支持作品");
        });
        ["search-input", "event-search", "event-search-mobile"].forEach(id => {
            const searchEl = document.getElementById(id);
            if (searchEl) searchEl.placeholder = currentMapMode === "fortune"
                ? "搜尋附近事件、地點或分類"
                : "搜尋城市、分類或事件";
        });
    }

    async function handleDonate(amount, btn){
        try{
            const orig=btn.innerHTML;
            btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> 處理中...'; btn.disabled=true;
            const res=await fetch('/api/create-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount,itemName:`支持作品 ${amount} 元`})});
            if(!res.ok) throw new Error();
            const html=await res.text();
            const div=document.createElement('div'); div.innerHTML=html;
            document.body.appendChild(div); div.querySelector('form').submit();
        }catch(e){
            alert('付款初始化失敗，請稍後再試。');
            btn.innerHTML='支持作品'; btn.disabled=false;
        }
    }

    // ?? EVENTS ???????????????????????????????????????????????
    window.openReportModal=openReportModal;

    document.addEventListener("click", e => {
        const reportBtn = e.target instanceof HTMLElement
            ? e.target.closest('[data-action="report"]')
            : null;
        if (!reportBtn) return;
        e.preventDefault();
        e.stopPropagation();
        const eventId = decodeURIComponent(reportBtn.dataset.eventId || "");
        openReportModal(eventId);
    });

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
    const toggleNearbyMode = () => {
        if (isNearbyMode) {
            exitNearbyModeV2();
            return;
        }
        if (userLocation) {
            enterNearbyModeV2();
            return;
        }
        requestUserLocationV2();
    };
    document.getElementById("nearby-toggle-btn")?.addEventListener("click", toggleNearbyMode);
    document.getElementById("nearby-toggle-mobile")?.addEventListener("click", toggleNearbyMode);
    document.getElementById("nearby-radius-select")?.addEventListener("change", (e) => handleNearbyRadiusChangeV2(e.target.value));
    document.getElementById("nearby-radius-mobile")?.addEventListener("change", (e) => handleNearbyRadiusChangeV2(e.target.value));
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
    document.getElementById("settings-btn").addEventListener("click", openSettingsModal);
    document.getElementById("settings-close-btn").addEventListener("click", () => {
        settingsModal.classList.remove("visible");
    });
    document.getElementById("map-mode-select").addEventListener("change", (e) => {
        applyMapMode(e.target.value);
    });

    document.getElementById("beta-close-btn")?.addEventListener("click",closeBetaModal);
    reportModal.addEventListener("click",e=>{ if(e.target===reportModal) closeReportModal(); });
    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && reportModal.classList.contains("visible")) closeReportModal();
    });
    betaModal.addEventListener("click",e=>{ if(e.target===betaModal) closeBetaModal(); });

    document.addEventListener("DOMContentLoaded",()=>{
        populateCityFilters();
        removeMapOverlays();
        ensureMobileSettingsButton();
        initMobileFilterCollapse();
        updateResponsiveControlsPlacement();
        updateMobileDrawerVisibilityForMode();
        checkBetaModal();
        parsedEvents = DEMO_EVENTS.map(normalizeDisplayEvent);
        applyMapMode(currentMapMode);
        applyConceptCopy();
        syncLiveEventsAndRender();
        updateNearbyButtonsV2();
        syncNearbyRadiusSelectors();
        setNearbyStatusTextV2();
        loadTwGeoJSON();
    });
