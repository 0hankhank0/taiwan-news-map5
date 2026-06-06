// ???? CONFIG ????????????????????????????????????????????????????????????????????????????????????????????
    const MAPBOX_TOKEN = "pk.eyJ1IjoiaGFua2hhbmsiLCJhIjoiY21wNWhmNHNiMDJxMzJycjB4a3FmNDY0biJ9.FK_qTU4xvkvvYq1Ze8WC4g"; 
    const SHOWCASE_MARKER_LIMIT = 16;
    const SHOWCASE_EVENT_CARD_LIMIT = 3;
    const MOBILE_EVENT_CARD_LIMIT = 24;
    const MOBILE_MARKER_LIMIT = 50;
    
    // ?潘撓貔?Mapbox Token ??秋????
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
        all:          { text: "?券鈭辣", icon: "fa-list",                color: "#4A5878" },
        disaster:     { text: "?賢拿",     icon: "fa-triangle-exclamation", color: "#C0392B" },
        criminal:     { text: "瘝餃?",     icon: "fa-handcuffs",           color: "#8E44AD" },
        traffic:      { text: "鈭日?,       icon: "fa-car-burst",           color: "#2471A3" },
        medical:      { text: "?怎?",       icon: "fa-truck-medical",       color: "#D35400" },
        activity:     { text: "瘣餃?",     icon: "fa-users",               color: "#1E8449" },
        other:        { text: "?嗡?",     icon: "fa-circle-info",         color: "#4A5878" }
    };

    const ALERT_COLOR_MAP = {
        traffic:  { color: "#2471A3", glow: "rgba(36, 113, 163, 0.45)" },
        fire:     { color: "#D35400", glow: "rgba(211, 84, 0, 0.42)" },
        arson:    { color: "#C0392B", glow: "rgba(192, 57, 43, 0.45)" },
        disaster: { color: "#C0392B", glow: "rgba(192, 57, 43, 0.4)" },
    };

    function getEventAlertType(ev) {
        const text = normalizeText(`${ev.title || ""} ${ev.content || ""}`);
        if (text.includes("蝮梁")) return "arson";
        if (["?怎", "憭梁", "?", "韏瑞"].some(keyword => text.includes(keyword))) return "fire";
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
        const urgent = ["蝺?, "?之", "霅行?", "甇颱滿", "?瑚滿", "?"].some(keyword => urgentText.includes(keyword));
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

    function getCategoryVisual(category) {
        const isOnline = currentMapMode === "online";
        const config = isOnline ? TW_ONLINE_CATEGORIES : CATEGORY_CONFIG;
        const mapConfig = isOnline ? CATEGORY_MAP.online : CATEGORY_MAP.normal;
        const baseCat = CATEGORY_GROUP_MAP[category] || category;
        const mappedCat = mapConfig[baseCat] || baseCat;
        const c = config[mappedCat] || config.other;
        const meta = CAT_META[mappedCat] || CAT_META.other;
        return { ...c, mappedCat, meta, color: c.color };
    }

    function getGroupCategory(category) {
        return CATEGORY_GROUP_MAP[category] || category || "other";
    }

    function getCategoryDetailLabel(category) {
        const detail = SUBCATEGORY_LABELS[category] || SUBCATEGORY_LABELS.other;
        const group = getCategoryVisual(category)?.text || "?嗡?";
        if (detail === group) return group;
        return `${group}嚚?{detail}`;
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
        "甇颱滿", "銝甇?, "鈭香", "銝香", "銝甇颱???, "?瑚滿", "?", "?", "??",
        "憓", "皞箸偌", "?怎", "?", "??", "?之鈭?", "撌亙?"
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
        return normalizeText(ev.impactLevel).includes("?之");
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
        const muyuCount = muyuActive ? `??${data.muyu}` : String(data.muyu || 0);
        const total = data.muyu || 0;
        const totalLabel = reacted ? "撌脣??? : `${total.toLocaleString()} 鈭箏歇?釣`;

        return `
            <div class="reaction-bar" data-event-id="${eventId}">
                <button type="button" class="react-btn muyu${muyuActive ? " active" : ""}${compactCls}"
                    onclick="handleReactClick(event, '${eventId}', 'muyu', this)"
                    ${reacted && !muyuActive ? "disabled" : ""}>
                    ${REACT_SVG.muyu}
                    <span>?脫擳?/span>
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
            countEl.textContent = "??" + (n + 1);
        }
        const bar = btn.closest(".reaction-bar");
        if (bar) {
            bar.querySelectorAll(".react-btn").forEach(s => {
                if (s !== btn) {
                    s.disabled = true;
                }
            });
            const total = bar.querySelector(".react-total");
            if (total) total.textContent = "撌脣???;
        }
    }

    const TW_ONLINE_TEXT = {
        siteTitle: "撜嗅飲?? Island Pulse",
        siteSubtitle: "TW Online 閬死璅∪?",
        statusPrefix: "TW Online 閬死撅?,
        listTitle: "?啁?單?鈭辣皜",
        searchPlaceholder: "??鈭辣??撣??摮?,
        emptyState: "?桀?瘝?蝚血?璇辣?????隞嗅????,
        loadingState: "甇??郊鈭辣鞈?...",
        serverStatus: "閬死璅∪??銝?,
        playerCount: "Concept Demo"
    };

    const TW_ONLINE_CATEGORIES = {
        all:          { text: "?券鈭辣", icon: "fa-list", color: "#94a3b8" },
        traffic:      { text: "鈭日?,     icon: "fa-car-side", color: "#60a5fa" },
        accident:     { text: "??",     icon: "fa-kit-medical", color: "#f97316" },
        construction: { text: "鈭日?,     icon: "fa-wrench", color: "#fb923c" },
        disaster:     { text: "?賢拿",     icon: "fa-triangle-exclamation", color: "#ef4444" },
        weather:      { text: "?賢拿",     icon: "fa-cloud-sun-rain", color: "#38bdf8" },
        activity:     { text: "瘣餃?",     icon: "fa-calendar-days", color: "#34d399" },
        event:        { text: "瘣餃?",     icon: "fa-calendar-days", color: "#34d399" },
        market:       { text: "瘣餃?",     icon: "fa-store", color: "#34d399" },
        exhibition:   { text: "瘣餃?",     icon: "fa-images", color: "#34d399" },
        sports:       { text: "瘣餃?",     icon: "fa-medal", color: "#a78bfa" },
        other:        { text: "?嗡?",     icon: "fa-circle-info", color: "#6b7280" }
    };

    const CATEGORY_GROUP_MAP = {
        traffic: "traffic",
        construction: "traffic",
        accident: "accident",
        incident: "accident",
        safety: "accident",
        criminal: "accident",
        medical: "accident",
        fire: "accident",
        publicsafety: "accident",
        "public-safety": "accident",
        disaster: "disaster",
        earthquake: "disaster",
        typhoon: "disaster",
        climate: "disaster",
        weather: "weather",
        activity: "activity",
        event: "activity",
        market: "activity",
        exhibition: "activity",
        sports: "activity"
    };

    const SUBCATEGORY_LABELS = {
        traffic: "鈭日?,
        construction: "?賢極",
        accident: "??",
        incident: "??鈭辣",
        safety: "?砍摰",
        criminal: "??",
        medical: "?怎?",
        fire: "?怎",
        disaster: "?賢拿",
        earthquake: "?啣??惜",
        typhoon: "?啣??惜",
        weather: "?啣??惜",
        climate: "?啣??惜",
        activity: "瘣餃?",
        event: "瘣餃?",
        market: "瘣餃?",
        exhibition: "瘣餃?",
        sports: "瘣餃?",
        other: "?嗡?"
    };

    const CATEGORY_MAP = {
        normal: {
            all: "all", traffic: "traffic", construction: "traffic",
            accident: "accident", incident: "accident", safety: "accident", criminal: "accident", medical: "accident", fire: "accident", publicsafety: "accident", "public-safety": "accident",
            disaster: "disaster", typhoon: "disaster", earthquake: "disaster",
            weather: "disaster", climate: "disaster", activity: "activity", event: "activity", market: "activity", exhibition: "activity", sports: "activity", other: "other"
        },
        online: {
            all: "all", traffic: "traffic", construction: "traffic",
            accident: "accident", incident: "accident", safety: "accident", criminal: "accident", medical: "accident", fire: "accident", publicsafety: "accident", "public-safety": "accident",
            disaster: "disaster", typhoon: "disaster", earthquake: "disaster",
            weather: "disaster", climate: "disaster", activity: "activity", event: "activity", market: "activity", exhibition: "activity", sports: "activity", other: "other"
        }
    };

    const FIXED_CATEGORY_ORDER = ["all", "traffic", "disaster", "accident", "activity"];
    const FORTUNE_CATEGORY_ORDER = ["all", "great-risk", "risk", "good", "great-good"];
    const FORTUNE_CONFIG = {
        "great-risk": { label: "憭批", color: "#EF4444", icon: "fa-triangle-exclamation", actionText: "??瘜冽?" },
        risk: { label: "??, color: "#F97316", icon: "fa-circle-exclamation", actionText: "撌脤?? },
        good: { label: "??, color: "#22C55E", icon: "fa-seedling", actionText: "?喳?敺" },
        "great-good": { label: "憭批?", color: "#FACC15", icon: "fa-star", actionText: "?澆???" }
    };
    const FORTUNE_GOOD_CATEGORIES = new Set(["activity", "event", "market", "exhibition", "sports", "good_weather"]);
    const FORTUNE_RISK_CATEGORIES = new Set([
        "traffic", "accident", "disaster", "construction", "fire", "criminal", "medical",
        "incident", "safety", "weather", "earthquake", "typhoon", "publicsafety", "public-safety"
    ]);

    const SOURCE_CONFIG = {
        "TDX CMS": { text:"TDX 鈭日???, shortText:"TDX",  bg:"rgba(15,118,110,0.2)", color:"#5eead4" },
        RSS:        { text:"RSS 鈭辣鞈?", shortText:"RSS",  bg:"rgba(29,78,216,0.2)",  color:"#93c5fd" },
        news:       { text:"?砍鈭辣鞈?", shortText:"鞈?",   bg:"rgba(124,58,237,0.2)", color:"#c4b5fd" },
        default:    { text:"撅內鞈?", shortText:"撅內", bg:"rgba(71,85,105,0.25)", color:"#94a3b8" }
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
        all: { text: "?券鈭辣", icon: "fa-list", color: "#64748B" },
        traffic: { text: "鈭日?, icon: "fa-car-burst", color: "#2F80ED" },
        accident: { text: "??", icon: "fa-kit-medical", color: "#F97316" },
        disaster: { text: "?賢拿", icon: "fa-triangle-exclamation", color: "#C0392B" },
        weather: { text: "?賢拿", icon: "fa-cloud-showers-heavy", color: "#38BDF8" },
        activity: { text: "瘣餃?", icon: "fa-users", color: "#1E8449" },
        sports: { text: "瘣餃?", icon: "fa-trophy", color: "#A3A948" },
        other: { text: "?嗡?", icon: "fa-circle-info", color: "#64748B" }
    });

    Object.assign(CAT_META, {
        traffic: { rgba: "47,128,237", tint: "#93C5FD", cssVar: "--cat-traffic" },
        accident: { rgba: "249,115,22", tint: "#FDBA74", cssVar: "--cat-accident" },
        disaster: { rgba: "192,57,43", tint: "#E8856A", cssVar: "--cat-disaster" },
        weather: { rgba: "56,189,248", tint: "#BAE6FD", cssVar: "--cat-weather" },
        activity: { rgba: "30,132,73", tint: "#86EFAC", cssVar: "--cat-activity" },
        sports: { rgba: "163,169,72", tint: "#D9F99D", cssVar: "--cat-sports" },
        other: { rgba: "100,116,139", tint: "#CBD5E1", cssVar: "--cat-other" },
    });

    const CITY_OPTIONS = [
        { value: "?啣?撣?, label: "?啣?撣? }, { value: "?啣?撣?, label: "?啣?撣? }, { value: "?粹?撣?, label: "?粹?撣? },
        { value: "獢?撣?, label: "獢?撣? }, { value: "?啁姘撣?, label: "?啁姘撣? }, { value: "?啁姘蝮?, label: "?啁姘蝮? },
        { value: "??蝮?, label: "??蝮? }, { value: "?唬葉撣?, label: "?唬葉撣? }, { value: "敶啣?蝮?, label: "敶啣?蝮? },
        { value: "??蝮?, label: "??蝮? }, { value: "?脫?蝮?, label: "?脫?蝮? }, { value: "?儔撣?, label: "?儔撣? },
        { value: "?儔蝮?, label: "?儔蝮? }, { value: "?啣?撣?, label: "?啣?撣? }, { value: "擃?撣?, label: "擃?撣? },
        { value: "撅蝮?, label: "撅蝮? }, { value: "摰蝮?, label: "摰蝮? }, { value: "?梯蝮?, label: "?梯蝮? },
        { value: "?唳蝮?, label: "?唳蝮? }, { value: "瞉?蝮?, label: "瞉?蝮? }, { value: "??蝮?, label: "??蝮? },
        { value: "???蝮?, label: "???蝮? }
    ];

    const taiwanView = { center:[23.6,120.9], zoom:7 };
    const globalView = { center:[20,0], zoom:2 };
    const EMPTY_GEOJSON = { type:"FeatureCollection", features:[] };

    let parsedEvents = [];
    let activeCategory = "all";
    let currentFortuneFilter = "all";
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
    console.log("FORTUNE FILTER FIX v2 loaded");

    // ???? THEME ??????????????????????????????????????????????????????????????????????????????????????????????
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
        console.log("??銝駁?:", theme);
    }

    // ???? MAP INIT ????????????????????????????????????????????????????????????????????????????????????????
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
            attribution: '穢 OpenStreetMap'
        }).addTo(fallbackMap);
        window._fallbackMap = fallbackMap;
        if (parsedEvents.length) {
            const fallbackEvents = (isShowcaseDisplayMode() && !isMobileViewport())
                ? getShowcaseEvents(parsedEvents)
                : parsedEvents;
            fallbackEvents.slice(0, isMobileViewport() ? MOBILE_MARKER_LIMIT : fallbackEvents.length).forEach(ev => {
                const latlng = [Number(ev.lat), Number(ev.lng)];
                if (Number.isFinite(latlng[0]) && Number.isFinite(latlng[1])) {
                    const severity = getEventSeverity(ev);
                    const cat = getCategoryVisual(ev.category);
                    const markerStyle = resolveMarkerStyle(ev, cat.color);
                    const displayTitle = ev.title || "?芸??隞?;
                    const displayContent = getEventSummary(ev);
                    const element = makeMarkerElement(
                        markerStyle.color,
                        CAT_SVG[ev.category] || CAT_SVG.other,
                        severity,
                        markerStyle.glow,
                        shouldPinPulse(ev, severity)
                    );
                    const marker = L.marker([latlng[0], latlng[1]], {
                        icon: L.divIcon({
                            html: element.outerHTML,
                            className: "leaflet-demo-pin",
                            iconSize: [0, 0],
                            iconAnchor: [0, 0],
                            popupAnchor: [0, -42]
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
        console.log("????身摰???);
    }

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("load", async () => {
        console.log("?啣?頛摰?嚗?憪?鞈?...");
        
        // ?潘撓??Mapbox Token
        checkMapboxToken().then(valid => {
            isMapboxValid = valid;
            if (!valid) {
                ["btn-dark", "btn-dark-mobile"].forEach(id => {
                    const b = document.getElementById(id);
                    if (b) {
                        b.disabled = true;
                        b.textContent = id.includes("mobile") ? "瘛梯銝?? : "瘛梯銝??;
                    }
                });
            }
        });

        ensureBoundaryLayer();
        drawCityBoundary(currentCityFilter());
        applyMapMode(currentMapMode); // 靘?芋撘??典???隞????        if(parsedEvents.length) renderEvents();
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
                title: "?圈? Demo",
                tone: "earthquake",
                rows: ["閬芋 M5.8", "瘛勗漲 12 km", "?梯餈絲", "?湔 07:42"],
            },
            epicenter: {
                type: "FeatureCollection",
                features: [{ type: "Feature", properties: { label: "?亢" }, geometry: { type: "Point", coordinates: [121.72, 24.02] } }],
            },
            label: {
                type: "FeatureCollection",
                features: [{ type: "Feature", properties: { label: "M 5.6 ?梯餈絲" }, geometry: { type: "Point", coordinates: [121.78, 24.06] } }],
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
                title: "憸梢◢ Demo",
                tone: "typhoon",
                rows: ["憸梢◢?葫頝臬?", "憸典?蝭?", "?芯? 48 撠?", "???湔"],
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
                features: [{ type: "Feature", properties: { label: "憸梢◢?葫頝臬?" }, geometry: { type: "Point", coordinates: [122.6, 22.2] } }]
            },
        },
        weather: {
            info: {
                title: "憭拇除 Demo",
                tone: "weather",
                rows: ["???", "?璈? 70%", "擃澈 33簞C", "???琿?冽???],
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
                    { type: "Feature", properties: { label: "擃澈??" }, geometry: { type: "Point", coordinates: [121.56, 25.04] } },
                    { type: "Feature", properties: { label: "???" }, geometry: { type: "Point", coordinates: [120.31, 22.63] } }
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
            <button type="button" class="demo-info-close" aria-label="??蝷箇??惜鞈?">?</button>
            <div class="demo-info-kicker">蝷箇??惜</div>
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
            donateBtn.textContent = "?舀?雿?";
            donateBtn.title = "?舀?雿?";
            donateBtn.setAttribute("aria-label", "?舀?雿?");
        }

        let button = document.getElementById("settings-btn-mobile");
        if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.id = "settings-btn-mobile";
            button.className = "mobile-settings-btn";
            button.setAttribute("aria-label", "??閮剖?");
            button.innerHTML = '<i class="fa-solid fa-gear" aria-hidden="true"></i>';
            button.addEventListener("click", openSettingsModal);
        }
        if (button.parentElement !== row1) row1.appendChild(button);
        button.setAttribute("aria-label", "閮剖?");
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
                    ["==", ["get", "label"], "擃澈??"],
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
                <div class="demo-layer-label data-layer-label">?啣??惜嚗??抵?閮?</div>
                <button type="button" data-demo-layer="earthquake">?啣?嚚??/button>
                <button type="button" data-demo-layer="typhoon">?啣?嚚２憸?/button>
                <button type="button" data-demo-layer="weather">?啣?嚚予瘞?/button>
                <button type="button" data-demo-clear>皜</button>
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
        
        // ??摨?閬死憸冽??        if (map && map.isStyleLoaded()) {
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
            siteTitle: "撜嗅飲?? Island Pulse",
            siteSubtitle: isOnline
                ? "TW ONLINE 閬死璅∪?"
                : (isFortune ? "頞典??踹璅∪?嚚??嗡?隞嗅霈" : "?啁?單?鈭辣?啣?嚚oncept Demo"),
            listTitle: isFortune ? "?券?鈭辣?文?" : "?啁?單?鈭辣皜",
            searchPlaceholder: isFortune ? "????鈭辣?暺???" : "??鈭辣??撣??摮?,
            emptyState: "?桀?瘝?蝚血?璇辣?????隞嗅????,
            loadingState: "甇??郊鈭辣鞈?...",
            statusPrefix: isOnline
                ? "TW Online 閬死撅文??其葉"
                : (isFortune ? "頞典??踹璅∪?嚚??嗡?隞嗅霈" : "?啁?單?鈭辣?啣?嚚oncept Demo")
        };

        document.querySelector(".brand-title").textContent = textConfig.siteTitle;
        document.querySelector(".brand-sub").textContent = textConfig.siteSubtitle;
        document.querySelector(".sidebar-title").textContent = textConfig.listTitle;
        const sidebarSubtitle = document.getElementById("sidebar-subtitle");
        if (sidebarSubtitle) {
            sidebarSubtitle.textContent = isFortune
                ? "隞亦??蝵桃銝剖?嚗??餈澆?????閬??鈭辣??
                : "";
        }
        const toolbarCaption = document.querySelector(".toolbar-caption");
        if (toolbarCaption) toolbarCaption.textContent = isFortune ? "隞乩???蝵桃銝剖??方???鈭辣" : "?啁?單?鈭辣?啣?";
        document.getElementById("event-search").placeholder = textConfig.searchPlaceholder;
        const mobileSearch = document.getElementById("event-search-mobile");
        if (mobileSearch) mobileSearch.placeholder = textConfig.searchPlaceholder;
        activeCategory = "all";
        currentFortuneFilter = "all";
        
        const onlineStatus = document.getElementById("tw-online-status");
        if (isOnline) {
            if (onlineStatus) onlineStatus.style.display = "flex";
            const serverStatus = document.getElementById("server-status");
            const playerCount = document.getElementById("player-count");
            if (serverStatus) serverStatus.textContent = "閬死璅∪??銝?;
            if (playerCount) playerCount.textContent = "Concept Demo";
            setStatus("TW Online 閬死撅文??其葉嚚?曹?隞嗉???霈?);
        } else {
            if (onlineStatus) onlineStatus.style.display = "none";
            setStatus(textConfig.statusPrefix);
        }

        renderCategoryButtons();
        renderEvents();
        if (userLocation && isNearbyMode) drawUserLocationOverlay();
        setStatus(isOnline ? "TW Online 閬死撅文??其葉嚚?曹?隞嗉???霈? : textConfig.statusPrefix);
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
            "?券": "all",
            "fortune-all": "all",
            "great-risk": "great-risk",
            greatbad: "great-risk",
            "憭批": "great-risk",
            risk: "risk",
            bad: "risk",
            badonly: "risk",
            "??: "risk",
            good: "good",
            goodonly: "good",
            "??: "good",
            "銝剖?": "good",
            "great-good": "great-good",
            greatgood: "great-good",
            "憭批?": "great-good"
        };
        return mapping[normalized] || mapping[raw] || "all";
    }
    function getCurrentFortuneFilter() {
        return normalizeFortuneFilterValue(currentFortuneFilter || activeCategory || "all");
    }
    function getEventFortuneType(event) {
        const text = normalizeText(`${event?.title || ""} ${event?.content || ""} ${event?.category || ""}`);
        const rawCategory = normalizeText(event?.category || "").toLowerCase();
        const groupCategory = normalizeText(event?.groupCategory || getGroupCategory(rawCategory)).toLowerCase();
        const severity = getEventSeverity(event);
        const riskWords = ["鈭日?, "?賢拿", "??", "?賢極", "??", "?怎", "?怎?", "?砍摰", "鈭?", "憯?", "撱嗉炊", "蝞∪"];
        const highRiskWords = ["甇颱滿", "?", "撠?", "?", "??", "瘛寞偌", "?圈?", "憸梢◢", "?怎", "??", "?之"];
        const opportunityWords = ["瘣餃?", "鞈賭?", "撣?", "撅汗", "憟賣???, "??郊", "?", "?餃"];
        const premiumGoodWords = ["憭批?", "?梢?", "蝭??, "鈭箸???"];
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
        return { type: "neutral", level: "neutral", label: "閫撖?, key: "neutral" };
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
        if (filter === "all") return "?券鈭辣";
        if (filter === "neutral") return "閫撖?;
        return FORTUNE_CONFIG[filter]?.label || filterValue || "?券鈭辣";
    }
    function getEventFortuneLevel(event) {
        const fortuneType = getEventFortuneType(event);
        const level = fortuneType.level;

        const cfg = level === "neutral"
            ? { label: "觀察", color: "#94A3B8", icon: "fa-circle-info", actionText: "先觀察" }
            : FORTUNE_CONFIG[level];

        const titleByLevel = {
            "great-risk": ["撱箄降?輸?", "?券?憸券銝?", "撠???"],
            risk: ["撠???", "撱箄降?輸?", "?券?憸券銝?"],
            good: ["?臬?敺", "?澆???", "???暑??],
            "great-good": ["?澆???", "?臬?敺", "???暑??],
            neutral: ["??閫撖?, "??敺?霈?", "?怎?Ⅱ?"]
        };
        const contentByLevel = {
            "great-risk": "??憸券頛?嚗遣霅啣??輸???撣嗡蒂?寡粥?嗡?頝舐???,
            risk: "??鈭辣?航敶梢?????剁?撱箄降?暹?漲銝血?敹???,
            good: "???????隞塚??拙??楝???亦??曉?瘜?,
            "great-good": "??瘣餃??詨???擃??澆?????????敺??,
            neutral: "?桀?瘝??Ⅱ?????嗉????臬??閫撖?
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
        if (document.body.classList.contains("fortune-mode")) return "?甇方?";
        if (currentMapMode === "online" || document.body.classList.contains("tw-online-mode")) return "PLAYER";
        return "雿?雿蔭";
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
        if (labelEl) labelEl.textContent = `??蝭?嚗?{formatRadiusLabel(nearbyRadiusMeters)}`;
        if (!el) return;
        if (!userLocation) {
            el.textContent = "?芸?雿?;
            return;
        }
        if (!isNearbyMode) {
            el.textContent = "撌脣?雿?;
            return;
        }
        el.textContent = nearbyEventsCache.length > 0 ? `${nearbyEventsCache.length} 隞嗡?隞跆 : "?桀?瘝?鈭辣";
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
                ? "?券??文?蝭?"
                : `??蝭?嚗?{formatRadiusLabel(nearbyRadiusMeters)}`;
        }
        if (!el) return;
        if (currentMapMode === "fortune") {
            if (!userLocation) {
                el.textContent = "撠摰?嚚?????券?";
                return;
            }
            const counts = getFortuneCounts(nearbyEventsCache);
            el.textContent = `蝭? ${formatRadiusLabel(nearbyRadiusMeters)}嚚之??${counts["great-risk"]}嚚 ${counts.risk}嚚? ${counts.good}嚚之??${counts["great-good"]}`;
            return;
        }
        if (!userLocation) {
            el.textContent = "?芸?雿?;
            return;
        }
        if (!isNearbyMode) {
            el.textContent = currentMapMode === "fortune" ? "?典蝮質汗銝? : "?亦??典銝?;
            return;
        }
        el.textContent = nearbyEventsCache.length > 0
            ? `?? ${formatRadiusLabel(nearbyRadiusMeters)}嚗?{nearbyEventsCache.length} 隞嗡?隞跆
            : `?? ${formatRadiusLabel(nearbyRadiusMeters)} ?桀?瘝?鈭辣`;
    }
    function updateNearbyButtonsV2() {
        const active = isNearbyMode;
        const isFortune = currentMapMode === "fortune";
        const text = isFortune
            ? (active ? "?典蝮質汗" : "?亦??券?")
            : (active ? "?亦??典" : `?? ${formatRadiusLabel(nearbyRadiusMeters)}`);
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
            ? (active ? "?典蝮質汗" : "?亦??券?")
            : (active ? "?亦??典" : `?? ${formatRadiusLabel(nearbyRadiusMeters)}`);
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
            setStatus(`?? ${formatRadiusLabel(nearbyRadiusMeters)}嚗?{nearbyEventsCache.length} 隞嗡?隞跆);
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
        setStatus(`撌脣???? ${formatRadiusLabel(nearbyRadiusMeters)}`);
    }
    function exitNearbyMode() {
        isNearbyMode = false;
        clearUserLocationOverlay();
        renderEvents();
        setStatus("撌脣??啣?唬?隞?);
    }
    function requestUserLocation() {
        if (!navigator.geolocation) {
            setStatus("甇斤汗?其??舀摰????);
            return;
        }
        navigator.geolocation.getCurrentPosition((position) => {
            userLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            enterNearbyMode();
        }, () => {
            setStatus("?⊥???雿蔭嚗????汗?典?雿???);
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
            setStatus(`?? ${formatRadiusLabel(nearbyRadiusMeters)}嚗?{nearbyEventsCache.length} 隞嗡?隞跆);
        }
    }
    function enterNearbyModeV2() {
        if (!userLocation) return;
        isNearbyMode = true;
        drawUserLocationOverlay();
        focusUserLocation();
        renderEvents();
        setStatus(`撌脣???? ${formatRadiusLabel(nearbyRadiusMeters)}`);
    }
    function exitNearbyModeV2() {
        isNearbyMode = false;
        clearUserLocationOverlay();
        renderEvents();
        setStatus("撌脣????典鈭辣");
    }
    function requestUserLocationV2() {
        if (!navigator.geolocation) {
            setStatus("甇斤汗?其??舀摰????);
            return;
        }
        navigator.geolocation.getCurrentPosition((position) => {
            userLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            enterNearbyModeV2();
        }, () => {
            setStatus("?⊥???雿蔭嚗????汗?典?雿???);
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
        const cityLabel = cityValue === "all" ? "?典" : cityValue;
        const modeLabel = currentMapMode === "online"
            ? "TW Online 閬死璅∪?"
            : (isTaiwanMode ? "?啁?啣?" : "蝯梯?閬?");
        const categoryLabel = currentMapMode === "fortune"
            ? getFortuneFilterLabel(getCurrentFortuneFilter())
            : (activeCategory === "all" ? "?券鈭辣" : (getCategoryVisual(activeCategory)?.text || activeCategory));
        const cityCount = new Set(events.map(ev => normalizeText(ev.city)).filter(Boolean)).size;
        const categoryCount = new Set(events.map(ev => getGroupCategory(normalizeText(ev.groupCategory || ev.category))).filter(Boolean)).size;

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
                ? "TW Online嚗?隞嗅?????蝷箸芋撘?
                : "?典??閬??迤?函??鈭?;
        }
    }
    function makeMarkerElement(color, svg, severity = 2, glowColor = null, showPulse = false){
        const isMobile = isMobileViewport();
        const pinSizes = { 1: 34, 2: 38, 3: 42, 4: 46, 5: 52 };
        const glowPx = { 1: 6, 2: 10, 3: 14, 4: 20, 5: 28 };
        const bodySize = pinSizes[severity] || 38;
        const g = isMobile ? "transparent" : (glowColor || color);
        const glowR = glowPx[severity] || 10;
        const outerW = Math.round(bodySize * 1.18);
        const outerH = Math.round(bodySize * 1.7);
        const iconSize = Math.round(bodySize * 0.42);
        const wrapper = document.createElement("div");
        const band = severity >= 4 ? "high" : severity >= 2 ? "medium" : "low";
        wrapper.className = `map-pin marker-severity-${severity} marker-${band}${isMobile ? " marker-mobile-simple" : ""}`;
        wrapper.style.setProperty("--pin-color", color);
        wrapper.style.setProperty("--pin-glow", g);
        const svgFilter = isMobile ? "" : ` style="filter:drop-shadow(0 8px 16px rgba(0,0,0,0.45)) drop-shadow(0 0 ${glowR}px ${g});"`;
        wrapper.innerHTML = `
            <span class="map-pin-visual" style="width:${outerW}px;height:${outerH}px;">
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
        float.textContent = "?噸 +1";
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

    // ???? GEO ??????????????????????????????????????????????????????????????????????????????????????????????????
    async function loadTwGeoJSON(){
        try{
            const res = await fetch("https://cdn.jsdelivr.net/gh/g0v/twgeojson@master/json/twCounty2010.geo.json");
            twGeoJSON = await res.json();
            drawCityBoundary(currentCityFilter());
        }catch(e){ console.warn("GeoJSON 頛憭望?", e); }
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
        const html=['<option value="all">?券蝮??</option>',...CITY_OPTIONS.map(o=>`<option value="${o.value}">${o.label}</option>`)].join("");
        d.innerHTML=html; m.innerHTML=html;
    }

    // ???? FILTERS ??????????????????????????????????????????????????????????????????????????????????????????
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
                const label = cat === "all" ? "?券" : levelCfg.label;
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
                if (isFortune) {
                    const clickedValue =
                        btn.dataset.filter ||
                        btn.dataset.level ||
                        btn.dataset.fortune ||
                        btn.dataset.category ||
                        "all";
                    currentFortuneFilter = normalizeFortuneFilterValue(clickedValue);
                    activeCategory = currentFortuneFilter;
                } else {
                    activeCategory = btn.dataset.category || "all";
                }
                renderCategoryButtons();
                renderEvents();
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
                .replace(/[嚗?嚗?嚗-\.\,\!\?]/g, "")
                .slice(0, 20);
            const contentKey = normalizeText(ev.content || ev.summary || "")
                .replace(/\s+/g, "")
                .replace(/[嚗?嚗?嚗-\.\,\!\?]/g, "")
                .slice(0, 30);
            if (seenTitles.has(titleKey) || (contentKey && seenContent.has(contentKey))) return false;
            seenTitles.add(titleKey);
            if (contentKey) seenContent.add(contentKey);
            return true;
        });
    }

    function normalizeDisplayEvent(ev) {
        const category = normalizeText(ev.category || "other").toLowerCase();
        const groupCategory = getGroupCategory(normalizeText(ev.groupCategory || category).toLowerCase());
        return {
            ...ev,
            category,
            groupCategory,
            displayCategory: getCategoryVisual(groupCategory)?.text || "?嗡?"
        };
    }

    function getFilteredEvents(options = {}){
        const { forMap = false } = options;
        const cityFilter = isTaiwanMode ? currentCityFilter() : "all";
        const normalizedFortuneFilter = getCurrentFortuneFilter();
        console.log("[fortune filter]", {
            mode: currentMapMode,
            bodyClass: document.body.className,
            currentFortuneFilter,
            normalized: normalizedFortuneFilter,
            total: parsedEvents.length,
            forMap
        });
        const filtered = parsedEvents.filter(ev=>{
            const lat=Number(ev.lat), lng=Number(ev.lng);
            
            if(!Number.isFinite(lat)||!Number.isFinite(lng)) return false;
            if(!isValidTaiwanCoord(lat, lng)) return false;

            const groupCategory = getGroupCategory(ev.groupCategory || ev.category);
            if (currentMapMode === "fortune") {
                if (normalizedFortuneFilter !== "all" && !eventMatchesFortuneFilter(ev, normalizedFortuneFilter)) return false;
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
        if (currentMapMode === "fortune") {
            console.log("[fortune result]", filtered.map(e => ({
                title: e.title,
                category: e.category,
                fortune: getEventFortuneLevel(e),
                match: eventMatchesFortuneFilter(e, normalizedFortuneFilter)
            })));
        }
        if (!forMap && isNearbyMode && userLocation) {
            nearbyEventsCache = getEventsNearUser(filtered, nearbyRadiusMeters);
            return nearbyEventsCache;
        }
        if (!forMap) nearbyEventsCache = [];
        console.log("filtered events length", filtered.length);
        return filtered;
    }

    function getShowcaseRegion(ev) {
        const lat = Number(ev.lat);
        const lng = Number(ev.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "other";
        if (lng < 120.15 || lat > 26) return "islands";
        if (lng >= 121.1 && lat < 24.9) return "east";
        if (lat >= 24.6) return "north";
        if (lat >= 23.35) return "central";
        return "south";
    }

    function rankShowcaseEvent(ev) {
        const category = getGroupCategory(ev.groupCategory || ev.category);
        const categoryBonus = {
            traffic: 35,
            accident: 35,
            activity: 30,
            disaster: 35,
            earthquake: 25,
            typhoon: 25
        }[category] || 0;
        const severityScore = Number(ev.severity || getEventSeverity(ev) || 1) * 12;
        const attentionScore = Math.min(40, Math.floor(Number(ev.interactionCount || 0) / 20));
        return categoryBonus + severityScore + attentionScore;
    }

    function isShowcaseDisplayMode() {
        return currentMapMode !== "fortune" &&
            activeCategory === "all" &&
            !searchKeyword &&
            !isNearbyMode &&
            (!isTaiwanMode || currentCityFilter() === "all");
    }

    function takeShowcaseCandidate(events, selected, usedIds, predicate) {
        const candidate = events.find(ev => !usedIds.has(String(ev.id)) && predicate(ev));
        if (!candidate) return false;
        selected.push(candidate);
        usedIds.add(String(candidate.id));
        return true;
    }

    function getShowcaseCategoryCounts(events) {
        return events.reduce((acc, ev) => {
            const category = getGroupCategory(ev.groupCategory || ev.category);
            acc[category] = (acc[category] || 0) + 1;
            return acc;
        }, {});
    }

    function getShowcaseEvents(events, limit = SHOWCASE_MARKER_LIMIT) {
        if (!Array.isArray(events) || events.length <= limit) return events;
        const sorted = [...events].sort((a, b) => rankShowcaseEvent(b) - rankShowcaseEvent(a));
        const selected = [];
        const usedIds = new Set();
        const requiredCategories = ["traffic", "accident", "activity", "disaster"];
        const categoryCaps = { traffic: 4, accident: 4, activity: 4, disaster: 4, weather: 2, other: 2 };
        const regionSlots = [
            "north", "central", "south", "east",
            "north", "central", "south", "east",
            "north", "central", "south", "east",
            "central", "south", "islands", "south"
        ];

        const isCategoryUnderCap = ev => {
            const category = getGroupCategory(ev.groupCategory || ev.category);
            const caps = getShowcaseCategoryCounts(selected);
            return (caps[category] || 0) < (categoryCaps[category] || 3);
        };

        regionSlots.slice(0, limit).forEach(region => {
            takeShowcaseCandidate(sorted, selected, usedIds, ev => getShowcaseRegion(ev) === region && isCategoryUnderCap(ev)) ||
                takeShowcaseCandidate(sorted, selected, usedIds, ev => getShowcaseRegion(ev) === region);
        });

        requiredCategories.forEach(category => {
            if (selected.some(ev => getGroupCategory(ev.groupCategory || ev.category) === category)) return;
            const replacement = sorted.find(ev => !usedIds.has(String(ev.id)) && getGroupCategory(ev.groupCategory || ev.category) === category);
            if (!replacement) return;
            const replacementRegion = getShowcaseRegion(replacement);
            const counts = getShowcaseCategoryCounts(selected);
            const replaceIndex = selected.findIndex(ev =>
                getShowcaseRegion(ev) === replacementRegion &&
                (counts[getGroupCategory(ev.groupCategory || ev.category)] || 0) > 1
            );
            const index = replaceIndex >= 0 ? replaceIndex : selected.length - 1;
            if (index < 0) return;
            usedIds.delete(String(selected[index].id));
            selected[index] = replacement;
            usedIds.add(String(replacement.id));
        });

        return selected.slice(0, limit);
    }

    function getCurrentCategoryLabel() {
        if (currentMapMode === "fortune") return getFortuneFilterLabel(getCurrentFortuneFilter());
        if (activeCategory === "all") return "?券鈭辣";
        const visual = getCategoryVisual(activeCategory);
        return visual?.text || activeCategory || "?券鈭辣";
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
            mobileFilterSummary.setAttribute("aria-label", "撅?蝭拚璇辣");
            header.appendChild(mobileFilterSummary);
        }
        return mobileFilterSummary;
    }

    function updateMobileFilterSummary(count = lastRenderedEventCount) {
        const summary = ensureMobileFilterSummary();
        if (!summary) return;
        const label = getCurrentCategoryLabel();
        const countLabel = Number.isFinite(count) ? `${count} 蝑 : "";
        summary.innerHTML = `<span>?桀???嚗?{label}</span><strong>${countLabel}</strong>`;
    }

    function getEventAlertType(ev) {
        if (["disaster", "earthquake", "typhoon", "safety"].includes(ev.category)) return "disaster";
        if (["traffic", "construction"].includes(ev.category)) return "traffic";
        if (ev.category === "weather") return "weather";
        return null;
    }

    function getEventSeverity(ev) {
        const raw = ev.severity;
        if (typeof raw === "number" && Number.isFinite(raw)) return Math.min(5, Math.max(1, Math.round(raw)));
        if (raw === "high") return 5;
        if (raw === "medium") return 3;
        if (raw === "low") return 1;
        if (["disaster", "earthquake", "typhoon", "safety"].includes(ev.category)) return 4;
        if (["traffic", "construction", "weather"].includes(ev.category)) return 3;
        return 1;
    }

    function getSeverityBand(ev) {
        const severity = getEventSeverity(ev);
        if (severity >= 4) return "high";
        if (severity >= 2) return "medium";
        return "low";
    }

    function resolveMarkerStyle(ev, fallbackColor) {
        const visual = getCategoryVisual(ev.category);
        const color = visual?.color || fallbackColor || "#2F80ED";
        const meta = visual?.meta || CAT_META.other;
        const severity = getSeverityBand(ev);
        const glow = severity === "high"
            ? `rgba(${meta.rgba},0.68)`
            : severity === "medium"
                ? `rgba(${meta.rgba},0.42)`
                : `rgba(${meta.rgba},0.2)`;
        return { color, glow };
    }

    function shouldPinPulse(ev, severity) {
        if (["activity", "sports"].includes(ev.category)) return false;
        return severity >= 2;
    }

    function getEventSummary(ev) {
        return ev.summary || ev.content || "?桀?撠??鞈???;
    }

    function getImpactLabel(ev) {
        const raw = normalizeText(ev.impactLevel);
        if (raw) return raw;
        const severity = getEventSeverity(ev);
        if (severity <= 1) return "雿漲敶梢";
        if (severity === 2) return "頛漲敶梢";
        if (severity === 3) return "銝剖漲敶梢";
        if (severity === 4) return "擃漲敶梢";
        return "蝺亙蔣??;
    }

    function getSeverityLabel(ev) {
        const severity = getEventSeverity(ev);
        if (severity <= 1) return "雿漲敶梢";
        if (severity === 2) return "頛漲敶梢";
        if (severity === 3) return "銝剖漲敶梢";
        if (severity === 4) return "擃漲敶梢";
        return "蝺亙蔣??;
    }

    function formatAttentionCount(ev) {
        return `${Number(ev.interactionCount || 0).toLocaleString()} 鈭箏歇?釣`;
    }

    function formatSourceLabel(ev) {
        const raw = normalizeText(ev.sourceName || ev.source);
        const lowered = raw.toLowerCase();
        if (!raw || lowered.includes("concept demo") || lowered.includes("island pulse")) {
            return "靘?嚚sland Pulse 撅內鞈?";
        }
        return `靘?嚚?{raw}`;
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
        const severityLabel = severity <= 2 ? "頛漲" : (severity === 3 ? "銝剖漲" : "擃漲");
        const seedBase = normalizeText(event?.id || event?.title || "0");
        const seed = Array.from(seedBase).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
        const pick = list => list[seed % list.length];
        const copyMap = {
            traffic: {
                titles: ["?楝蝭暺?憛郎??, "??蝘餃?頝舐??", "?頝臬??潛?撟脫"],
                contents: ["閰脣??宏??????撱箄降?拙振?閬?頝舐???, "鈭日?暺?曄撣貉?頛????漲????],
                categoryLabel: "蝘餃?鈭辣",
                impactLabel: "蝘餃??"
            },
            disaster: {
                titles: ["??摰喃?隞嗉孛??, "??摰霅行???", "?啣??啣虜鈭辣?箇"],
                contents: ["閰脣????典潔???撱箄降?輸?鈭辣蝭???, "?啣?憸券銝?嚗頂蝯勗歇璅??粹?瘜冽????],
                categoryLabel: "?賢拿鈭辣",
                impactLabel: "摰?潔???
            },
            accident: {
                titles: ["蝒??鈭辣??", "?砍摰鈭辣閫貊", "??撣貊????],
                contents: ["甇文??箇蝒鈭辣嚗?????函????啣蔣?踴?, "蝟餌絞?菜葫?啁撣訾?隞塚?撱箄降靽?瘜冽???],
                categoryLabel: "蝒鈭辣",
                impactLabel: "瘜冽?????
            },
            activity: {
                titles: ["??瘣餃?蝭暺???, "???圈?鈭辣?箇", "鈭箸???鈭辣??"],
                contents: ["閰脣暺?暹暑??暺??航撣嗡?鈭箸??漱????, "??鈭?鈭辣??嚗???亦??曉鞈???],
                categoryLabel: "瘣餃?鈭辣",
                impactLabel: "鈭箸?憓?"
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
            primaryAction: "撌脩??,
            secondaryAction: "?澆?瘜冽?",
            sourceLabel: formatSourceLabel(event)
        };
    }

    function makeReportActionHtml(ev, context) {
        const eventId = encodeURIComponent(ev.id || "");
        const cls = context === "popup" ? "popup-btn-v2 ghost" : "card-action-btn report";
        return `<button type="button" class="${cls}" data-action="report" data-event-id="${eventId}">?</button>`;
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
                ? ["撌脤??, "??瘜冽?"]
                : ["good", "great-good"].includes(fortune.level)
                    ? ["?喳?敺", "?澆???"]
                    : ["撌脩??, "??撖?];
            const cls = context === "popup" ? "popup-btn-v2 ghost rating-action" : "card-action-btn rating-action";
            const buttons = labels.map(label => `<button type="button" class="${cls}" onclick="event.stopPropagation();">${label}</button>`).join("");
            const report = makeReportActionHtml(ev, context);
            const sourceUrl = ev.sourceUrl || ev.url || "";
            const sourceBtn = sourceUrl
                ? `<a href="${sourceUrl}" target="_blank" rel="noreferrer" class="${context === "popup" ? "popup-btn-v2 ghost" : "card-action-btn link"}" onclick="event.stopPropagation();">靘?</a>`
                : "";
            return `<div class="event-actions event-actions--${context}" data-interaction-type="fortune"><div class="${context === "popup" ? "popup-action-group" : "card-action-group"}">${buttons}${report}${sourceBtn}</div></div>`;
        }
        if (isTwOnlineMode()) {
            const labels = [options.twCopy?.primaryAction || "撌脩??, options.twCopy?.secondaryAction || "?澆?瘜冽?"];
            const buttonsHtml = `${makeRatingActionHtml(ev, labels, context)}${makeReportActionHtml(ev, context)}`;
            return `
                <div class="event-actions event-actions--${context}" data-interaction-type="tw-online">
                    <div class="${context === "popup" ? "popup-action-group" : "card-action-group"}">${buttonsHtml}</div>
                </div>`;
        }
        const interactionType = getEventInteractionType(ev);
        let labels = ["撌脩??, "?澆?瘜冽?"];
        if (interactionType === "major-incident") labels = ["撌脩??];
        if (interactionType === "activity-rating") labels = ["?澆???, "?末", "銝??];
        if (interactionType === "sports-rating") labels = ["蝎曉蔗", "?桅?, "?瑕"];
        if (interactionType === "weather-ack") labels = ["撌脩??];
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
                "great-risk": "憭批嚚?憸券鈭辣",
                risk: "?塚?瘜冽?鈭辣",
                good: "???臬?敺鈭辣",
                "great-good": "憭批?嚚?虫?隞?,
                neutral: "閫撖?????"
            }[f.level];
            return `
                <div class="popup-demo-inner fortune-popup fortune-${f.level}" style="--popup-color:${f.color}">
                    <div class="fortune-popup-level">${mapTitle}</div>
                    <div class="popup-summary">${f.content}</div>
                    <div class="fortune-popup-raw">??鈭辣嚗?{displayTitle}</div>
                    ${renderEventActions(ev, { displayTitle, context: "popup" })}
                </div>`;
        }
        const city = ev.city || "?芣?蝷箏?撣?;
        const timeStr = formatEventTime(ev);
        const sourceLabel = twCopy?.sourceLabel || formatSourceLabel(ev);
        const detailLabel = twCopy?.categoryLabel || getCategoryDetailLabel(ev.category);
        const impactLabel = twCopy?.impactLabel || getImpactLabel(ev);
        const severityLabel = twCopy?.severityLabel || getSeverityLabel(ev);
        const badgeHtml = twCopy
            ? `<span class="cat-badge-v2" style="background:rgba(${catVisualMeta(ev.category).rgba},0.15);border:1px solid rgba(${catVisualMeta(ev.category).rgba},0.3);color:${catVisualMeta(ev.category).tint};">${twCopy.categoryLabel}</span>`
            : makeCatBadgeV2(ev.category);
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
                <div class="event-impact-row">
                    <span class="impact-chip impact-${getSeverityBand(ev)}">${impactLabel}</span>
                    <span class="severity-chip">${severityLabel}</span>
                    <span class="interaction-chip">${formatAttentionCount(ev)}</span>
                </div>
                <div class="popup-source-row"><span>${sourceLabel}</span></div>
                ${renderEventActions(ev, { displayTitle, context: "popup", twCopy })}
                ${ev.sourceUrl || ev.url ? `<div class="popup-footer"><a href="${ev.sourceUrl || ev.url}" target="_blank" rel="noreferrer" class="popup-btn-v2 primary">?亦?靘?</a></div>` : ""}
            </div>`;
    }

    function buildEventCardHtml(ev, displayTitle, displayContent, catVisual, twCopy = null) {
        if (currentMapMode === "fortune") {
            const f = getEventFortuneLevel(ev);
            const sourceUrl = ev.sourceUrl || ev.url || "";
            return `
                <div class="fortune-card fortune-card-${f.level}">
                    <div class="fortune-level-badge">${f.label}</div>
                    <div class="fortune-card-title">${f.label}嚚?{f.title}</div>
                    <div class="fortune-card-content">${f.content}</div>
                    <div class="fortune-card-raw">靘?鞈?嚗?{displayTitle}</div>
                    <div class="card-actions">
                        ${renderEventActions(ev, { displayTitle, context: "card" })}
                        ${sourceUrl ? `<a href="${sourceUrl}" target="_blank" rel="noreferrer" class="card-action-btn link" onclick="event.stopPropagation();">靘?</a>` : ""}
                    </div>
                </div>`;
        }
        const city = normalizeText(ev.city) || "?芣?蝷箏?撣?;
        const timeStr = formatEventTime(ev);
        const sourceLabel = twCopy?.sourceLabel || formatSourceLabel(ev);
        const detailLabel = twCopy?.categoryLabel || getCategoryDetailLabel(ev.category);
        const impactLabel = twCopy?.impactLabel || getImpactLabel(ev);
        const severityLabel = twCopy?.severityLabel || getSeverityLabel(ev);
        const badgeHtml = twCopy
            ? `<span class="cat-badge-v2" style="background:rgba(${catVisualMeta(ev.category).rgba},0.15);border:1px solid rgba(${catVisualMeta(ev.category).rgba},0.3);color:${catVisualMeta(ev.category).tint};">${twCopy.categoryLabel}</span>`
            : makeCatBadgeV2(ev.category);
        const sourceUrl = ev.sourceUrl || ev.url || "";
        const sourcesHtml = sourceUrl ? `
            <div class="card-sources-toggle" onclick="this.nextElementSibling.classList.toggle('visible'); event.stopPropagation();">
                <i class="fa-solid fa-newspaper"></i> 靘?鞈? <i class="fa-solid fa-chevron-down"></i>
            </div>
            <div class="card-sources-list">
                <a href="${sourceUrl}" target="_blank" rel="noreferrer" onclick="event.stopPropagation();">${sourceLabel}</a>
            </div>` : "";
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
                    ${sourceUrl ? `<a href="${sourceUrl}" target="_blank" rel="noreferrer" class="card-action-btn link" onclick="event.stopPropagation();">靘?</a>` : ""}
                </div>
            </div>`;
    }

    function updateCurationMeta(events){
        const cityValue = document.getElementById("city-filter")?.value || "all";
        const cityLabel = cityValue === "all" ? "?典" : cityValue;
        const modeLabel = currentMapMode === "online"
            ? "TW Online 閬死璅∪?"
            : (isTaiwanMode ? "?啁?啣?" : "蝯梯?閬?");
        const categoryLabel = currentMapMode === "fortune"
            ? getFortuneFilterLabel(getCurrentFortuneFilter())
            : (activeCategory === "all" ? "?券鈭辣" : (getCategoryVisual(activeCategory)?.text || activeCategory));
        const cityCount = new Set(events.map(ev => normalizeText(ev.city)).filter(Boolean)).size;
        const categoryCount = new Set(events.map(ev => getGroupCategory(normalizeText(ev.groupCategory || ev.category))).filter(Boolean)).size;
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
                ? "隞仿??脣?隞閫??銝隞賢?曹?隞嗉???鈭辣鞈?銝?嚗???閬死憸冽"
                : `??${events.length} 蝑?隞塚?瘨菔? ${cityCount} ????{categoryCount} 憿`;
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

    // ???? REACTION ????????????????????????????????????????????????????????????????????????????????????????
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
        const keywords = ["甇颱滿", "?瑚滿", "?", "?", "??", "?之鈭?", "撌亙?"];
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

    // ???? RENDER ????????????????????????????????????????????????????????????????????????????????????????????
    function renderEventActionsV2(ev, options = {}) {
        const context = options.context || "card";
        if (currentMapMode === "fortune") {
            const fortune = getEventFortuneLevel(ev);
            const labels = ["great-risk", "risk"].includes(fortune.level)
                ? ["撌脤??, "??瘜冽?"]
                : ["good", "great-good"].includes(fortune.level)
                    ? ["?喳?敺", "?澆???"]
                    : ["撌脩??, "??撖?];
            const cls = context === "popup" ? "popup-btn-v2 ghost rating-action" : "card-action-btn rating-action";
            const buttons = labels.map(label => `<button type="button" class="${cls}" onclick="event.stopPropagation();">${label}</button>`).join("");
            const report = makeReportActionHtml(ev, context);
            const sourceUrl = ev.sourceUrl || ev.url || "";
            const sourceBtn = sourceUrl
                ? `<a href="${sourceUrl}" target="_blank" rel="noreferrer" class="${context === "popup" ? "popup-btn-v2 ghost" : "card-action-btn link"}" onclick="event.stopPropagation();">靘?</a>`
                : "";
            return `<div class="event-actions event-actions--${context}" data-interaction-type="fortune"><div class="${context === "popup" ? "popup-action-group" : "card-action-group"}">${buttons}${report}${sourceBtn}</div></div>`;
        }
        return renderEventActions(ev, options);
    }
    function buildPopupHtmlV2(ev, displayTitle, displayContent, markerStyle, twCopy = null) {
        if (currentMapMode === "fortune") {
            const f = getEventFortuneLevel(ev);
            const mapTitle = {
                "great-risk": "憭批嚚?憸券鈭辣",
                risk: "?塚?瘜冽?鈭辣",
                good: "???臬?敺鈭辣",
                "great-good": "憭批?嚚?虫?隞?,
                neutral: "閫撖?????"
            }[f.level];
            return `
                <div class="popup-demo-inner fortune-popup fortune-${f.level}" style="--popup-color:${f.color}">
                    <div class="fortune-popup-level">${mapTitle}</div>
                    <div class="popup-summary">${f.content}</div>
                    <div class="fortune-popup-raw">??鈭辣嚗?{displayTitle}</div>
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
                    <div class="fortune-card-title">${f.label}嚚?{f.title}</div>
                    <div class="fortune-card-content">${f.content}</div>
                    <div class="fortune-card-raw">靘?鞈?嚗?{displayTitle}</div>
                    <div class="card-actions">
                        ${renderEventActionsV2(ev, { displayTitle, context: "card" })}
                        ${sourceUrl ? `<a href="${sourceUrl}" target="_blank" rel="noreferrer" class="card-action-btn link" onclick="event.stopPropagation();">靘?</a>` : ""}
                    </div>
                </div>`;
        }
        return buildEventCardHtml(ev, displayTitle, displayContent, catVisual, twCopy);
    }
    function renderEvents(){
        const filteredEvents = getFilteredEvents({ forMap: true });
        const isFortune = currentMapMode === "fortune";
        const nearbyPreferred = isNearbyMode && userLocation;
        const visibleEvents = nearbyPreferred
            ? getEventsNearUser(filteredEvents, nearbyRadiusMeters)
            : filteredEvents;
        nearbyEventsCache = nearbyPreferred ? visibleEvents : [];
        const isOnline = currentMapMode === "online";
        const isMobile = isMobileViewport();
        const useShowcaseDisplay = isShowcaseDisplayMode() && !isMobile;
        const displayEvents = useShowcaseDisplay ? getShowcaseEvents(visibleEvents) : visibleEvents;
        const markerLimit = isMobile ? MOBILE_MARKER_LIMIT : (useShowcaseDisplay ? SHOWCASE_MARKER_LIMIT : Infinity);
        const cardLimit = isMobile ? MOBILE_EVENT_CARD_LIMIT : (useShowcaseDisplay ? SHOWCASE_EVENT_CARD_LIMIT : Infinity);
        const config = isOnline ? TW_ONLINE_CATEGORIES : CATEGORY_CONFIG;
        const mapConfig = isOnline ? CATEGORY_MAP.online : CATEGORY_MAP.normal;

        visibleEvents.sort((a,b)=>{
            const aNews=(a.source==="news"||a.source==="RSS")?1:0;
            const bNews=(b.source==="news"||b.source==="RSS")?1:0;
            return bNews-aNews;
        });

        clearRenderedMarkers();
        eventRegistry.clear();
        eventList.innerHTML="";
        updateCurationMeta(visibleEvents);
        updateNearbyButtonsV2();
        setNearbyStatusTextV2();
        let renderedCardCount = 0;

        if(!visibleEvents.length){
            if (isFortune && !userLocation) {
                eventList.innerHTML = `
                    <div class="empty-state fortune-empty-state">
                        <i class="fa-solid fa-location-crosshairs"></i>
                        <p>隢?????券?</p>
                        <small>頞典??踹璅∪????找???蝵桀霈??鈭辣??/small>
                        <button type="button" id="fortune-nearby-cta" class="card-action-btn primary">?摰?</button>
                    </div>`;
                const cta = document.getElementById("fortune-nearby-cta");
                if (cta) cta.addEventListener("click", () => requestUserLocationV2());
            } else {
                const emptyText = nearbyPreferred
                    ? (isFortune ? "?桀?蝭??扳????嗡?隞塚??舀憭扳?撠??? : `?? ${formatRadiusLabel(nearbyRadiusMeters)} ?桀?瘝?鈭辣`)
                    : (isOnline ? TW_ONLINE_TEXT.emptyState : "?桀?瘝?蝚血?璇辣?????隞嗅????);
                eventList.innerHTML=`<div class="empty-state"><i class="fa-solid fa-map-location-dot"></i><p>${emptyText}</p></div>`;
            }
        }

        displayEvents.forEach((ev, index)=>{
            const mappedCat = mapConfig[ev.category] || ev.category;
            const cat = config[mappedCat]||config.other;
            const latlng = [Number(ev.lat),Number(ev.lng)];

            // Marker
            const twCopy = isTwOnlineMode() ? getTwOnlineEventCopy(ev) : null;
            const displayTitle = twCopy ? twCopy.title : (ev.title || "?芸??隞?);
            const displayContent = twCopy ? twCopy.content : (ev.content || "?桀?撠?批捆");
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
                : (CAT_SVG[getGroupCategory(ev.category)] || CAT_SVG[ev.category] || CAT_SVG.other);

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
                // ?脫擳歇??popup HTML ?湔皜脫???
            });
            popup.on("close", () => { if (activePopup === popup) activePopup = null; });

            const marker = new mapboxgl.Marker({
                element: makeMarkerElement(
                    markerStyle.color,
                    markerIcon,
                    markerSeverity,
                    markerStyle.glow,
                    fortune ? ["great-risk", "great-good"].includes(fortune.level) : pinPulse
                ),
                // 霈?Mapbox 隞亙?蝝葉敹?雿??踹??芾????偕撖賊??宏??                anchor: "center",
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
                const marker = L.marker([latlng[0], latlng[1]], {
                    icon: L.divIcon({
                        html: element.outerHTML,
                        className: "leaflet-demo-pin",
                        iconSize: [0, 0],
                        iconAnchor: [0, 0],
                        popupAnchor: [0, -42]
                    })
                }).addTo(window._fallbackMap)
                    .bindPopup(buildPopupHtmlV2(ev, displayTitle, displayContent, markerStyle), {
                        className: "custom-popup",
                        maxWidth: 328
                    });
                renderedMarkers.push(marker);
            }

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
            // ?脫擳歇??renderEventActions() ?湔皜脫?嚗??/api/reaction 頛憭望?????憭晞?
        });

        if (isNearbyMode && userLocation) drawUserLocationOverlay();
        const cnt=document.getElementById("mobile-count");
        if(cnt) cnt.textContent=`${visibleEvents.length} 蝑;
        lastRenderedEventCount = visibleEvents.length;
        updateMobileFilterSummary(visibleEvents.length);
        if (isNearbyMode) {
            setStatus(visibleEvents.length > 0 ? `?? ${formatRadiusLabel(nearbyRadiusMeters)}嚗?{visibleEvents.length} 隞嗡?隞跆 : `?? ${formatRadiusLabel(nearbyRadiusMeters)} ?桀?瘝?鈭辣`);
        } else {
            setStatus(currentMapMode === "online"
                ? "TW Online 閬死撅文??其葉嚚?曹?隞嗉???霈?
                : `撌脰???${visibleEvents.length} 蝑?隞跆);
        }
    }

    // ???? MOCK DATA ????????????????????????????????????????????????????????????????????????????????????????
    const MOCK_EVENTS = [
    { id: "m1", title: "????頠??", category: "traffic", city: "?啣?撣?, lat: 25.07, lng: 121.56, source: "Concept Demo", content: "撠陸頠?頛?嚗遣霅唳???? },
    { id: "m2", title: "?啣?撌亙??雿平??", category: "construction", city: "?啣?撣?, lat: 25.02, lng: 121.46, source: "Concept Demo", content: "?賢極??券??∪蝺??? },
    { id: "m3", title: "?梯餈絲???圈?", category: "earthquake", city: "?梯蝮?, lat: 24.02, lng: 121.62, source: "Concept Demo", content: "?桀??⊿?憭抒??? }
];

const DEMO_LOCATIONS = [
    { city: "?啣?撣?, lat: 25.0478, lng: 121.5170 },
    { city: "?啣?撣?, lat: 25.0120, lng: 121.4650 },
    { city: "?粹?撣?, lat: 25.1283, lng: 121.7392 },
    { city: "獢?撣?, lat: 24.9936, lng: 121.3010 },
    { city: "?啁姘撣?, lat: 24.8138, lng: 120.9675 },
    { city: "??蝮?, lat: 24.5602, lng: 120.8214 },
    { city: "?唬葉撣?, lat: 24.1477, lng: 120.6736 },
    { city: "敶啣?蝮?, lat: 24.0800, lng: 120.5380 },
    { city: "??蝮?, lat: 23.9609, lng: 120.9719 },
    { city: "?脫?蝮?, lat: 23.7092, lng: 120.4313 },
    { city: "?儔撣?, lat: 23.4801, lng: 120.4491 },
    { city: "?啣?撣?, lat: 22.9997, lng: 120.2270 },
    { city: "擃?撣?, lat: 22.6273, lng: 120.3014 },
    { city: "撅蝮?, lat: 22.5519, lng: 120.5487 },
    { city: "摰蝮?, lat: 24.7021, lng: 121.7378 },
    { city: "?梯蝮?, lat: 23.9911, lng: 121.6112 },
    { city: "?唳蝮?, lat: 22.7583, lng: 121.1444 },
    { city: "瞉?蝮?, lat: 23.5711, lng: 119.5793 },
    { city: "??蝮?, lat: 24.4321, lng: 118.3171 },
    { city: "???蝮?, lat: 26.1602, lng: 119.9517 }
];

const makeDemoTemplate = (title, category, severity, impactLevel, summary) => ({
    title,
    category,
    severity,
    impactLevel,
    summary
});

const TRAFFIC_DEMO_TEMPLATES = [
    makeDemoTemplate("?啣?頠??券??祈?撠?矽??, "traffic", 3, "銝剖漲", "撠陸?挾頠??嚗郎?孵???瘚???隤踵??),
    makeDemoTemplate("?啣??踵???頝臬銝??賢極憯?", "traffic", 2, "銝剖漲", "?賢極?憭頠?嚗頠蔭銵脤漲銝???),
    makeDemoTemplate("?粹?皜航正撗貉疏瑹??脣蝞∪", "traffic", 3, "銝剖漲", "皜臬??臬??楝頠?嚗遣霅唳韏唳隞?楝蝺?),
    makeDemoTemplate("獢?璈?琿??仿?頠辣隤?, "traffic", 2, "雿漲", "?仿?頠頝??瘀??恥頧????????),
    makeDemoTemplate("?啁姘蝘飛????頠??", "traffic", 3, "銝剖漲", "銝撠陸????嚗漱???曉????),
    makeDemoTemplate("???啣?銝?頝舫?券鈭斤恣", "traffic", 2, "雿漲", "撅?典蝺???嚗極蝔?頛脣?餌???),
    makeDemoTemplate("?唬葉?啁憭折?敹急?祈??寥?", "traffic", 3, "銝剖漲", "瘣餃?撠?撠憭??祈??孵??冽?蝡???),
    makeDemoTemplate("敶啣??⊥?鈭斗??????文?隞?憛?, "traffic", 3, "銝剖漲", "頠???喳像?ａ?頝荔?霅血???隤輻?頝臬??),
    makeDemoTemplate("???啣??撅勗???頠蔭憓?", "traffic", 2, "雿漲", "閫??頛?銝凋?撅梧??典?頝舀挾??????),
    makeDemoTemplate("?脫??撣??楝璅??鼓", "traffic", 2, "雿漲", "憭??賢極蝮格?頠?嚗???擏??銵?),
    makeDemoTemplate("?儔?怨?蝡??????", "traffic", 3, "銝剖漲", "?∟郎??嚗?頠甈∠?蔣?踴?),
    makeDemoTemplate("?啣?銝剛正????湔遛雿?皞?, "traffic", 2, "雿漲", "??頠蔭憓?嚗?摨???頠?撘?閮?),
    makeDemoTemplate("擃?銝剜迤頝航?頠撌交??, "traffic", 3, "銝剖漲", "憭?頝臬蝮格?頠?嚗?頠??祈??靘?隤???),
    makeDemoTemplate("撅瞏桀???瘞渡恣撌亦?鈭斤恣", "traffic", 2, "雿漲", "撌亦??惇??Ｚ???撠陸?挾?耦??詻?),
    makeDemoTemplate("摰??鈭斗???蝔?瘚?擃?, "traffic", 3, "銝剖漲", "擃撅撱箄降??挾嚗????批歇????),
    makeDemoTemplate("?梯撣?閫?毀憯怨?暺恣??, "traffic", 2, "雿漲", "?梢??舫??券?閮剛??嚗?撠?頛漱蝜?)
];

const MAJOR_DEMO_TEMPLATES = [
    makeDemoTemplate("?唳瘚瑕硫?恥皞箸偌?銝祥", "accident", 5, "?之", "瘚瑕?蝒??Ｗ硫瘚???鈭箏?啣?嗆?嚗??喳甇颱滿??),
    makeDemoTemplate("瞉?瞍葛??雿平撌亙??", "safety", 5, "?之", "??皛瘜Ｗ?雿平?∴??曉??撌亙?隤踵??撌乓?),
    makeDemoTemplate("??瘞??怎撱嗥?銝鈭粹", "incident", 5, "?之", "瘛勗??怎??瞈?蝡嚗??嗅?交批??琿??),
    makeDemoTemplate("???蝣潮??璈蕃閬???, "accident", 4, "?之", "??璈?璆剜?蝧餉?嚗?擏??琿閫撖?),
    makeDemoTemplate("?啣?憭扳?憭??賢極憓??", "safety", 5, "?之", "?賢極撟喳?摰仃??撌乩犖憓?????),
    makeDemoTemplate("?啣?撌亙曋寞??憯撌乩犖", "safety", 5, "?之", "撌亙?鈭???憭犖?嚗?瑼Ｗ雿?瘙?撌交??),
    makeDemoTemplate("?粹??澈?怎瞈?敶梢?圈?", "incident", 4, "?之", "?澈?怎撱嗥??嚗??脤?撣???銝衣????瘞?),
    makeDemoTemplate("獢??頠??頠???, "accident", 4, "?之", "頝臬頧?閬?甇餉??蝳?擉ㄚ????),
    makeDemoTemplate("?啁姘?飛瑽質?瘣拇?撌亙?鈭辣", "safety", 5, "?之", "瑽質??乩辣?啣虜撠?粹撒瘞?憭援嚗????撌亙?????),
    makeDemoTemplate("???餃控甇仿?憓?", "accident", 4, "?之", "撅勗?憭梯雲憓?嚗??脫???隞亦鼎蝝Ｙ頂蝯勗????),
    makeDemoTemplate("?唬葉撣?行?憭犖?", "incident", 5, "?之", "??臬?瘣拙??潛??賂??曉???瑁?頛瘞??),
    makeDemoTemplate("敶啣?撌亙?璈憭曉撌亙?鈭?", "safety", 5, "?之", "雿平?⊥??券璈?脣?嚗??寥?炎??),
    makeDemoTemplate("??皞芾健?脫偌皞箸偌??", "accident", 5, "?之", "皞芣偌?湔撞??瘞?嚗???蝣箄?銝鈭箸香鈭～?),
    makeDemoTemplate("?脫?颲脰??怎瘜Ｗ??啣?", "incident", 4, "?之", "?怎撱嗥??蝛粹?嚗??脤??餅迫?怠?游之??),
    makeDemoTemplate("?儔撌乩犖撅?靽桃?憓", "safety", 5, "?之", "撅?靽桃???憭梯雲憓嚗???琿??),
    makeDemoTemplate("?啣?憭??支?瘝寥?韏瑞", "incident", 4, "?之", "?支?瘝寥?韏瑞??撽?嚗??脣?游?餈皛?賬?),
    makeDemoTemplate("擃?皜臬?鞎冽?頠１?香鈭∩???, "accident", 5, "?之", "皜臬??楝?潛?蝣唳?嚗?擏??唳??箏?摰??甇颱滿??),
    makeDemoTemplate("撅?極撱瘞??賢?撌?, "safety", 5, "?之", "?餅除摰斤?賡?閮剖???嚗極摰雿?瘙炎靽桀?敺拙極??)
];

const DISASTER_DEMO_TEMPLATES = [
    makeDemoTemplate("摰撅勗??瘚??脰郎??, "disaster", 4, "?之", "???雿踵漯瘞湔毽瞈?靽?嗅??歇摰??湔??),
    makeDemoTemplate("?梯餈絲閬芋5.4?圈?", "earthquake", 4, "?之", "?圈????典??啣???嚗漱??瘞湧閮剜撌⊥炎銝准?),
    makeDemoTemplate("?唳蝮梯健擗??餌??", "earthquake", 3, "銝剖漲", "?圈?敺?????????∟???璇脰?摰撌⊥??),
    makeDemoTemplate("瞉?撘琿◢瘚芣絲銝郎??, "typhoon", 3, "銝剖漲", "憸梢◢憭??唳?敶梢嚗撜嗉蝺?瘚瑁情隤踵??),
    makeDemoTemplate("??瘝踹硫?湔蔭?脩??", "typhoon", 3, "銝剖漲", "憸梢◢?亥???瘝踹硫雿牧??撥撌⊥??),
    makeDemoTemplate("???皜臬??脤２?雿平", "typhoon", 4, "?之", "?寡?脫葛?輸◢嚗葛?雿???蝜抵?閮剜瑼Ｘ??),
    makeDemoTemplate("?啣?撅勗?啗?喳??郊??, "disaster", 3, "銝剖漲", "撅勗?甇仿??擛?嚗?摨???曆蒂瘣曉撌⊥炎??),
    makeDemoTemplate("?啣?皞芣?瘞港?敹恍???, "disaster", 4, "?之", "鞊芷雿踵漯瘚偌雿潸?霅行?嚗??祆??雿牧雿??),
    makeDemoTemplate("?粹??剖辣?撥?蝛溯瘞?, "disaster", 3, "銝剖漲", "?偌蝟餌絞皛輯?嚗??雿牧頝舀挾?剜蝛偌??),
    makeDemoTemplate("獢?瘝踵絲憸典????剛玨璅??楠", "typhoon", 3, "銝剖漲", "憸梢◢憭?憸典憓撥嚗?摨?隡唳??漱???具?),
    makeDemoTemplate("?啁姘銝?∪皛???葫", "disaster", 3, "銝剖漲", "??葫暺?蝘餃????賊??桐???閫皜祇??),
    makeDemoTemplate("??餈絲?圈??漲銝?", "earthquake", 3, "銝剖漲", "?圈????剜??嚗??脰??餃??桐??甇?虜??)
];

const WEATHER_DEMO_TEMPLATES = [
    makeDemoTemplate("?唬葉???琿?冽???擃?, "weather", 2, "雿漲", "瘞?情?桐?????撠??箇?嚗??箸?撣園?瑯?),
    makeDemoTemplate("敶啣?瘝踵絲蝛箸除瞈漲??", "weather", 2, "雿漲", "皜?質?摨衣???刻楝鈭箇???蝺???),
    makeDemoTemplate("??撅勗????脤?憓?", "weather", 2, "雿漲", "撅勗?憭拇除霈?敹恬??餃控銵?撱箄降?銝??),
    makeDemoTemplate("?脫?撟喳?擃澈璈??", "weather", 2, "雿漲", "??皞怠漲??嚗憭極雿釣??瘞港??胯?),
    makeDemoTemplate("?儔撣?蝝怠?蝺??詨?擃?, "weather", 2, "雿漲", "?賢予?亦撘瘀?瘞憭撱箄降?末?脫??),
    makeDemoTemplate("?啣?瘝踵絲??憸典憓撥", "weather", 2, "雿漲", "瘚琿◢?＊嚗?銋?頠??嗅?瘣餃?瘜冽?憸典??),
    makeDemoTemplate("擃?蝛箏??湔璇辣?桅?, "weather", 2, "雿漲", "??瘚琿憸刻??????黎???單?蝛箏???),
    makeDemoTemplate("撅??雀撅?券憸?, "weather", 2, "雿漲", "?賢控憸典?撘瘀?銵?蝛箸?頝舀挾瘜冽?蝛拙?頠?)
];

const ACTIVITY_DEMO_TEMPLATES = [
    makeDemoTemplate("摰蝡亦撣??冽?餃", "activity", 1, "雿漲", "閬芸??支??”瞍暑??銝剜瘝喳硫撱???),
    makeDemoTemplate("?梯皜舀膨?單?撅???亙", "activity", 1, "雿漲", "??摰??典璅???頠??券?閮剛?擏?),
    makeDemoTemplate("?唳?菔??雿???", "activity", 1, "雿漲", "??撌乩???撠汗頝舐?銝脰撣?摨振??),
    makeDemoTemplate("瞉?瘚瑟??暑蝭閰衣???, "activity", 1, "雿漲", "撅?隞晶瞏桅?撣嗥???瘚瑕雀撌亥???),
    makeDemoTemplate("???文?憭?撠汗??勗?", "activity", 1, "雿漲", "撠汗頝舐?蝯?甇瑕撱箇???孵???),
    makeDemoTemplate("????瘛?皜砍迤隤芣???, "activity", 1, "雿漲", "?恥銝剖???閫皜祆?畾菔?鈭日?閮?),
    makeDemoTemplate("?啣?瘝喳硫?餃蔣?暹?瘣餃?", "activity", 1, "雿漲", "?嗅??暹???∟?勗摨改??曉?漱??撘?)
];

const SPORTS_DEMO_TEMPLATES = [
    makeDemoTemplate("?啣?瘝單膨擐祆??曉?蝯絲頝?, "sports", 1, "雿漲", "鞈賡?瘝踵眾撗貉身鋆策蝡??券??楝?⊥?畾萇恣?嗚?),
    makeDemoTemplate("?粹?皜舐?芾?頠??啗魚", "sports", 1, "雿漲", "?魚頝舐?銝脰皜臬??絲撗豢暺?),
    makeDemoTemplate("獢?璉?銝餃蝟餃?鞈?, "sports", 1, "雿漲", "??鞈賭??亙鈭箸蔭憓?嚗?????甈～?),
    makeDemoTemplate("?啁姘??銝?銝??魚", "sports", 1, "雿漲", "撣?撱?閮剔蔭?冽?????曉???),
    makeDemoTemplate("??撅勗?頞?頝?, "sports", 1, "雿漲", "頝舐?蝬??菜郊??銝餉齒?桐?閮剛?蝯西??怨風蝡?),
    makeDemoTemplate("?唬葉瘣脤???璉?隢魚", "sports", 1, "雿漲", "憭????嚗??游??頠?瘙?擃?)
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
        title: "?啣?撠頝航?瘚???,
        content: "撠頝航??瑟旨頝臬??瘚?????挾?航敶梢銵??漲??,
        summary: "撠頝航??瑟旨頝臬??瘚?????挾?航敶梢銵??漲??,
        category: "traffic",
        city: "?啣?撣?,
        area: "?勗?",
        lat: 22.9996,
        lng: 120.2218,
        severity: 3,
        source: "撅內鞈?",
        sourceName: "撅內鞈?",
        isDemo: true,
        impactLevel: "銝剖漲",
        interactionCount: 246,
        publishedAt: new Date(Date.UTC(2026, 5, 2, 0, 5)).toISOString()
    },
    {
        id: "demo-tn-02",
        title: "?之?券?頝臬鈭???",
        content: "??憭批飛?券?頝臬?潛?頛凝鈭?嚗?渲??葉嚗遣霅啗?鈭箄?頠?撠?????,
        summary: "??憭批飛?券?頝臬?潛?頛凝鈭?嚗?渲??葉嚗遣霅啗?鈭箄?頠?撠?????,
        category: "accident",
        city: "?啣?撣?,
        area: "?勗?",
        lat: 22.9979,
        lng: 120.2199,
        severity: 4,
        source: "撅內鞈?",
        sourceName: "撅內鞈?",
        isDemo: true,
        impactLevel: "擃漲",
        interactionCount: 312,
        hasCasualty: false,
        publishedAt: new Date(Date.UTC(2026, 5, 2, 0, 12)).toISOString()
    },
    {
        id: "demo-tn-03",
        title: "?啣??砍???撣?",
        content: "?啣??砍??券??箇??撣??犖瘚????臬?敺??郊嚗?????券?鈭日?,
        summary: "?啣??砍??券??箇??撣??犖瘚????臬?敺??郊嚗?????券?鈭日?,
        category: "activity",
        city: "?啣?撣?,
        area: "??",
        lat: 23.0018,
        lng: 120.2107,
        severity: 2,
        source: "撅內鞈?",
        sourceName: "撅內鞈?",
        isDemo: true,
        impactLevel: "頛漲",
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
        setStatus("Concept Demo 頛銝?..");
        parsedEvents = DEMO_EVENTS.map(normalizeDisplayEvent);
        console.log("parsedEvents length", parsedEvents.length);
        renderCategoryButtons();
        renderEvents();
        setStatus(currentMapMode === "online"
            ? "TW Online 閬死撅文??其葉嚚?曹?隞嗉???霈?
            : `Golden Pin Concept Edition嚚?{parsedEvents.length} 蝑?隞跆);
    }

    // ???? CITY SYNC ????????????????????????????????????????????????????????????????????????????????????????
    function syncCityFilter(value){
        document.getElementById("city-filter").value=value;
        document.getElementById("city-filter-mobile").value=value;
        drawCityBoundary(value);
        renderEvents();
        const centers = {
            "?啣?撣?:[25.033,121.565], "?啣?撣?:[25.011,121.466], "?粹?撣?:[25.128,121.739],
            "獢?撣?:[24.994,121.301], "?啁姘撣?:[24.814,120.968], "?啁姘蝮?:[24.828,121.013],
            "??蝮?:[24.560,120.821], "?唬葉撣?:[24.148,120.674], "敶啣?蝮?:[24.052,120.539],
            "??蝮?:[23.903,120.688], "?脫?蝮?:[23.709,120.431], "?儔撣?:[23.480,120.449],
            "?儔蝮?:[23.452,120.255], "?啣?撣?:[23.000,120.227], "擃?撣?:[22.627,120.301],
            "撅蝮?:[22.672,120.486], "摰蝮?:[24.730,121.763], "?梯蝮?:[23.987,121.602],
            "?唳蝮?:[22.758,121.144], "瞉?蝮?:[23.571,119.579], "??蝮?:[24.449,118.376],
            "???蝮?:[26.150,119.936]
        };
        const match = Object.keys(centers).find(k=>k.startsWith(value)||value.startsWith(k));
        if(value==="all"){
            flyToLatLng([23.698,120.961],7,1500);
        } else if(match){
            flyToLatLng(centers[match],11,1500);
        }
    }

    // ???? MODE ??????????????????????????????????????????????????????????????????????????????????????????????????
    const BAR_COLORS = ['#4f8cff','#a78bfa','#34d399','#fb923c','#f05a5a','#fbbf24','#5eead4','#c4b5fd','#86efac','#fdba74'];

    const CAT_COLORS = {
      traffic:    { bg:'rgba(79,140,255,0.15)',  color:'#4f8cff',  text:'鈭日? },
      accident:   { bg:'rgba(249,115,22,0.15)',  color:'#f97316',  text:'??' },
      disaster:   { bg:'rgba(240,90,90,0.15)',   color:'#f05a5a',  text:'?賢拿' },
      weather:    { bg:'rgba(56,189,248,0.15)',  color:'#38bdf8',  text:'憭拇除' },
      activity:   { bg:'rgba(52,211,153,0.15)',  color:'#34d399',  text:'瘣餃?' },
      sports:     { bg:'rgba(167,139,250,0.15)', color:'#a78bfa',  text:'鞈賭?' },
      other:      { bg:'rgba(107,114,128,0.15)', color:'#6b7280',  text:'?嗡?' },
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
 
      // ?株都??
      const totalEl = document.getElementById('stat-total'); 
      if(totalEl) totalEl.textContent = events.length; 
 
      // ?????? 
      const cityMap = {}; 
      events.forEach(ev=>{ 
        if(!ev.city) return; 
        const city = (ev.city||'').replace(/??|??/,'').slice(0,3); 
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
 
      // Reaction ?株都??
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
 
      // 霈??鈭辣???絞閮?      const hotEl = document.getElementById('hot-events'); 
      if(!hotEl) return; 
      hotEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">頛銝?..</div>'; 
 
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
        hotEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">?桀?瘝?鈭?鞈?</div>'; 
        return; 
      } 
 
      hotEl.innerHTML = top4.map((ev,i)=>{ 
        const cat = CAT_COLORS[ev.category] || CAT_COLORS.other; 
        const title = ev.twOnlineTitle || ev.title || '?芸??隞?;
        const city  = ev.city || ''; 
        const border = i < top4.length-1 ? 'border-bottom:1px solid rgba(99,120,180,0.1);' : ''; 
        return ` 
          <div style="padding:10px 0;${border}"> 
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;"> 
              <span style="font-size:10px;font-weight:500;padding:2px 7px;border-radius:99px;background:${cat.bg};color:${cat.color};">${cat.text}</span> 
              <span style="font-size:11px;color:var(--text-secondary);">?券? ${ev.muyu} &nbsp;銝? ${ev.candle}</span> 
            </div> 
            <div style="font-size:12px;color:var(--text-primary);line-height:1.55;margin-bottom:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${title}</div> 
            <div style="font-size:11px;color:var(--text-muted);">?圈? ${city}</div> 
          </div> 
        `; 
      }).join(''); 
    } 


    // ???? SEARCH ??????????????????????????????????????????????????????????????????????????????????????????????
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
        const key = getGroupCategory(ev.groupCategory || ev.category) || "other";
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
            <div class="hot-event-score">${ev.total.toLocaleString()} 鈭箏歇?釣</div>
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

    // ???? DRAWER ??????????????????????????????????????????????????????????????????????????????????????????????
    function toggleDrawer(){
        if(window.innerWidth<768) {
            newsSidebar.classList.toggle("drawer-collapsed");
            scheduleMapResize();
        }
    }

    // ???? MOBILE GESTURES ????????????????????????????????????????????????????????????????????????????
    let startY = 0;
    let isDragging = false;
    let pendingDrawerDelta = 0;
    let drawerDragFrame = 0;
    const sidebar = document.getElementById("news-sidebar");

    sidebar.addEventListener("touchstart", e => {
        if (window.innerWidth >= 768) return;
        const touch = e.touches[0];
        const sidebarTop = sidebar.getBoundingClientRect().top;
        // ?芸?賢??????
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
        if (delta < 0) return; // ?芾???銝??喋?        sidebar.style.transform = `translateY(${delta}px)`;
        
        // 撅????靽??批捆?脣???        if (!sidebar.classList.contains("drawer-collapsed")) {
            // touchmove 雿輻 passive listener嚗??澆 preventDefault??            e.stopPropagation();
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

    // ?綜等??????結?鞈?
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
        ? "瘣餃?鞈??航炊"
        : isTrafficEvent(ev)
            ? "頝舀?鞈??航炊"
            : "鈭辣鞈??航炊";

    return ["雿蔭?航炊", resolvedOption, "??鈭辣", "銝甇日?鈭辣", "鞈???", "?嗡?"];
}

function renderReportTypeOptions(ev) {
    const typeEl = document.getElementById("report-type");
    if (!typeEl) return;

    const options = getReportOptionsForEvent(ev);
    typeEl.innerHTML = `<option value="">隢???梢???/option>` +
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
    if (titleEl) titleEl.value = ev.displayTitle || ev.title || "?芸??隞?;
    if (noteEl) noteEl.value = "";
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "??";
    }

    const modal = document.getElementById("report-modal");
    if (modal) modal.classList.add("visible");
}

async function submitReport() {
    const ev = currentReportEvent;
    if (!ev) {
        showReportError("?曆??唬?隞嗉???隢??圈????晞?);
        return;
    }

    const typeEl = document.getElementById("report-type");
    const noteEl = document.getElementById("report-note") || document.getElementById("report-message");
    const submitBtn = document.getElementById("report-submit-btn");
    const type = typeEl?.value || "";
    const note = noteEl?.value || "";

    if (!type) {
        showReportError("隢???梢???);
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "?銝?..";
    }

    try {
        await fetch("/api/report", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                eventId: ev.id,
                eventTitle: ev.displayTitle || ev.title || "?芸??隞?,
                type,
                note,
                createdAt: new Date().toISOString()
            })
        });
        showReportSuccess("撌脫?啣???);
        if (reportCloseTimer) clearTimeout(reportCloseTimer);
        reportCloseTimer = setTimeout(closeReportModal, 900);
    } catch (error) {
        console.warn("Report submit failed", error);
        showReportError("??憭望?嚗?蝔??岫??);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "??";
        }
    }
}
    // CONCEPT DEMO MODAL ??????????????????????????????????????????????????????????????????????
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
            [".brand-title", "撜嗅飲?? Island Pulse"],
            [".brand-sub", isOnline ? "TW Online 閬死璅∪?" : "GOLDEN PIN CONCEPT EDITION"],
            [".brand-note", "?啁?單?鈭辣?啣?嚚oncept Demo"],
            [".sidebar-title", "?啁?單?鈭辣皜"],
            [".toolbar-caption", "?啁?單?鈭辣?啣?"],
            ["#server-status", "閬死璅∪??銝?],
            ["#player-count", "Concept Demo"],
            ["#tw-online-count", "Concept Demo"],
            ["#hero-mode-copy", isOnline ? "TW Online 閬死璅∪?" : "?啁?啣?"]
        ];
        textPairs.forEach(([selector, text]) => {
            const el = document.querySelector(selector);
            if (el) el.textContent = text;
        });
        document.querySelectorAll(".donate-btn").forEach(btn => {
            btn.textContent = "?舀?雿?";
            btn.setAttribute("aria-label", "?舀?雿?");
            btn.setAttribute("title", "?舀?雿?");
        });
        ["search-input", "event-search", "event-search-mobile"].forEach(id => {
            const searchEl = document.getElementById(id);
            if (searchEl) searchEl.placeholder = "??????憿?鈭辣";
        });
    }

    // ???? DONATE ??????????????????????????????????????????????????????????????????????????????????????????????
    // Override copy mapper to keep mode labels consistent (normal / fortune / online).
    function applyConceptCopy(){
        const isOnline = currentMapMode === "online";
        const isFortune = currentMapMode === "fortune";
        const textPairs = [
            [".brand-title", "撜嗅飲?? Island Pulse"],
            [".brand-sub", isOnline ? "TW ONLINE 閬死璅∪?" : (isFortune ? "頞典??踹璅∪?嚚??嗡?隞嗅霈" : "?啁?單?鈭辣?啣?嚚oncept Demo")],
            [".brand-note", "?啁?單?鈭辣?啣?嚚oncept Demo"],
            [".sidebar-title", isFortune ? "?券?鈭辣?文?" : "?啁?單?鈭辣皜"],
            [".toolbar-caption", isFortune ? "隞乩???蝵桃銝剖??方???鈭辣" : "?啁?單?鈭辣?啣?"],
            ["#server-status", "閬死璅∪??銝?],
            ["#player-count", "Concept Demo"],
            ["#tw-online-count", "Concept Demo"],
            ["#hero-mode-copy", isOnline ? "TW ONLINE 閬死璅∪?" : (isFortune ? "頞典??踹璅∪?" : "?啁?啣?")]
        ];
        textPairs.forEach(([selector, text]) => {
            const el = document.querySelector(selector);
            if (el) el.textContent = text;
        });
        const sidebarSubtitle = document.getElementById("sidebar-subtitle");
        if (sidebarSubtitle) {
            sidebarSubtitle.textContent = isFortune
                ? "隞亦??蝵桃銝剖?嚗??餈澆?????閬??鈭辣??
                : "";
        }
        document.querySelectorAll(".donate-btn").forEach(btn => {
            btn.textContent = "?舀?雿?";
            btn.setAttribute("aria-label", "?舀?雿?");
            btn.setAttribute("title", "?舀?雿?");
        });
        ["search-input", "event-search", "event-search-mobile"].forEach(id => {
            const searchEl = document.getElementById(id);
            if (searchEl) searchEl.placeholder = currentMapMode === "fortune"
                ? "????鈭辣?暺???"
                : "??????憿?鈭辣";
        });
    }

    async function handleDonate(amount, btn){
        try{
            const orig=btn.innerHTML;
            btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> ??銝?..'; btn.disabled=true;
            const res=await fetch('/api/create-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount,itemName:`?舀?雿? ${amount} ?})});
            if(!res.ok) throw new Error();
            const html=await res.text();
            const div=document.createElement('div'); div.innerHTML=html;
            document.body.appendChild(div); div.querySelector('form').submit();
        }catch(e){
            alert('隞狡???仃??隢?敺?閰艾?);
            btn.innerHTML='?舀?雿?'; btn.disabled=false;
        }
    }

    // ???? EVENTS ??????????????????????????????????????????????????????????????????????????????????????????????
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
        syncNewsAndRender();
        updateNearbyButtonsV2();
        syncNearbyRadiusSelectors();
        setNearbyStatusTextV2();
        loadTwGeoJSON();
    });



