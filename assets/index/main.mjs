import { eventDisplay } from "./modules/event-display-adapter.mjs";
import { createDataTrustController } from "./modules/data-trust.mjs";
import {
    bindDelegatedActions,
    escapeAttribute,
    escapeHtml as escapeHtmlValue,
    sanitizeExternalUrl
} from "./modules/dom-utils.mjs";
import { readReportPayload } from "./modules/reports.mjs";
import { readReactionPayload } from "./modules/reactions.mjs";
import { getMapboxToken, shouldRenderLocationMarker as shouldRenderMapLocationMarker } from "./modules/map.mjs";
import { buildNearbyRadiusGeoJson } from "./modules/nearby-radius.mjs";
import {
    forEachEventSafely,
    getSearchableEventText,
    isMourningEvent as isMourningEventSafely,
    normalizeEventTextFields,
    safeText
} from "./modules/event-text.mjs";
import {
    ALERT_ZONE_MAX_ITEMS,
    ALERT_ZONE_RADII,
    attachAlertZoneMatches,
    countAlertZoneMatchedEvents,
    createAlertZone,
    filterAlertZoneEvents,
    formatAlertZoneRadius,
    getAlertZoneTypeLabel,
    loadAlertZones,
    removeAlertZone,
    saveAlertZones,
    sortAlertZoneEvents,
    updateAlertZone
} from "./modules/alert-zones.mjs";
import { findPublishedSubmission, getRequestedSubmissionId, removeSubmissionQuery } from "./modules/submission-focus.mjs";
import { createEventDataManager } from "./modules/event-data-manager.mjs";
import { trackEvent } from "./modules/analytics.mjs";
import {
    buildStatsSummary,
    getStatsCategoryLabel,
    sortPopularOrRecentEvents
} from "./modules/stats-view.mjs";
import { isWithinTimeRange } from "./modules/time-range-filter.mjs";
import { isVisibleEventLayer } from "./modules/event-layer.mjs";
import { getLocationPresentation } from "./modules/location-presentation.mjs";
import { isEventInBounds, normalizeBounds } from "./modules/map-bounds-filter.mjs";
import { getCardPreview } from "./modules/event-card-view.mjs";

    // ── CONFIG ──────────────────────────────────────────────
    const MAPBOX_TOKEN = getMapboxToken(); 
    const VIDEO_DEMO_ROUTE = window.location.pathname.replace(/\/+$/, "") === "/video";
    const VIDEO_DEMO_PARAMS = new URLSearchParams(window.location.search);
    const VIDEO_DEMO_LOOP = VIDEO_DEMO_ROUTE && VIDEO_DEMO_PARAMS.get("loop") === "1";
    const VIDEO_DEMO_TEST_MODE = VIDEO_DEMO_ROUTE && VIDEO_DEMO_PARAMS.get("test") === "1";
    const requestedSubmissionId = VIDEO_DEMO_ROUTE ? "" : getRequestedSubmissionId();
    const requestedEventId = VIDEO_DEMO_ROUTE ? "" : new URLSearchParams(window.location.search).get("event")?.trim();
    const VIDEO_DEMO_FALLBACK_LOCATION = { lat: 23.0, lng: 120.227, accuracy: 20 };
    const VIDEO_DEMO_USER_LOCATION = { lat: 25.0386, lng: 121.5649, accuracy: 20 };
    const VIDEO_DEMO_PRIMARY_EVENT_ID = "video-demo-roadwork";
    const VIDEO_DEMO_REPORT_EVENT_ID = "video-demo-report";
    const VIDEO_DEMO_MARKER_LIMIT = 80;
    const VIDEO_DEMO_CARD_LIMIT = 10;
    if (VIDEO_DEMO_ROUTE) window.VIDEO_DEMO_DONE = false;
    
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
        accident:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
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

    const VIDEO_DEMO_CORE_EVENTS = [
        {
            id: VIDEO_DEMO_PRIMARY_EVENT_ID,
            title: "中山北路夜間道路施工與改道",
            category: "traffic",
            city: "台北",
            lat: 25.0412,
            lng: 121.5638,
            source: "TDX CMS",
            content: "中山北路二段晚間進行路面刨鋪，外側車道封閉並導引用路人改道。",
            impact: "外側車道封閉，周邊路口易回堵",
            advice: "提前改走承德路或新生北路",
            locationPrecision: "exact",
            locationSource: "official",
            locationConfidence: 1,
            locationQuality: "high",
            locationDisplayMode: "point",
            updatedAt: "2026-07-12T11:00:00+08:00",
            publishedAt: "2026-07-12T10:48:00+08:00",
            url: "https://demo.island-pulse.local/roadwork"
        },
        {
            id: "video-demo-activity",
            title: "松山文創園區大型活動人潮聚集",
            category: "activity",
            city: "台北",
            lat: 25.0439,
            lng: 121.5594,
            source: "RSS",
            content: "週末大型展演活動入場尖峰，周邊人行空間與接駁站出現排隊人潮。",
            impact: "活動散場時段可能影響周邊步行與接駁",
            advice: "避開尖峰或改搭捷運至鄰近站點",
            locationPrecision: "exact",
            locationSource: "demo",
            locationConfidence: 0.96,
            locationQuality: "high",
            locationDisplayMode: "point",
            startsAt: "2026-07-12T14:00:00+08:00",
            updatedAt: "2026-07-12T10:35:00+08:00",
            publishedAt: "2026-07-12T10:20:00+08:00",
            url: "https://demo.island-pulse.local/activity"
        },
        {
            id: "video-demo-rain",
            title: "信義快速道路豪雨積水影響通行",
            category: "disaster",
            city: "台北",
            lat: 25.0144,
            lng: 121.5942,
            source: "news",
            content: "午後強降雨造成信義快速道路匝道附近短時積水，車流放慢並回堵。",
            impact: "積水與車速降低造成交通影響",
            advice: "行經低窪路段請放慢並留意即時管制",
            locationPrecision: "exact",
            locationSource: "demo",
            locationConfidence: 0.92,
            locationQuality: "high",
            locationDisplayMode: "point",
            updatedAt: "2026-07-12T10:55:00+08:00",
            publishedAt: "2026-07-12T10:40:00+08:00",
            url: "https://demo.island-pulse.local/rain"
        },
        {
            id: VIDEO_DEMO_REPORT_EVENT_ID,
            title: "南京東路號誌故障位置待修正",
            category: "traffic",
            city: "台北",
            lat: 25.0513,
            lng: 121.5521,
            source: "RSS",
            content: "南京東路口號誌異常，民眾回報定位可能偏移，需要補充實際路口資訊。",
            impact: "車流通過速度降低",
            advice: "可回報座標或補充現場位置",
            locationPrecision: "district",
            locationSource: "demo",
            locationConfidence: 0.74,
            locationQuality: "medium",
            locationDisplayMode: "estimated",
            updatedAt: "2026-07-12T10:50:00+08:00",
            publishedAt: "2026-07-12T10:30:00+08:00",
            url: "https://demo.island-pulse.local/report"
        }
    ];

    const VIDEO_DEMO_NEARBY_EVENTS = [
        ["video-demo-near-signal", "仁愛路號誌故障車流放慢", "traffic", "台北", 25.0372, 121.5566, "TDX CMS", "仁愛路與光復南路口號誌故障，警察到場指揮，車流放慢。"],
        ["video-demo-near-fire", "基隆路店面火警交通管制", "fire", "台北", 25.0585, 121.5920, "RSS", "基隆路一段店面火警，消防車輛進出，周邊道路短暫管制。"],
        ["video-demo-near-traffic", "市民大道車多回堵", "traffic", "台北", 25.0550, 121.5260, "TDX CMS", "市民大道往西車多，匝道口回堵，請改走平面道路。"],
        ["video-demo-near-activity", "大安森林公園活動人潮", "activity", "台北", 25.0160, 121.5480, "RSS", "午後親子活動散場人潮增加，捷運出口與周邊公車站排隊。"],
        ["video-demo-near-power", "內湖園區停電影響號誌", "other", "台北", 25.0690, 121.5600, "news", "內湖部分路段短暫停電，路口號誌改由警察協助指揮。"],
        ["video-demo-near-road", "和平東路地下管線搶修", "traffic", "台北", 25.0015, 121.5570, "TDX CMS", "和平東路地下管線搶修，外側車道封閉，公車站位臨時調整。"]
    ].map(([id, title, category, city, lat, lng, source, content], index) => ({
        id,
        title,
        category,
        city,
        lat,
        lng,
        source,
        content,
        impact: category === "activity" ? "人潮影響步行與接駁" : "周邊通行速度降低",
        advice: "出發前查看地圖並預留緩衝時間",
        locationPrecision: "exact",
        locationSource: "demo",
        locationConfidence: 0.9,
        locationQuality: "high",
        locationDisplayMode: "point",
        updatedAt: `2026-07-12T10:${String(44 - index).padStart(2, "0")}:00+08:00`,
        publishedAt: `2026-07-12T10:${String(30 - index).padStart(2, "0")}:00+08:00`,
        url: `https://demo.island-pulse.local/nearby-${index + 1}`
    }));

    const VIDEO_DEMO_REGION_GROUPS = [
        ["台北", 25.08, 121.47, 6],
        ["桃園", 24.99, 121.30, 6],
        ["新竹", 24.81, 120.97, 4],
        ["台中", 24.15, 120.67, 9],
        ["彰化", 24.08, 120.54, 3],
        ["南投", 23.96, 120.98, 3],
        ["雲林", 23.71, 120.43, 3],
        ["嘉義", 23.48, 120.45, 2],
        ["台南", 23.00, 120.22, 8],
        ["高雄", 22.63, 120.30, 9],
        ["屏東", 22.55, 120.55, 4],
        ["宜蘭", 24.70, 121.74, 2],
        ["花蓮", 23.99, 121.60, 2],
        ["台東", 22.76, 121.14, 2],
        ["基隆", 25.13, 121.74, 1],
        ["澎湖", 23.57, 119.58, 1],
        ["金門", 24.43, 118.32, 1]
    ];

    const VIDEO_DEMO_CATEGORY_QUEUE = [
        ...Array(24).fill("traffic"),
        ...Array(9).fill("disaster"),
        ...Array(13).fill("activity"),
        ...Array(5).fill("fire"),
        ...Array(6).fill("criminal"),
        ...Array(9).fill("other")
    ];

    const VIDEO_DEMO_TEMPLATES = {
        traffic: [
            ["道路施工改道", "路面刨鋪施工占用外側車道，現場改道並出現短暫回堵。"],
            ["車禍回堵", "路口發生追撞事故，拖吊與警察處理中，車流回堵。"],
            ["號誌故障", "主要路口號誌故障，警察到場指揮，請改走替代道路。"],
            ["匝道車多", "交流道匝道車多，排隊回堵至平面道路。"]
        ],
        disaster: [
            ["豪雨積水", "午後強降雨造成低窪道路積水，車輛通行速度降低。"],
            ["邊坡落石", "山區道路邊坡落石，公路單位到場清理並實施管制。"],
            ["強風影響", "沿海強風影響機車與大型車通行，部分路段啟動警戒。"]
        ],
        activity: [
            ["大型活動人潮", "場館周邊活動散場人潮增加，接駁與公車站排隊。"],
            ["路跑交通管制", "清晨路跑活動進行，沿線道路分段管制。"],
            ["展覽入場尖峰", "展覽入場尖峰造成周邊停車場滿位與人潮聚集。"]
        ],
        fire: [
            ["建物火警", "消防車輛到場灌救，周邊道路暫時封閉。"],
            ["店面火警", "商圈店面火警已通報消防，現場進行交通管制。"]
        ],
        criminal: [
            ["公共安全警戒", "警方處理突發公共安全事件，周邊人車動線調整。"],
            ["可疑物排除", "車站周邊發現可疑物，警察封鎖局部區域排除中。"]
        ],
        other: [
            ["停電影響號誌", "區域停電造成部分路口號誌異常，台電搶修中。"],
            ["停水搶修", "自來水管線破裂，工程單位搶修並影響部分道路。"],
            ["公共設施異常", "天橋電梯與周邊設施異常，維修人員到場處理。"]
        ]
    };

    function buildVideoDemoRegionalEvents() {
        const events = [];
        let globalIndex = 0;
        VIDEO_DEMO_REGION_GROUPS.forEach(([city, baseLat, baseLng, count]) => {
            for (let i = 0; i < count; i += 1) {
                const category = VIDEO_DEMO_CATEGORY_QUEUE[globalIndex % VIDEO_DEMO_CATEGORY_QUEUE.length];
                const templates = VIDEO_DEMO_TEMPLATES[category] || VIDEO_DEMO_TEMPLATES.other;
                const [label, content] = templates[(globalIndex + i) % templates.length];
                const latOffset = ((i % 3) - 1) * 0.032 + Math.floor(i / 3) * 0.018;
                const lngOffset = (((i + 1) % 3) - 1) * 0.038 - Math.floor(i / 4) * 0.016;
                const source = category === "traffic" ? "TDX CMS" : (category === "activity" ? "RSS" : "news");
                events.push({
                    id: `video-demo-${String(globalIndex + 1).padStart(2, "0")}`,
                    title: `${city}${String(globalIndex + 1).padStart(2, "0")} ${label}`,
                    category,
                    city,
                    lat: Number((baseLat + latOffset).toFixed(5)),
                    lng: Number((baseLng + lngOffset).toFixed(5)),
                    source,
                    content: `${city}${String(globalIndex + 1).padStart(2, "0")} ${content}`,
                    impact: category === "activity" ? "人潮與周邊交通受到影響" : "周邊通行與生活動線受到影響",
                    advice: category === "traffic" ? "行經此區請提前改道" : "請查看位置並避開影響範圍",
                    locationPrecision: "exact",
                    locationSource: "demo",
                    locationConfidence: 0.88 + ((globalIndex % 8) * 0.01),
                    locationQuality: "high",
                    locationDisplayMode: "point",
                    updatedAt: `2026-07-12T09:${String(59 - (globalIndex % 50)).padStart(2, "0")}:00+08:00`,
                    publishedAt: `2026-07-12T09:${String(42 - (globalIndex % 40)).padStart(2, "0")}:00+08:00`,
                    url: `https://demo.island-pulse.local/event-${globalIndex + 1}`
                });
                globalIndex += 1;
            }
        });
        return events;
    }

    const VIDEO_DEMO_EVENTS = [
        ...VIDEO_DEMO_CORE_EVENTS,
        ...VIDEO_DEMO_NEARBY_EVENTS,
        ...buildVideoDemoRegionalEvents()
    ].slice(0, 76);
    if (VIDEO_DEMO_ROUTE) window.VIDEO_DEMO_EVENTS = VIDEO_DEMO_EVENTS;

    const ALERT_COLOR_MAP = {
        traffic:  { color: "#2471A3", glow: "rgba(36, 113, 163, 0.45)" },
        fire:     { color: "#D35400", glow: "rgba(211, 84, 0, 0.42)" },
        arson:    { color: "#C0392B", glow: "rgba(192, 57, 43, 0.45)" },
        disaster: { color: "#C0392B", glow: "rgba(192, 57, 43, 0.4)" },
    };

    function getEventAlertType(ev) {
        const text = [ev?.title, ev?.content].map(value => safeText(value)).join(" ");
        if (/縱火|放火|蓄意放火/.test(text)) return "arson";
        if (/火災|火警|爆炸|氣爆|失火|燃燒|起火/.test(text)) return "fire";
        if (ev.category === "traffic") return "traffic";
        if (ev.category === "disaster") return "disaster";
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

    function resolveMarkerStyle(ev, fallbackColor) {
        const visual = getCategoryVisual(inferEventGroupCategory(ev));
        const color = visual?.color || fallbackColor || "#64748B";
        const meta = visual?.meta || CAT_META.other;
        const severity = getEventSeverity(ev);
        const glow = severity >= 4 ? `rgba(${meta.rgba},0.62)` : severity >= 2 ? `rgba(${meta.rgba},0.38)` : `rgba(${meta.rgba},0.18)`;
        return { color, glow };
    }

    const CAT_META = {
        traffic:  { rgba: "47,128,237", tint: "#93C5FD", cssVar: "--cat-traffic" },
        disaster: { rgba: "192,57,43", tint: "#E8856A", cssVar: "--cat-disaster" },
        accident: { rgba: "249,115,22", tint: "#FDBA74", cssVar: "--cat-accident" },
        activity: { rgba: "34,197,94", tint: "#86EFAC", cssVar: "--cat-activity" },
        other:    { rgba: "100,116,139", tint: "#CBD5E1", cssVar: "--cat-other" },
        criminal: { rgba: "249,115,22", tint: "#FDBA74", cssVar: "--cat-accident" },
        medical:  { rgba: "249,115,22", tint: "#FDBA74", cssVar: "--cat-accident" },
        construction: { rgba: "47,128,237", tint: "#93C5FD", cssVar: "--cat-traffic" }
    };

    const LOC_PIN_SVG = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0112 2a8 8 0 018 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg>`;

    const REACT_SVG = {
        muyu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="10" rx="7" ry="6"/><path d="M8 16c0 2.2 1.8 4 4 4s4-1.8 4-4"/><line x1="12" y1="4" x2="12" y2="2"/></svg>`,
        candle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><path d="M8 10c0-2.2 1.8-4 4-4s4 1.8 4 4v8a4 4 0 01-8 0v-8z"/><line x1="10" y1="22" x2="14" y2="22"/></svg>`,
    };

    function getEventCategoryText(ev) {
        if (!ev || typeof ev !== "object") return "";
        return [ev.title, ev.summary, ev.content, ev.text, ev.location, ev.city, ev.source]
            .map(value => safeText(value))
            .join(" ")
            .toLowerCase();
    }

    function shouldShowRealtimeEvent(ev) {
        if (ev?.source === "user_submission") return true;
        const filter = window.TNM_EVENT_CONTENT_FILTER;
        if (!filter || typeof filter.shouldShowEvent !== "function") return true;
        return filter.shouldShowEvent(ev);
    }

    function inferEventGroupCategory(ev) {
        if (String(ev || "").toLowerCase() === "all") return "all";
        if (ev && typeof eventDisplay.resolveGroupCategory === "function") {
            const shared = eventDisplay.resolveGroupCategory(ev);
            if (shared !== "other" && ["traffic", "disaster", "accident", "activity"].includes(shared)) return shared;
        }
        const raw = normalizeText(typeof ev === "string" ? ev : (ev?.category || ev?.groupCategory || ev?.type || "other")).toLowerCase();
        const mapConfig = CATEGORY_MAP.normal || {};
        const mapped = mapConfig[raw] || raw || "other";
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

    function normalizeDisplayEvent(ev) {
        const normalizedTextEvent = normalizeEventTextFields(ev);
        const originalCategory = normalizeText(normalizedTextEvent.category || normalizedTextEvent.type || "other").toLowerCase();
        const groupCategory = inferEventGroupCategory({ ...normalizedTextEvent, category: originalCategory });
        return {
            ...normalizedTextEvent,
            originalCategory,
            category: groupCategory,
            groupCategory,
            displayCategory: getCategoryVisual(groupCategory)?.text || "其他"
        };
    }

    function getCategoryVisual(category) {
        const isOnline = currentMapMode === "online";
        const config = isOnline ? TW_ONLINE_CATEGORIES : CATEGORY_CONFIG;
        const mappedCat = inferEventGroupCategory(category);
        const c = config[mappedCat] || config.other;
        const meta = CAT_META[mappedCat] || CAT_META.other;
        return { ...c, mappedCat, meta, color: c.color };
    }

    function shouldPinPulse(ev, severity) {
        return ev.category === "disaster" || severity >= 4 || getEventAlertType(ev) === "fire" || getEventAlertType(ev) === "arson";
    }

    function formatEventTime(ev) {
        if (typeof eventDisplay.formatEventTime === "function") return eventDisplay.formatEventTime(ev);
        const raw = ev.updatedAt || ev.publishedAt || ev.time || ev.createdAt;
        if (!raw) return "";
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return "";
        return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
    }

    function formatEventDateTime(value) {
        if (typeof eventDisplay.formatEventDateTime === "function") return eventDisplay.formatEventDateTime(value);
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
        if (typeof eventDisplay.formatEventDateRange === "function") return eventDisplay.formatEventDateRange(ev);
        const start = formatEventDateTime(ev.startsAt || ev.startAt);
        const end = formatEventDateTime(ev.endsAt || ev.endAt);
        if (start && end && start !== end) return `${start} - ${end}`;
        return start || end || "";
    }

    function parseFutureActivityDate(ev) {
        const raw = ev.startsAt || ev.startAt || "";
        const direct = raw ? new Date(raw) : null;
        if (direct && !Number.isNaN(direct.getTime())) return direct;
        const text = getEventText(ev);
        const match = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|號)/);
        if (!match) return null;
        const now = new Date();
        const candidate = new Date(now.getFullYear(), Number(match[1]) - 1, Number(match[2]), 0, 0, 0);
        if (candidate.getTime() + 24 * 60 * 60 * 1000 < now.getTime()) {
            candidate.setFullYear(candidate.getFullYear() + 1);
        }
        return candidate;
    }

    function isFutureActivity(ev) {
        if (typeof eventDisplay.isFutureActivity === "function") return eventDisplay.isFutureActivity(ev);
        if (inferEventGroupCategory(ev) !== "activity") return false;
        const d = parseFutureActivityDate(ev);
        return Boolean(d && d.getTime() > Date.now() + 6 * 60 * 60 * 1000);
    }

    function getEventSortWeight(ev) {
        if (isFutureActivity(ev)) return 20;
        const category = inferEventGroupCategory(ev);
        if (category === "disaster" || category === "accident" || category === "traffic") return 0;
        if (category === "activity") return 10;
        return 5;
    }

    function getEventLocationSortWeight(ev) {
        const quality = getLocationQuality(ev);
        const displayMode = getLocationDisplayMode(ev);
        const precision = normalizeText(ev.locationPrecision || "").toLowerCase();
        if (quality === "high" && displayMode === "point") return 0;
        if (quality === "medium" || displayMode === "estimated" || precision === "district") return 1;
        return 2;
    }

    function getEventSourceSortWeight(ev) {
        const source = normalizeSource(ev.sourceName || ev.source || "");
        if (source === "TDX CMS") return 0;
        if (source === "RSS" || source === "news") return 1;
        return 1;
    }

    function getEventText(ev) {
        return [ev.title, ev.content, ev.summary, ev.location, ev.address, ev.impact, ev.advice]
            .map(value => safeText(value))
            .join(" ");
    }

    function getEventStatusLabel(ev) {
        if (typeof eventDisplay.getEventStatusLabel === "function") return eventDisplay.getEventStatusLabel(ev);
        const text = getEventText(ev);
        const raw = normalizeText(ev.status || "").toLowerCase();
        if (isFutureActivity(ev) || raw === "upcoming") return "未來活動";
        if (raw === "cleared" || raw === "resolved" || /已解除|恢復通行|搶修完成|解除|恢復供電|恢復正常/.test(text)) return "已解除";
        if (/管制|封閉|中斷|停駛|停班停課|施工中|搶修中|處理中/.test(text)) return "影響中";
        if (/注意|提醒|預警|可能|預計|將於/.test(text)) return "注意";
        return "待確認";
    }

    function getEventAdviceLabel(ev) {
        if (typeof eventDisplay.getEventAdviceLabel === "function") return eventDisplay.getEventAdviceLabel(ev);
        const text = getEventText(ev);
        const category = inferEventGroupCategory(ev);
        const status = getEventStatusLabel(ev);
        if (category === "activity") return /管制|人潮|路跑|賽事|封街|演唱會|展覽|活動/.test(text) ? "前往前確認時間、交通與入場資訊" : "前往前確認時間與地點";
        if (ev.advice) return normalizeText(ev.advice);
        if (status === "已解除") return "可通行，仍請留意現場狀況";
        if (/封閉|中斷|禁止通行|停駛|停班停課|土石流|落石|淹水|坍方/.test(text)) return "避開";
        if (/管制|壅塞|回堵|車多|施工|改道|事故|車禍|追撞|擦撞/.test(text) || category === "traffic") return "改道或提早出門";
        if (category === "disaster" || /豪雨|地震|颱風|強風|火災|火警|爆炸/.test(text)) return "避免靠近";
        return "注意";
    }

    function getEventImpactTags(ev) {
        if (typeof eventDisplay.getEventImpactTags === "function") return eventDisplay.getEventImpactTags(ev);
        const text = getEventText(ev);
        const category = inferEventGroupCategory(ev);
        const tags = [];
        const add = (label) => { if (!tags.includes(label)) tags.push(label); };
        if (category === "traffic" || /塞車|壅塞|回堵|車多|車禍|事故|施工|管制|封閉|改道|交流道|國道|省道|道路/.test(text)) add("交通");
        if (/噪音|施工|工地|演唱會|活動/.test(text)) add("噪音");
        if (/人潮|市集|展覽|賽事|路跑|演唱會|活動/.test(text) || category === "activity") add("人潮");
        if (/停水|停電|水管|供電|瓦斯|搶修/.test(text)) add("停水停電");
        if (category === "disaster" || /災害|地震|颱風|豪雨|淹水|落石|火災|爆炸|刑案|攻擊|搶劫/.test(text)) add("安全");
        return tags.length ? tags.slice(0, 3) : ["生活影響待確認"];
    }

    function makeEventImpactRow(ev) {
        const advice = getEventAdviceLabel(ev);
        const status = getEventStatusLabel(ev);
        const tags = getEventImpactTags(ev);
        return `<div class="event-impact-row" aria-label="事件影響與建議">
            <span class="event-advice-chip"><i class="fa-solid fa-route"></i>${escapeHtml(advice)}</span>
            <span class="event-impact-chip"><i class="fa-solid fa-signal"></i>${escapeHtml(status)}</span>
            ${tags.map(tag => `<span class="event-impact-chip">${escapeHtml(tag)}</span>`).join("")}
        </div>`;
    }

    function getLocationPrecisionLabel(ev) {
        if (typeof eventDisplay.getLocationPrecisionLabel === "function") return eventDisplay.getLocationPrecisionLabel(ev);
        const precision = normalizeText(ev.locationPrecision || "").toLowerCase();
        const displayMode = getLocationDisplayMode(ev);
        const quality = getLocationQuality(ev);
        if (displayMode === "list_only" || quality === "low") return "定位待確認";
        if (displayMode === "estimated" || quality === "medium") {
            if (precision === "district") return "區域估算";
            if (precision === "city") return "縣市估算";
            return "地點估算";
        }
        if (precision === "exact") return "精準地點";
        if (precision === "district") return "區域估算";
        if (precision === "city") return "縣市估算";
        return "";
    }

    function getLocationQuality(ev) {
        if (typeof eventDisplay.getLocationQuality === "function") return eventDisplay.getLocationQuality(ev);
        const explicit = normalizeText(ev.locationQuality || "").toLowerCase();
        if (["high", "medium", "low"].includes(explicit)) return explicit;
        const confidence = Number(ev.locationConfidence);
        if (Number.isFinite(confidence)) {
            if (confidence >= 0.8) return "high";
            if (confidence >= 0.55) return "medium";
            return "low";
        }
        const precision = normalizeText(ev.locationPrecision || "").toLowerCase();
        if (precision === "exact") return "medium";
        if (precision === "district") return "medium";
        return "low";
    }

    function getLocationDisplayMode(ev) {
        if (typeof eventDisplay.getLocationDisplayMode === "function") return eventDisplay.getLocationDisplayMode(ev);
        const explicit = normalizeText(ev.locationDisplayMode || "").toLowerCase();
        if (["point", "estimated", "list_only"].includes(explicit)) return explicit;
        const quality = getLocationQuality(ev);
        const precision = normalizeText(ev.locationPrecision || "").toLowerCase();
        if (quality === "high") return "point";
        if (quality === "medium" && precision !== "unknown") return "estimated";
        return "list_only";
    }

    function shouldRenderLocationMarker(ev) {
        return shouldRenderMapLocationMarker(ev, {
            getLocationQuality,
            getLocationDisplayMode
        });
    }

    function getLocationConfidenceLabel(ev) {
        if (typeof eventDisplay.getLocationConfidenceLabel === "function") return eventDisplay.getLocationConfidenceLabel(ev);
        const confidence = Number(ev.locationConfidence);
        return Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : "";
    }

    function makeLocationPrecisionTag(ev, className = "event-impact-chip") {
        const label = getLocationPrecisionLabel(ev);
        if (!label) return "";
        const confidence = getLocationConfidenceLabel(ev);
        const evidence = normalizeText(ev.locationEvidence || ev.locationReason || ev.locationQuery || "");
        const title = ["事件定位可信度", confidence, evidence].filter(Boolean).join("｜");
        return `<span class="${escapeAttribute(className)}" title="${escapeAttribute(title)}">${escapeHtml(label)}${confidence ? ` ${escapeHtml(confidence)}` : ""}</span>`;
    }

    function getReviewStateLabel(ev) {
        if (typeof eventDisplay.getReviewStateLabel === "function") return eventDisplay.getReviewStateLabel(ev);
        const state = normalizeText(ev.reviewState || "").toLowerCase();
        const verified = normalizeText(ev.verifiedStatus || "").toLowerCase();
        if (state === "reviewed" || verified === "verified") return "人工覆核";
        if (state === "pending_review") return "待覆核";
        if (state === "merged") return "已合併";
        if (verified === "resolved") return "已解除覆核";
        return "未覆核";
    }

    function getSourceTraceLabel(ev) {
        if (typeof eventDisplay.getSourceTraceLabel === "function") return eventDisplay.getSourceTraceLabel(ev);
        const count = Array.isArray(ev.sourceTrace) ? ev.sourceTrace.length : 0;
        const source = normalizeText(ev.sourceName || ev.source || "資料來源");
        return count > 1 ? `${source} 等 ${count} 筆來源` : source;
    }

    function makeEventDetailRows(ev, context = "card") {
        const rows = [];
        if (ev?.source === "user_submission") {
            const eventTime = formatEventDateRange(ev) || formatEventDateTime(ev.startsAt || ev.createdAt);
            const submissionRows = [
                ["\u6d3b\u52d5\u6642\u9593", eventTime || "\u672a\u63d0\u4f9b"],
                ["\u5730\u5740", normalizeText(ev.address) || "\u672a\u63d0\u4f9b"],
                ["\u6700\u5f8c\u66f4\u65b0", formatEventDateTime(ev.updatedAt) || "\u672a\u63d0\u4f9b"],
            ];
            return `<div class="event-detail-list event-detail-list--${escapeAttribute(context)}">${submissionRows.map(([label, value]) => `<div class="event-detail-item"><span class="event-detail-label">${escapeHtml(label)}</span><span class="event-detail-value">${escapeHtml(value)}</span></div>`).join("")}</div>`;
        }
        const isActivity = inferEventGroupCategory(ev) === "activity" || ev.category === "activity";
        const timeRange = formatEventDateRange(ev);
        const place = normalizeText([ev.venue, ev.address || ev.location].filter(Boolean).join("｜"));
        const area = [ev.city, ev.district].map(value => safeText(value)).join(" ");

        if (isActivity && timeRange) rows.push(["時間", timeRange]);
        if (place) rows.push([isActivity ? "場地" : "地點", place]);
        else if (area) rows.push(["地區", area]);
        rows.push(["狀態", getEventStatusLabel(ev)]);
        rows.push(["定位", [getLocationPrecisionLabel(ev), getLocationConfidenceLabel(ev)].filter(Boolean).join(" ") || "待確認"]);
        rows.push(["資料", `${getSourceTraceLabel(ev)}｜${getReviewStateLabel(ev)}`]);
        if (ev.updatedAt || ev.lastVerifiedAt) rows.push(["更新", formatEventDateTime(ev.lastVerifiedAt || ev.updatedAt)]);
        rows.push(["建議", getEventAdviceLabel(ev)]);
        if (ev.impact) rows.push(["影響", ev.impact]);

        if (!rows.length) return "";
        const maxRows = context === "popup" ? 5 : context === "mobile-card" ? 2 : 4;
        return `<div class="event-detail-list event-detail-list--${escapeAttribute(context)}">
            ${rows.slice(0, maxRows).map(([label, value]) => `
                <div class="event-detail-item">
                    <span class="event-detail-label">${escapeHtml(label)}</span>
                    <span class="event-detail-value">${escapeHtml(value)}</span>
                </div>`).join("")}
        </div>`;
    }

    function makeCatBadgeV2(category) {
        const { text, meta, mappedCat } = getCategoryVisual(category);
        const svg = CAT_SVG[category] || CAT_SVG[mappedCat] || CAT_SVG.other;
        return `<span class="cat-badge-v2" style="background:rgba(${meta.rgba},0.15);border:1px solid rgba(${meta.rgba},0.3);color:${meta.tint};"><span class="badge-svg-icon">${svg}</span>${escapeHtml(text)}</span>`;
    }

    function makeSrcBadgeV2(source) {
        const normalized = normalizeSource(source);
        const c = SOURCE_CONFIG[normalized] || SOURCE_CONFIG.default;
        const t = c.shortText || c.text;
        return `<span class="src-badge-v2" style="background:${c.bg};color:${c.color};border:1px solid ${c.color}33;">${escapeHtml(t)}</span>`;
    }

    function makeReactionBarHtml(eventId, data, reacted, compact = false) {
        const isOnline = currentMapMode === "online";
        const muyuActive = reacted === "muyu";
        const candleActive = reacted === "candle";
        const compactCls = compact ? " react-btn--compact" : "";
        const safeEventId = escapeAttribute(eventId);
        const muyuValue = Number(data.muyu) || 0;
        const candleValue = Number(data.candle) || 0;
        const muyuCount = muyuActive ? `✓ ${muyuValue}` : String(muyuValue);
        const candleCount = candleActive ? `✓ ${candleValue}` : String(candleValue);
        const total = muyuValue + candleValue;
        const totalLabel = reacted ? "已回應" : `${total.toLocaleString()} 人回應`;

        return `
            <div class="reaction-bar" data-event-id="${safeEventId}">
                <button type="button" class="react-btn muyu${muyuActive ? " active" : ""}${compactCls}"
                    data-action="react"
                    data-event-id="${safeEventId}"
                    data-react-type="muyu"
                    ${reacted && !muyuActive ? "disabled" : ""}>
                    ${REACT_SVG.muyu}
                    <span>${isOnline ? "致敬" : "敲木魚"}</span>
                    <span class="react-count">${escapeHtml(muyuCount)}</span>
                </button>
                <div class="react-divider"></div>
                <button type="button" class="react-btn candle${candleActive ? " active candle-lit" : ""}${compactCls}"
                    data-action="react"
                    data-event-id="${safeEventId}"
                    data-react-type="candle"
                    ${reacted && !candleActive ? "disabled" : ""}>
                    ${REACT_SVG.candle}
                    <span>${isOnline ? "悼念" : "點蠟燭"}</span>
                    <span class="react-count">${escapeHtml(candleCount)}</span>
                </button>
                <span class="react-total">${escapeHtml(totalLabel)}</span>
            </div>`;
    }

    function getEventReportCount(ev) {
        if (!ev || !ev.id) return 0;
        return Number(reportSummaryByEvent[String(ev.id)] || 0);
    }

    function findReportEvent(identifier) {
        const key = String(identifier || "");
        return parsedEvents.find(ev => String(ev.id) === key)
            || parsedEvents.find(ev => String(ev.title || ev.twOnlineTitle || "") === key)
            || null;
    }

    async function syncReportSummary() {
        try {
            const response = await fetch("/api/report", { cache: "no-store" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            reportSummaryByEvent = data && data.byEvent && typeof data.byEvent === "object" ? data.byEvent : {};
        } catch (error) {
            console.warn("report summary sync failed", error);
            reportSummaryByEvent = {};
        }
    }

    function buildReportSnapshot(ev) {
        if (!ev) return null;
        return {
            id: ev.id,
            title: ev.title || "",
            content: ev.content || ev.summary || "",
            city: ev.city || "",
            category: ev.category || "",
            lat: ev.lat ?? null,
            lng: ev.lng ?? null,
            source: ev.source || "",
            sourceName: ev.sourceName || ev.source || "",
            sourceUrl: ev.sourceUrl || ev.url || "",
            url: ev.url || ev.sourceUrl || "",
            publishedAt: ev.publishedAt || ev.time || "",
            updatedAt: ev.updatedAt || ""
        };
    }

    function buildPopupHtml(ev, displayTitle, displayContent, markerStyle) {
        const city = ev.city || "未知城市";
        const eventIdAttr = escapeAttribute(ev.id || "");
        const sourceUrl = sanitizeExternalUrl(ev.url);
        const sourceUrlAttr = escapeAttribute(sourceUrl);
        const preview = getCardPreview(ev);
        const timeStr = preview.relativeTime;
        const timeHtml = timeStr ? `<span class="popup-location-tag">${escapeHtml(timeStr)}</span>` : "";
        const reactionSlot = isMourningEvent(ev)
            ? `<div class="popup-reactions-wrap reaction-container" data-event-id="${eventIdAttr}"></div>`
            : "";
        const reportArg = escapeAttribute(encodeURIComponent(ev.id || displayTitle));
        const reportTitleArg = escapeAttribute(encodeURIComponent(ev.title || displayTitle));
        const reportCount = getEventReportCount(ev);
        const reportTag = reportCount ? `<span class="popup-location-tag">已有 ${reportCount} 筆回報</span>` : "";
        const alertZoneTags = makeAlertZoneBadges(ev, "popup-location-tag");
        const locationNote = getLocationPresentation(ev);
        const impactHtml = makeEventImpactRow(ev);
        const detailsHtml = makeEventDetailRows(ev, "popup");
        const trustHtml = dataTrust.buildTrustRow(ev, { reportCount, compact: true });
        const submissionNotice = ev.source === "user_submission"
            ? `<div class="submission-notice">${escapeHtml(ev.publicationNotice || "\u4f7f\u7528\u8005\u6295\u7a3f\uff5c\u5c1a\u672a\u7d93\u5b98\u65b9\u8b49\u5be6")}</div>` : "";

        return `
            <div class="popup-demo-inner" style="--popup-color:${markerStyle.color}">
                <div class="popup-header">
                    <div>
                        <div class="popup-header-meta">
                            ${makeCatBadgeV2(ev.category)}
                            <span class="popup-location-tag">${escapeHtml(city)}</span>
                            ${makeLocationPrecisionTag(ev, "popup-location-tag")}
                            ${timeHtml}
                            ${reportTag}
                            ${alertZoneTags}
                        </div>
                        <div class="popup-title-v2">${escapeHtml(displayTitle)}</div>
                    </div>
                </div>
                <div class="popup-summary">${escapeHtml(displayContent)}</div>
                <div class="popup-location-note">${escapeHtml(locationNote.description)}</div>
                ${submissionNotice}
                ${impactHtml}
                ${detailsHtml}
                ${trustHtml}
                ${reactionSlot}
                <div class="popup-footer">
                    ${sourceUrl ? `<a href="${sourceUrlAttr}" target="_blank" rel="noreferrer" class="popup-btn-v2 primary">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        查看原文
                    </a>` : ""}
                    <button type="button" class="popup-btn-v2 ghost" data-action="${ev.source === "user_submission" ? "report-submission" : "open-report"}" data-submission-id="${escapeAttribute(ev.submissionId || "")}" data-report="${reportArg}" data-report-title="${reportTitleArg}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                        回報錯誤
                    </button>
                </div>
            </div>`;
    }

    function buildEventCardHtml(ev, displayTitle, displayContent, catVisual) {
        const city = normalizeText(ev.city) || "未知城市";
        const eventIdAttr = escapeAttribute(ev.id || "");
        const sourceUrl = sanitizeExternalUrl(ev.url);
        const sourceUrlAttr = escapeAttribute(sourceUrl);
        const preview = getCardPreview(ev);
        const timeStr = preview.relativeTime;
        const timeHtml = timeStr ? `<span class="time-tag">${escapeHtml(timeStr)}</span>` : "";
        const isMobile = isMobileViewport();
        const upcomingTag = isFutureActivity(ev) ? `<span class="time-tag upcoming-tag">未來活動</span>` : "";
        const sourceEntries = Array.isArray(ev.sources) ? ev.sources : (Array.isArray(ev.sourceTrace) ? ev.sourceTrace : []);
        const sourceLinksHtml = sourceEntries.map((source) => {
            const url = sanitizeExternalUrl(source?.url || source?.sourceUrl);
            if (!url) return "";
            const outlet = source?.outlet || source?.source || source?.sourceName || source?.name || "來源";
            const title = source?.title || source?.text || "";
            return `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${escapeHtml(outlet)}：${escapeHtml(title)}</a>`;
        }).filter(Boolean).join("");
        const sourcesHtml = sourceLinksHtml ? `
            <button type="button" class="card-sources-toggle" data-action="toggle-sources">
                <i class="fa-solid fa-newspaper"></i> ${sourceEntries.length} 家報導 <i class="fa-solid fa-chevron-down"></i>
            </button>
            <div class="card-sources-list">
                ${sourceLinksHtml}
            </div>` : "";
        const reactionSlot = isMourningEvent(ev)
            ? `<div class="card-v2-extra"><div class="reaction-container" data-event-id="${eventIdAttr}"></div></div>`
            : "";
        const reportArg = escapeAttribute(encodeURIComponent(ev.id || displayTitle));
        const reportTitleArg = escapeAttribute(encodeURIComponent(ev.title || displayTitle));
        const reportCount = getEventReportCount(ev);
        const reportTag = reportCount ? `<span class="time-tag report-count-tag">已有 ${reportCount} 筆回報</span>` : "";
        const alertZoneTags = makeAlertZoneBadges(ev, "time-tag");
        const impactHtml = !isMobile && ["traffic", "accident", "disaster"].includes(inferEventGroupCategory(ev)) ? makeEventImpactRow(ev) : "";
        const submissionNotice = ev.source === "user_submission"
            ? `<div class="submission-notice">${escapeHtml(ev.publicationNotice || "\u4f7f\u7528\u8005\u6295\u7a3f\uff5c\u5c1a\u672a\u7d93\u5b98\u65b9\u8b49\u5be6")}</div>` : "";

        return `
            <div class="card-bar" style="background:${catVisual.color};"></div>
            <div class="card-v2-left">
                <div class="card-v2-meta">
                    <span class="city-tag">${LOC_PIN_SVG}${escapeHtml(city)}</span>
                    ${makeLocationPrecisionTag(ev, "time-tag")}
                    ${makeCatBadgeV2(ev.category)}
                    ${upcomingTag}
                    ${timeHtml}
                    ${reportTag}
                    ${alertZoneTags}
                </div>
                <div class="card-v2-title">${escapeHtml(displayTitle)}</div>
                <div class="card-v2-content">${escapeHtml(preview.summary || displayContent)}</div>
                ${submissionNotice}
                ${impactHtml}
            </div>
            <div class="card-v2-right">${makeSrcBadgeV2(ev.source)}</div>
            ${reactionSlot}
            <div class="card-v2-extra card-footer">
                <span class="card-source-summary">${escapeHtml(preview.sourceSummary)}</span>${sourcesHtml}
                <div class="card-actions">
                    <div class="card-action-group">
                        <button type="button" class="card-action-btn" data-action="focus-event" data-event-id="${eventIdAttr}" aria-label="在地圖查看 ${escapeAttribute(displayTitle)}">在地圖查看</button>
                        <button type="button" class="card-action-btn report" data-action="${ev.source === "user_submission" ? "report-submission" : "open-report"}" data-submission-id="${escapeAttribute(ev.submissionId || "")}" data-report="${reportArg}" data-report-title="${reportTitleArg}" data-event-id="${eventIdAttr}">
                            <span style="display:inline-flex;width:11px;height:11px;align-items:center;margin-right:3px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></span>回報
                        </button>
                        ${sourceUrl ? `<a href="${sourceUrlAttr}" target="_blank" rel="noreferrer" class="card-action-btn link"><i class="fa-solid fa-arrow-up-right-from-square" style="margin-right:3px;font-size:10px"></i>查看事件</a>` : ""}
                    </div>
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
            all: "all", traffic: "traffic", road: "traffic", congestion: "traffic", jam: "traffic", construction: "traffic", roadwork: "traffic",
            accident: "accident", incident: "accident", safety: "accident", criminal: "accident", medical: "accident", fire: "accident", arson: "accident", publicsafety: "accident", "public-safety": "accident",
            disaster: "disaster", typhoon: "disaster", earthquake: "disaster", weather: "disaster", climate: "disaster",
            activity: "activity", event: "activity", market: "activity", exhibition: "activity", sports: "activity",
            other: "other"
        },
        online: {
            all: "all", traffic: "traffic", road: "traffic", congestion: "traffic", jam: "traffic", construction: "traffic", roadwork: "traffic",
            accident: "accident", incident: "accident", safety: "accident", criminal: "accident", medical: "accident", fire: "accident", arson: "accident", publicsafety: "accident", "public-safety": "accident",
            disaster: "disaster", typhoon: "disaster", earthquake: "disaster", weather: "disaster", climate: "disaster",
            activity: "activity", event: "activity", market: "activity", exhibition: "activity", sports: "activity",
            other: "other"
        }
    };

    const FIXED_CATEGORY_ORDER = ["all", "traffic", "disaster", "accident", "activity", "other"];

    const SOURCE_CONFIG = {
        "TDX CMS": { text:"TDX 即時路況", shortText:"TDX",  bg:"rgba(15,118,110,0.2)", color:"#5eead4" },
        RSS:        { text:"RSS 新聞事件", shortText:"RSS",  bg:"rgba(29,78,216,0.2)",  color:"#93c5fd" },
        user_submission: { text:"使用者投稿", shortText:"投稿", bg:"rgba(168,85,247,0.18)", color:"#d8b4fe" },
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
    let reportSummaryByEvent = {};
    let activeCategory = "all";
    let searchKeyword = "";
    let activeTimeRange = "24h";
    let showUpcomingEvents = false;
    let appliedMapBounds = null;
    let mapBoundsDirty = false;
    let suppressMapBoundsPrompt = false;
    let isTaiwanMode = true;
    let twGeoJSON = null;
    let activePopup = null;
    const renderedMarkers = [];
    const MOBILE_MARKER_LIMIT = 80;
    const MOBILE_CARD_LIMIT = 60;
    let mapResizeScheduled = false;

    function isMobileViewport() {
        return window.matchMedia("(max-width: 767px)").matches;
    }

    function debounce(fn, wait = 160) {
        let timer = null;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), wait);
        };
    }

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
        updateNearbyRadiusLayer();
    });

    map.on("moveend", () => {
        if (suppressMapBoundsPrompt) return;
        mapBoundsDirty = true;
        document.getElementById("search-map-area-btn")?.removeAttribute("hidden");
    });

    map.on('error', (e) => {
        if (e.error?.status === 401 || e.error?.status === 403) {
            console.warn('Mapbox token 失效，切換備用地圖');
            map.remove();
            fallbackToLeaflet();
        }
    });

    async function loadLeafletAssets() {
        if (window.L) return window.L;
        if (!document.querySelector('link[data-lazy-leaflet="css"]')) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
            link.dataset.lazyLeaflet = "css";
            document.head.appendChild(link);
        }
        await new Promise((resolve, reject) => {
            const existing = document.querySelector('script[data-lazy-leaflet="js"]');
            if (existing) {
                existing.addEventListener("load", resolve, { once: true });
                existing.addEventListener("error", reject, { once: true });
                return;
            }
            const script = document.createElement("script");
            script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
            script.dataset.lazyLeaflet = "js";
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
        return window.L;
    }

    async function fallbackToLeaflet() {
        const L = await loadLeafletAssets();
        const fallbackMap = L.map('map').setView([23.5, 121], 7);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(fallbackMap);
        window._fallbackMap = fallbackMap;
        // 把原本的 markers 重新打在 fallbackMap 上 (這部分需要額外邏輯，但先按照指示實作結構)
        if (parsedEvents.length) {
            parsedEvents.filter(shouldShowRealtimeEvent).filter(ev => shouldRenderLocationMarker(ev)).forEach(ev => {
                const latlng = [Number(ev.lat), Number(ev.lng)];
                if (Number.isFinite(latlng[0]) && Number.isFinite(latlng[1])) {
                    L.marker([latlng[0], latlng[1]]).addTo(fallbackMap)
                        .bindPopup(`<b>${escapeHtml(ev.title || "未命名事件")}</b><br>${escapeHtml(ev.content || "")}`);
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
    [reportModal, betaModal, settingsModal].filter(Boolean).forEach((modal) => {
        modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-hidden", "true");
        new MutationObserver(() => {
            modal.setAttribute("aria-hidden", modal.classList.contains("visible") ? "false" : "true");
        }).observe(modal, { attributes: true, attributeFilter: ["class"] });
    });
    const newsSidebar  = document.getElementById("news-sidebar");
    const mapStage     = document.getElementById("map-stage");
    const dataTrust = createDataTrustController({
        getEventStatusLabel,
        getLocationPrecisionLabel,
        getReviewStateLabel
    });

    let currentMapMode = VIDEO_DEMO_ROUTE ? "normal" : (localStorage.getItem("map_mode") || "normal");
    let isNearbyMode = false;
    let userLocation = null;
    let nearbyRadiusMeters = VIDEO_DEMO_ROUTE ? 3000 : Number(localStorage.getItem("nearby_radius") || 3000);
    let userLocationMarker = null;
    let alertZones = loadAlertZones();
    let alertZoneFilterEnabled = false;

    function applyMapMode(mode) {
        currentMapMode = mode;
        if (!VIDEO_DEMO_ROUTE) localStorage.setItem("map_mode", mode);
        document.body.classList.toggle("tw-online-mode", mode === "online");
        document.getElementById("map-mode-select").value = mode;

        const isOnline = mode === "online";
        const isCommute = mode === "commute";
        
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
        const textConfig = isOnline ? TW_ONLINE_TEXT : (isCommute ? {
            siteTitle: "出門前事件雷達",
            siteSubtitle: "COMMUTE CHECK",
            listTitle: "通行影響",
            searchPlaceholder: "搜尋路段、城市、施工、事故",
            emptyState: "目前沒有符合出門前條件的事件",
            loadingState: "正在讀取交通、事故、施工與災害資料...",
            statusPrefix: "出門前模式：只看交通、事故、施工、災害"
        } : {
            siteTitle: "島嶼脈搏",
            siteSubtitle: "台灣事件地圖",
            listTitle: "事件清單",
            searchPlaceholder: "搜尋標題、內容、城市",
            emptyState: "目前沒有符合條件的事件",
            loadingState: "正在抓取事件資料...",
            statusPrefix: "準備載入..."
        });

        document.querySelector(".brand-title").textContent = textConfig.siteTitle;
        document.querySelector(".brand-sub").textContent = textConfig.siteSubtitle;
        document.querySelector(".sidebar-title").textContent = textConfig.listTitle;
        ["event-search", "event-search-mobile"].forEach(id => {
            const searchInput = document.getElementById(id);
            if (searchInput) searchInput.placeholder = textConfig.searchPlaceholder;
        });
        
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
        updateNearbyRadiusLayer();
        scheduleMapResize();
    }
    function setStatus(t){
        if(statusText) statusText.textContent = t;
        const heroStatus = document.getElementById("hero-status-copy");
        if (heroStatus && (!heroStatus.textContent || heroStatus.textContent.includes("準備") || heroStatus.textContent.includes("載入"))) {
            heroStatus.textContent = t;
        }
    }
    function normalizeText(v){ return safeText(v).trim(); }
    function tryParseJson(t,fb){ try{ return t ? JSON.parse(t) : fb; }catch{ return fb; } }
    function flyToLatLng(latlng, zoom, duration=800){
        suppressMapBoundsPrompt = true;
        map.flyTo({ center:[latlng[1], latlng[0]], zoom, duration, essential:true });
        window.setTimeout(() => { suppressMapBoundsPrompt = false; }, Math.max(0, Number(duration) || 0) + 120);
    }
    function closeActivePopup(){
        if(activePopup){
            activePopup.remove();
            activePopup = null;
        }
    }
    function clearRenderedMarkers(){
        closeActivePopup();
        while(renderedMarkers.length) renderedMarkers.pop().marker.remove();
    }
    function updateCurationMeta(events){
        const cityValue = document.getElementById("city-filter")?.value || "all";
        const cityLabel = isNearbyMode ? `附近 ${formatRadiusLabel(nearbyRadiusMeters)}` : (alertZoneFilterEnabled ? "警戒區" : (cityValue === "all" ? "全台" : cityValue));
        const modeLabel = currentMapMode === "commute" ? "出門前" : (isTaiwanMode ? "台灣" : "統計");
        const categoryLabel = activeCategory === "all"
            ? "全部"
            : (getCategoryVisual(activeCategory)?.text || activeCategory);
        const cityCount = new Set(events.map(ev => normalizeText(ev.city)).filter(Boolean)).size;
        const categoryCount = new Set(events.map(ev => inferEventGroupCategory(ev)).filter(Boolean)).size;

        [
            ["sidebar-summary-count", String(events.length)],
            ["sidebar-mode-label", categoryLabel],
            ["sidebar-summary-city", cityLabel],
            ["hero-event-count", String(events.length)],
            ["hero-category-count", String(categoryCount)],
            ["hero-mode-copy", isNearbyMode ? "附近" : modeLabel],
            ["stats-hero-count", String(events.length)],
            ["stats-hero-mode", modeLabel]
        ].forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        });

        const heroStatus = document.getElementById("hero-status-copy");
        if (heroStatus) {
            heroStatus.textContent = currentMapMode === "commute"
                ? `出門前模式目前顯示 ${events.length} 筆交通、事故、施工與災害事件，涵蓋 ${cityCount} 個城市。`
                : `目前涵蓋 ${cityCount} 個城市、${categoryCount} 種事件類別，模式為${modeLabel}視角。`;
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
        const s = safeText(source).toLowerCase();
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
        if (mapResizeScheduled) return;
        mapResizeScheduled = true;
        const resizeNow = () => {
            mapResizeScheduled = false;
            if (map && typeof map.resize === "function") map.resize();
            if (window._fallbackMap && typeof window._fallbackMap.invalidateSize === "function") {
                window._fallbackMap.invalidateSize(true);
            }
        };
        requestAnimationFrame(resizeNow);
        setTimeout(() => {
            if (map && typeof map.resize === "function") map.resize();
            if (window._fallbackMap && typeof window._fallbackMap.invalidateSize === "function") {
                window._fallbackMap.invalidateSize(true);
            }
        }, 180);
    }

    function formatRadiusLabel(meters) {
        return meters >= 1000 ? `${Math.round(meters / 1000)} 公里` : `${meters} 公尺`;
    }

    function distanceMeters(aLat, aLng, bLat, bLng) {
        const toRad = (v) => v * Math.PI / 180;
        const r = 6371000;
        const dLat = toRad(bLat - aLat);
        const dLng = toRad(bLng - aLng);
        const s1 = Math.sin(dLat / 2);
        const s2 = Math.sin(dLng / 2);
        const h = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
        return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    function escapeHtml(value) {
        return escapeHtmlValue(value);
    }

    function enabledAlertZones() {
        return alertZones.filter(zone => zone.enabled);
    }

    function applyAlertZoneMatches(events) {
        const displayReadyEvents = (Array.isArray(events) ? events : []).map(ev => ({
            ...ev,
            locationQuality: ev.locationQuality || getLocationQuality(ev),
            locationDisplayMode: ev.locationDisplayMode || getLocationDisplayMode(ev)
        }));
        return attachAlertZoneMatches(displayReadyEvents, alertZones, distanceMeters);
    }

    function makeAlertZoneBadges(ev, className = "event-impact-chip") {
        const matches = Array.isArray(ev.alertZoneMatches) ? ev.alertZoneMatches.slice(0, 2) : [];
        if (!matches.length) return "";
        return matches.map(match => {
            const label = escapeHtml(match.label || match.typeLabel || "警戒區");
            const title = `${match.typeLabel || "警戒區"}，距離約 ${formatAlertZoneRadius(match.distanceMeters)}，半徑 ${formatAlertZoneRadius(match.radiusMeters)}`;
            return `<span class="${escapeAttribute(className)} alert-zone-badge" title="${escapeAttribute(title)}"><i class="fa-solid fa-bell"></i>${label}附近</span>`;
        }).join("");
    }

    function setAlertZoneStatus(type, message) {
        const status = document.getElementById("alert-zone-status");
        if (!status) return;
        status.className = `alert-zone-status${type ? ` ${type}` : ""}`;
        status.textContent = message || "";
    }

    function readAlertZoneForm() {
        const type = document.getElementById("alert-zone-type")?.value || "frequent";
        const radiusMeters = Number(document.getElementById("alert-zone-radius")?.value || 3000);
        const labelInput = document.getElementById("alert-zone-label");
        const label = normalizeText(labelInput?.value) || getAlertZoneTypeLabel(type);
        return { type, radiusMeters, label };
    }

    function updateAlertZoneLabelPlaceholder() {
        const type = document.getElementById("alert-zone-type")?.value || "frequent";
        const input = document.getElementById("alert-zone-label");
        if (!input) return;
        input.placeholder = `例如：${getAlertZoneTypeLabel(type)}、通勤路線`;
    }

    function renderAlertZoneSettings() {
        updateAlertZoneLabelPlaceholder();
        const list = document.getElementById("alert-zone-list");
        if (!list) return;
        if (!alertZones.length) {
            list.innerHTML = `<div class="alert-zone-empty">尚未設定警戒區。新增後，事件卡片會標示是否落在住家、公司或常走區域附近。</div>`;
            return;
        }
        list.innerHTML = alertZones.map(zone => {
            const label = escapeHtml(zone.label);
            const labelAttr = escapeAttribute(zone.label);
            const typeLabel = escapeHtml(getAlertZoneTypeLabel(zone.type));
            const zoneIdAttr = escapeAttribute(zone.id);
            const radiusOptions = ALERT_ZONE_RADII.map(radius => (
                `<option value="${radius}"${radius === zone.radiusMeters ? " selected" : ""}>${formatAlertZoneRadius(radius)}</option>`
            )).join("");
            return `
                <div class="alert-zone-item" data-zone-id="${zoneIdAttr}">
                    <div class="alert-zone-item-main">
                        <div class="alert-zone-item-title">
                            <span class="alert-zone-type-pill"><i class="fa-solid fa-shield-halved"></i>${typeLabel}</span>
                            <strong>${label}</strong>
                        </div>
                        <div class="alert-zone-item-meta">${Number(zone.lat).toFixed(4)}, ${Number(zone.lng).toFixed(4)} · ${formatAlertZoneRadius(zone.radiusMeters)}</div>
                        <div class="alert-zone-item-fields">
                            <input class="form-control" data-zone-label="${zoneIdAttr}" value="${labelAttr}" maxlength="24" aria-label="警戒區名稱">
                            <select class="form-control" data-zone-radius="${zoneIdAttr}" aria-label="警戒半徑">${radiusOptions}</select>
                        </div>
                    </div>
                    <div class="alert-zone-item-actions">
                        <label class="alert-zone-toggle">
                            <input type="checkbox" data-zone-toggle="${zoneIdAttr}"${zone.enabled ? " checked" : ""}>
                            啟用
                        </label>
                        <button type="button" class="alert-zone-delete" data-zone-delete="${zoneIdAttr}" aria-label="刪除 ${labelAttr}">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>`;
        }).join("");
    }

    function renderAlertZoneSummary(events = null) {
        const summary = document.getElementById("alert-zone-summary");
        const copy = document.getElementById("alert-zone-summary-copy");
        const toggle = document.getElementById("alert-zone-filter-toggle");
        if (!summary || !copy || !toggle) return;
        if (!alertZones.length) {
            alertZoneFilterEnabled = false;
            summary.hidden = true;
            toggle.classList.remove("active");
            toggle.setAttribute("aria-pressed", "false");
            return;
        }
        summary.hidden = false;
        const enabledCount = enabledAlertZones().length;
        if (!enabledCount) alertZoneFilterEnabled = false;
        const matchedCount = events ? countAlertZoneMatchedEvents(events) : countAlertZoneMatchedEvents(applyAlertZoneMatches(getFilteredEvents()));
        copy.textContent = enabledCount
            ? `${enabledCount} 個啟用，${matchedCount} 筆可見事件命中`
            : `${alertZones.length} 個已設定，全部停用中`;
        toggle.disabled = enabledCount === 0;
        toggle.classList.toggle("active", alertZoneFilterEnabled);
        toggle.setAttribute("aria-pressed", String(alertZoneFilterEnabled));
        toggle.textContent = alertZoneFilterEnabled ? "顯示全部" : "只看命中";
    }

    function persistAlertZones(nextZones, message = "") {
        alertZones = saveAlertZones(nextZones);
        if (!enabledAlertZones().length) alertZoneFilterEnabled = false;
        renderAlertZoneSettings();
        setAlertZoneStatus(message ? "success" : "", message);
        renderEvents();
    }

    function addAlertZoneFromLocation(location) {
        if (alertZones.length >= ALERT_ZONE_MAX_ITEMS) {
            setAlertZoneStatus("error", `最多可設定 ${ALERT_ZONE_MAX_ITEMS} 個警戒區。`);
            return;
        }
        const form = readAlertZoneForm();
        try {
            const zone = createAlertZone({
                ...form,
                lat: location.lat,
                lng: location.lng
            });
            const labelInput = document.getElementById("alert-zone-label");
            if (labelInput) labelInput.value = "";
            persistAlertZones([...alertZones, zone], `${zone.label} 已加入警戒區。`);
        } catch {
            setAlertZoneStatus("error", "目前位置無法建立警戒區。");
        }
    }

    function requestAlertZoneLocation() {
        if (userLocation) {
            addAlertZoneFromLocation(userLocation);
            return;
        }
        if (!navigator.geolocation) {
            setAlertZoneStatus("error", "此瀏覽器不支援定位，無法用目前位置新增。");
            return;
        }
        setAlertZoneStatus("", "正在取得目前位置...");
        navigator.geolocation.getCurrentPosition((pos) => {
            userLocation = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy
            };
            updateUserLocationMarker();
            flyToLatLng([userLocation.lat, userLocation.lng], 13, 800);
            addAlertZoneFromLocation(userLocation);
        }, (error) => {
            const msg = error.code === error.PERMISSION_DENIED
                ? "定位權限被拒絕，請允許瀏覽器定位後再新增。"
                : "無法取得目前位置，請稍後再試。";
            setAlertZoneStatus("error", msg);
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    }

    function handleAlertZoneListClick(event) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const deleteBtn = target?.closest("[data-zone-delete]");
        if (!deleteBtn) return;
        event.preventDefault();
        persistAlertZones(removeAlertZone(alertZones, deleteBtn.dataset.zoneDelete), "已刪除警戒區。");
    }

    function handleAlertZoneListChange(event) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target) return;
        const toggle = target.closest("[data-zone-toggle]");
        if (toggle instanceof HTMLInputElement) {
            persistAlertZones(updateAlertZone(alertZones, toggle.dataset.zoneToggle, { enabled: toggle.checked }), toggle.checked ? "已啟用警戒區。" : "已停用警戒區。");
            return;
        }
        const radius = target.closest("[data-zone-radius]");
        if (radius instanceof HTMLSelectElement) {
            persistAlertZones(updateAlertZone(alertZones, radius.dataset.zoneRadius, { radiusMeters: Number(radius.value) }), "已更新警戒半徑。");
            return;
        }
        const label = target.closest("[data-zone-label]");
        if (label instanceof HTMLInputElement) {
            const nextLabel = normalizeText(label.value);
            if (nextLabel) persistAlertZones(updateAlertZone(alertZones, label.dataset.zoneLabel, { label: nextLabel }), "已更新警戒區名稱。");
        }
    }

    function updateNearbyControls(count = null) {
        const label = isNearbyMode ? "查看全台" : "使用定位看附近";
        const status = document.getElementById("nearby-status");
        const radiusLabel = formatRadiusLabel(nearbyRadiusMeters);
        ["nearby-toggle-mobile", "nearby-toggle-desktop"].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.classList.toggle("active", isNearbyMode);
            btn.setAttribute("aria-pressed", String(isNearbyMode));
        });
        ["nearby-radius-mobile", "nearby-radius-desktop"].forEach(id => {
            const select = document.getElementById(id);
            if (select) select.value = String(nearbyRadiusMeters);
        });
        if (status) {
            status.textContent = isNearbyMode
                ? `附近範圍 ${radiusLabel}${count === null ? "" : `，目前 ${count} 件事件`}。位置只在本機用於距離計算。`
                : "位置只用於在本機計算附近事件，不會送到伺服器。";
        }
    }

    function setNearbyRadius(value) {
        const nextRadius = Number(value);
        if (!Number.isFinite(nextRadius) || nextRadius <= 0) return;
        nearbyRadiusMeters = nextRadius;
        if (!VIDEO_DEMO_ROUTE) localStorage.setItem("nearby_radius", String(nearbyRadiusMeters));
        updateNearbyControls();
        updateNearbyRadiusLayer();
        if (isNearbyMode) renderEvents();
    }

    const NEARBY_RADIUS_SOURCE_ID = "nearby-radius";
    const NEARBY_RADIUS_FILL_LAYER_ID = "nearby-radius-fill";
    const NEARBY_RADIUS_LINE_LAYER_ID = "nearby-radius-line";

    function canShowNearbyRadiusLayer() {
        return !VIDEO_DEMO_ROUTE
            && currentMapMode === "normal"
            && isNearbyMode
            && Number.isFinite(Number(userLocation?.lat))
            && Number.isFinite(Number(userLocation?.lng))
            && map
            && typeof map.isStyleLoaded === "function"
            && map.isStyleLoaded();
    }

    function ensureNearbyRadiusLayer() {
        if (!map || typeof map.isStyleLoaded !== "function" || !map.isStyleLoaded()) return false;
        if (!map.getSource(NEARBY_RADIUS_SOURCE_ID)) {
            map.addSource(NEARBY_RADIUS_SOURCE_ID, { type: "geojson", data: EMPTY_GEOJSON });
        }
        if (!map.getLayer(NEARBY_RADIUS_FILL_LAYER_ID)) {
            map.addLayer({
                id: NEARBY_RADIUS_FILL_LAYER_ID,
                type: "fill",
                source: NEARBY_RADIUS_SOURCE_ID,
                paint: { "fill-color": "#38bdf8", "fill-opacity": 0.1 }
            });
        }
        if (!map.getLayer(NEARBY_RADIUS_LINE_LAYER_ID)) {
            map.addLayer({
                id: NEARBY_RADIUS_LINE_LAYER_ID,
                type: "line",
                source: NEARBY_RADIUS_SOURCE_ID,
                paint: {
                    "line-color": "#60a5fa",
                    "line-opacity": 0.82,
                    "line-width": 2,
                    "line-dasharray": [2, 2]
                }
            });
        }
        return true;
    }

    function hideNearbyRadiusLayer() {
        if (!map || typeof map.isStyleLoaded !== "function" || !map.isStyleLoaded()) return;
        const source = map.getSource(NEARBY_RADIUS_SOURCE_ID);
        if (source && typeof source.setData === "function") source.setData(EMPTY_GEOJSON);
        [NEARBY_RADIUS_FILL_LAYER_ID, NEARBY_RADIUS_LINE_LAYER_ID].forEach(id => {
            if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
        });
    }

    function updateNearbyRadiusLayer() {
        if (!canShowNearbyRadiusLayer()) {
            hideNearbyRadiusLayer();
            return;
        }
        if (!ensureNearbyRadiusLayer()) return;
        const source = map.getSource(NEARBY_RADIUS_SOURCE_ID);
        if (source && typeof source.setData === "function") {
            source.setData(buildNearbyRadiusGeoJson(userLocation, nearbyRadiusMeters));
        }
        [NEARBY_RADIUS_FILL_LAYER_ID, NEARBY_RADIUS_LINE_LAYER_ID].forEach(id => {
            if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
        });
    }

    function updateUserLocationMarker() {
        if (!map || !userLocation || typeof mapboxgl === "undefined") return;
        if (!userLocationMarker) {
            const el = document.createElement("div");
            el.className = "user-location-dot";
            userLocationMarker = new mapboxgl.Marker({ element: el, anchor: "center" });
            enableSubpixelPositioning(userLocationMarker);
        }
        userLocationMarker.setLngLat([userLocation.lng, userLocation.lat]).addTo(map);
        updateNearbyRadiusLayer();
    }

    function clearUserLocationMarker() {
        if (userLocationMarker) {
            userLocationMarker.remove();
            userLocationMarker = null;
        }
        hideNearbyRadiusLayer();
    }

    function filterEventsByNearby(events) {
        if (!isNearbyMode || !userLocation) return events;
        return events
            .filter(ev => shouldRenderLocationMarker(ev))
            .map(ev => ({
                ...ev,
                distanceMeters: distanceMeters(userLocation.lat, userLocation.lng, Number(ev.lat), Number(ev.lng))
            }))
            .filter(ev => ev.distanceMeters <= nearbyRadiusMeters)
            .sort((a, b) => a.distanceMeters - b.distanceMeters);
    }

    function requestNearbyLocation() {
        if (isNearbyMode) {
            isNearbyMode = false;
            clearUserLocationMarker();
            hideNearbyRadiusLayer();
            renderEvents();
            setStatus("已切回全台事件");
            updateNearbyControls();
            return;
        }
        if (!navigator.geolocation) {
            setStatus("此瀏覽器不支援定位");
            const status = document.getElementById("nearby-status");
            if (status) status.textContent = "此瀏覽器不支援定位。你仍可用城市篩選查看事件。";
            return;
        }
        setStatus("正在取得定位...");
        const status = document.getElementById("nearby-status");
        if (status) status.textContent = "瀏覽器會詢問定位授權；位置只在本機計算附近事件。";
        navigator.geolocation.getCurrentPosition((pos) => {
            userLocation = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy
            };
            isNearbyMode = true;
            trackEvent("nearby_mode_enable", {});
            updateUserLocationMarker();
            updateNearbyRadiusLayer();
            flyToLatLng([userLocation.lat, userLocation.lng], 13, 800);
            renderEvents();
        }, (error) => {
            const msg = error.code === error.PERMISSION_DENIED
                ? "定位被拒絕。你仍可用城市篩選查看事件。"
                : "定位失敗，請確認瀏覽器權限或稍後再試。";
            setStatus(msg);
            if (status) status.textContent = msg;
            userLocation = null;
            hideNearbyRadiusLayer();
            updateNearbyControls();
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    }

    function removeMapOverlays() {
        document.querySelectorAll(".map-hero, .map-orbital-card").forEach(el => el.remove());
    }

    function populateCityFilters(){
        const d=document.getElementById("city-filter");
        const m=document.getElementById("city-filter-mobile");
        if(!d||!m) return;
        const html=['<option value="all">全部城市</option>',...CITY_OPTIONS.map(o=>`<option value="${escapeAttribute(o.value)}">${escapeHtml(o.label)}</option>`)].join("");
        d.innerHTML=html; m.innerHTML=html;
    }

    // ── FILTERS ─────────────────────────────────────────────
    function renderCategoryButtons(){
        const isOnline = currentMapMode === "online";
        const isCommute = currentMapMode === "commute";
        const config = isOnline ? TW_ONLINE_CATEGORIES : CATEGORY_CONFIG;
        const order = isCommute ? ["all", "traffic", "accident", "disaster"] : FIXED_CATEGORY_ORDER;

        if (isCommute && !order.includes(activeCategory)) activeCategory = "all";
        catFilters.innerHTML = order.map(cat=>{
            const mappedCat = inferEventGroupCategory(cat);
            const c = config[mappedCat]||config.other;
            const isActive = activeCategory===cat;
            const svg = CAT_SVG[cat]||CAT_SVG.other;
            return `<button class="filter-chip filter-chip-v2${isActive?" active":""}" data-category="${escapeAttribute(cat)}"
                style="--chip-bg:${c.color};${isActive ? `background:${c.color};` : ""}"
            ><span class="chip-icon">${svg}</span>${escapeHtml(c.text)}</button>`;
        }).join("");
        catFilters.querySelectorAll("[data-category]").forEach(btn=>{
            btn.addEventListener("click",()=>{
                activeCategory=btn.dataset.category||"all";
                trackEvent("category_filter_change", { category: activeCategory });
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
        const commuteCategories = new Set(["traffic", "accident", "disaster"]);
        const filtered = parsedEvents.filter(ev=>{
            if (!shouldShowRealtimeEvent(ev)) return false;
            if (!VIDEO_DEMO_ROUTE && !isVisibleEventLayer(ev, { showUpcoming: showUpcomingEvents })) return false;
            if (!VIDEO_DEMO_ROUTE && !isWithinTimeRange(ev, activeTimeRange) && !(showUpcomingEvents && isFutureActivity(ev))) return false;
            if (appliedMapBounds && !isEventInBounds(ev, appliedMapBounds)) return false;

            const mappedCategory = inferEventGroupCategory(ev);
            if(currentMapMode === "commute" && !commuteCategories.has(mappedCategory)) return false;
            if(activeCategory!=="all" && mappedCategory!==activeCategory) return false;
            if(cityFilter!=="all"){
                if(!normalizeText(ev.city).toLowerCase().includes(cityFilter.toLowerCase())) return false;
            }
            if(searchKeyword){
                const hay=getSearchableEventText(ev);
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

    function isMourningEvent(ev = {}) {
        return isMourningEventSafely(ev);
    }

    async function updateReactionUI(eventId, container) {
        if (!container) return;
        const data = await getReactions(eventId);
        const reacted = localStorage.getItem(`reacted:${eventId}`);
        const compact = container.closest(".custom-popup") !== null;
        container.innerHTML = makeReactionBarHtml(eventId, data, reacted, compact);
    }

    async function handleReactClick(e, eventId, type, btn) {
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
    }

    window.handleReactClick = handleReactClick;
    window.handleReaction = handleReactClick;

    function renderLoadingState() {
        if (!eventList) return;
        eventList.innerHTML = `
            <div class="list-loading-state" role="status" aria-live="polite">
                <i class="fa-solid fa-satellite-dish"></i>
                <strong>正在同步最新事件</strong>
                <p>地圖正在讀取交通、災害與活動資料。完成後會自動更新清單與標記。</p>
                <div class="loading-line"></div>
                <div class="loading-line short"></div>
            </div>`;
    }

    function resetVisibleFilters() {
        activeCategory = "all";
        searchKeyword = "";
        isNearbyMode = false;
        alertZoneFilterEnabled = false;
        clearUserLocationMarker();
        ["event-search", "event-search-mobile"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        ["city-filter", "city-filter-mobile"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "all";
        });
        drawCityBoundary("all");
        renderCategoryButtons();
        renderEvents();
        updateNearbyControls();
        flyToLatLng([23.698, 120.961], 7, 900);
    }

    function showSubmissionFocusNotice(message) {
        const notice = document.createElement("div");
        notice.className = "submission-focus-notice";
        notice.textContent = message;
        document.body.appendChild(notice);
        window.setTimeout(() => notice.remove(), 5000);
    }

    function focusRequestedSubmission() {
        if (!requestedSubmissionId) return;
        const submission = findPublishedSubmission(parsedEvents, requestedSubmissionId);
        if (!submission) {
            showSubmissionFocusNotice("投稿尚未公開或目前無法顯示");
            removeSubmissionQuery();
            return;
        }
        activeCategory = "all";
        searchKeyword = "";
        isNearbyMode = false;
        alertZoneFilterEnabled = false;
        clearUserLocationMarker();
        ["event-search", "event-search-mobile"].forEach((id) => {
            const input = document.getElementById(id);
            if (input) input.value = "";
        });
        ["city-filter", "city-filter-mobile"].forEach((id) => {
            const select = document.getElementById(id);
            if (select) select.value = "all";
        });
        drawCityBoundary("all");
        renderCategoryButtons();
        renderEvents();
        const rendered = renderedMarkers.find((item) => item.event?.source === "user_submission" && item.event?.submissionId === requestedSubmissionId);
        const lat = Number(submission.lat), lng = Number(submission.lng);
        if (rendered && Number.isFinite(lat) && Number.isFinite(lng)) {
            flyToLatLng([lat, lng], 15, 800);
            rendered.popup.setLngLat([lng, lat]).addTo(map);
            showSubmissionFocusNotice("你的投稿已發布並顯示在地圖上");
        } else {
            showSubmissionFocusNotice("投稿尚未公開或目前無法顯示");
        }
        removeSubmissionQuery();
    }
    function focusRequestedEvent() {
        if (!requestedEventId) return;
        const event = parsedEvents.find((item) => String(item?.id || "") === requestedEventId);
        if (!event) { showSubmissionFocusNotice("找不到對應正式事件"); return; }
        const rendered = renderedMarkers.find((item) => String(item.event?.id || "") === requestedEventId);
        const lat = Number(event.lat), lng = Number(event.lng);
        if (!rendered || !Number.isFinite(lat) || !Number.isFinite(lng)) { showSubmissionFocusNotice("找不到對應正式事件"); return; }
        flyToLatLng([lat, lng], 15, 800); rendered.popup.setLngLat([lng, lat]).addTo(map);
        showSubmissionFocusNotice("已定位至正式事件");
    }

    function buildEmptyStateHtml() {
        const hasSourceEvents = Array.isArray(parsedEvents) && parsedEvents.length > 0;
        const filtered = activeCategory !== "all" || searchKeyword || currentCityFilter() !== "all" || isNearbyMode || alertZoneFilterEnabled;
        const title = hasSourceEvents && filtered ? "沒有符合目前條件的事件" : "目前沒有可顯示的事件";
        const copy = hasSourceEvents && filtered
            ? (alertZoneFilterEnabled ? "目前沒有事件落在已啟用的警戒區，可放大半徑或關閉警戒區篩選。" : (isNearbyMode ? `附近 ${formatRadiusLabel(nearbyRadiusMeters)} 目前沒有符合條件的事件，可放大半徑或查看全台。` : "試著放寬分類、城市或關鍵字，清單會立即重新整理。"))
            : "資料源目前沒有回傳事件。你仍可切換模式、查看地圖，或稍後重新同步。";
        const hint = currentMapMode === "online"
            ? "TW Online 模式會保留相同的篩選邏輯，方便比較不同資料視角。"
            : (currentMapMode === "commute"
                ? "出門前模式只保留交通、事故、施工與災害；若清單為空，可能是目前資料源沒有回傳此類事件。"
                : "一般模式會優先顯示台灣交通、災害、意外與活動資料。");
        return `
            <div class="empty-state">
                <i class="fa-solid fa-map-location-dot"></i>
                <strong>${escapeHtml(title)}</strong>
                <p>${escapeHtml(copy)}</p>
                <small>${escapeHtml(hint)}</small>
                ${filtered ? `
                    <div class="empty-actions">
                        <button type="button" class="empty-action-btn primary" id="reset-filters-btn">清除篩選</button>
                    </div>` : ""}
            </div>`;
    }

    function getCurrentCategoryLabel() {
        if (currentMapMode === "fortune" && typeof getFortuneFilterLabel === "function") return getFortuneFilterLabel(activeCategory);
        if (alertZoneFilterEnabled) return "警戒區命中";
        if (isNearbyMode) return `附近 ${formatRadiusLabel(nearbyRadiusMeters)}`;
        if (currentMapMode === "commute" && activeCategory === "all") return "出門前事件";
        if (activeCategory === "all") return "全部事件";
        const visual = getCategoryVisual(activeCategory);
        return visual?.text || activeCategory || "全部事件";
    }

    function ensureMobileFilterSummary() {
        if (!newsSidebar) return null;
        const header = newsSidebar.querySelector(".sidebar-header");
        if (!header) return null;
        let summary = header.querySelector(".mobile-filter-summary");
        if (!summary) {
            summary = document.createElement("button");
            summary.type = "button";
            summary.className = "mobile-filter-summary";
            summary.setAttribute("aria-label", "目前篩選摘要");
            header.appendChild(summary);
        }
        return summary;
    }

    function updateMobileFilterSummary(count = 0) {
        const summary = ensureMobileFilterSummary();
        if (!summary) return;
        summary.innerHTML = `<span>目前篩選：${escapeHtml(getCurrentCategoryLabel())}</span><strong>${Number(count || 0)} 筆</strong>`;
    }

    // ── RENDER ──────────────────────────────────────────────
    function initMobileFilterCollapse() {
        if (!newsSidebar) return;
        const apply = () => {
            if (window.innerWidth < 768) newsSidebar.classList.add("filters-collapsed");
            else newsSidebar.classList.remove("filters-collapsed");
        };
        apply();
        const summary = ensureMobileFilterSummary();
        if (summary && !summary.dataset.bound) {
            summary.dataset.bound = "1";
            summary.addEventListener("click", () => {
                newsSidebar.classList.toggle("filters-collapsed");
            });
        }
        window.addEventListener("resize", apply);
        window.addEventListener("orientationchange", apply);
    }

    function renderEvents(){
        let events = applyAlertZoneMatches(getFilteredEvents());
        if (alertZoneFilterEnabled) events = filterAlertZoneEvents(events);
        events = filterEventsByNearby(events);
        const isOnline = currentMapMode === "online";
        const config = isOnline ? TW_ONLINE_CATEGORIES : CATEGORY_CONFIG;
        const isMobile = isMobileViewport();
        const markerLimit = VIDEO_DEMO_ROUTE ? VIDEO_DEMO_MARKER_LIMIT : (isMobile ? MOBILE_MARKER_LIMIT : Infinity);
        const cardLimit = VIDEO_DEMO_ROUTE ? VIDEO_DEMO_CARD_LIMIT : (isMobile ? MOBILE_CARD_LIMIT : Infinity);

        if (alertZoneFilterEnabled && !isNearbyMode) {
            events = sortAlertZoneEvents(events);
        } else {
            events.sort((a,b)=>{
                const weightDelta = getEventSortWeight(a) - getEventSortWeight(b);
                if (weightDelta !== 0) return weightDelta;
                const locationDelta = getEventLocationSortWeight(a) - getEventLocationSortWeight(b);
                if (locationDelta !== 0) return locationDelta;
                const sourceDelta = getEventSourceSortWeight(a) - getEventSourceSortWeight(b);
                if (sourceDelta !== 0) return sourceDelta;
                const at = Date.parse(a.updatedAt || a.publishedAt || a.createdAt || "") || 0;
                const bt = Date.parse(b.updatedAt || b.publishedAt || b.createdAt || "") || 0;
                return bt - at;
            });
        }

        clearRenderedMarkers();
        eventList.innerHTML="";
        updateCurationMeta(events);
        dataTrust.updateVisibleCount(events.length);
        renderAlertZoneSummary(events);

        if(!events.length){
            eventList.innerHTML = buildEmptyStateHtml();
            document.getElementById("reset-filters-btn")?.addEventListener("click", resetVisibleFilters);
        }

        forEachEventSafely(events, (ev, index) => {
            const shouldRenderMarker = index < markerLimit || ev.submissionId === requestedSubmissionId;
            const locationPresentation = getLocationPresentation(ev);
            const canRenderMarker = shouldRenderMarker && locationPresentation.marker && (locationPresentation.mode === "city_area" || shouldRenderLocationMarker(ev));
            const shouldRenderCard = index < cardLimit;
            if (!canRenderMarker && !shouldRenderCard) return;
            const mappedCat = inferEventGroupCategory(ev);
            const cat = config[mappedCat]||config.other;
            const latlng = [Number(ev.lat),Number(ev.lng)];

            // Marker
            const displayTitle = (isOnline && ev.twOnlineTitle) ? ev.twOnlineTitle : (ev.title || "未命名事件");
            const displayContent = (isOnline && ev.twOnlineContent) ? ev.twOnlineContent : (ev.content || "沒有摘要");
            const severity = getEventSeverity(ev);
            const markerStyle = resolveMarkerStyle(ev, cat.color);

            const catVisual = getCategoryVisual(mappedCat);
            const pinPulse = shouldPinPulse(ev, severity);
            const popupHtml = buildPopupHtml(ev, displayTitle, displayContent, markerStyle);

            let popup = null;
            if (canRenderMarker) {
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
                    if (isMourningEvent(ev)) {
                        const container = popup.getElement().querySelector(".reaction-container, .popup-reactions-wrap");
                        if (container) updateReactionUI(ev.id, container);
                    }
                });
                popup.on("close", () => { if (activePopup === popup) activePopup = null; });

                const marker = new mapboxgl.Marker({
                    element: makeMarkerElement(
                        markerStyle.color,
                        CAT_SVG[mappedCat] || CAT_SVG.other,
                        severity,
                        markerStyle.glow,
                        pinPulse
                    ),
                    anchor: "center",
                    offset: [0, 0]
                });
                enableSubpixelPositioning(marker);
                marker
                    .setLngLat([latlng[1], latlng[0]])
                    .setPopup(popup)
                    .addTo(map);
                
                const markerEl = marker.getElement();
                markerEl.style.cursor = "pointer";
                markerEl.dataset.eventId = String(ev.id || "");
                if (ev.source === "user_submission") markerEl.classList.add("submission-marker");
                markerEl.classList.add(`marker-location-${locationPresentation.mode}`);

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
                            .setHTML(`<div style="font-size:12px;font-weight:700;max-width:180px;line-height:1.5;">${escapeHtml(ev.title || displayTitle)}</div>`)
                            .addTo(map);
                    });

                    markerEl.addEventListener("mouseleave", () => {
                        tooltip.remove();
                    });
                }

                renderedMarkers.push({ marker, event: ev, popup });
            }

            if (!shouldRenderCard) return;

            const card = document.createElement("article");
            card.className = "event-card-v2";
            if (ev.source === "user_submission") card.classList.add("submission-card");
            card.style.setProperty("--card-color", catVisual.color);
            card.innerHTML = buildEventCardHtml(ev, displayTitle, displayContent, catVisual);

            card.querySelector('[data-action="focus-event"]')?.addEventListener("click", (event) => {
                event.stopPropagation();
                if (popup && locationPresentation.flyTo) {
                    flyToLatLng(latlng, ev.source === "TDX CMS" ? 14 : 13, 800);
                    popup.addTo(map);
                    if (window.innerWidth < 768) newsSidebar.classList.add("drawer-collapsed");
                } else {
                    setStatus("此事件位置待確認，無法在地圖上精準定位");
                }
            });

            card.addEventListener("click",e=>{
                if(e.target instanceof HTMLElement&&(e.target.tagName==="A"||e.target.tagName==="BUTTON"||e.target.closest("button"))) return;
                trackEvent("event_card_open", {
                    category: String(ev.category || "other"),
                    city: String(ev.city || "unknown"),
                    sourceType: String(ev.source || "unknown"),
                    deviceLayout: window.innerWidth < 768 ? "mobile" : "desktop"
                });
                closeActivePopup();
                if (popup && locationPresentation.flyTo) {
                    flyToLatLng(latlng, ev.source==="TDX CMS"?14:13, 800);
                    popup.addTo(map);
                } else {
                    setStatus("此事件定位待確認，未顯示精準地圖標記");
                }
                if(window.innerWidth<768) newsSidebar.classList.add("drawer-collapsed");
            });

            const reportBtn=card.querySelector("[data-report]");
            if(reportBtn) reportBtn.addEventListener("click",e=>{
                e.stopPropagation();
                openReportModal(
                    decodeURIComponent(reportBtn.dataset.report||""),
                    decodeURIComponent(reportBtn.dataset.reportTitle||"")
                );
            });

            eventList.appendChild(card);
            if (isMourningEvent(ev)) {
                updateReactionUI(ev.id, card.querySelector('.reaction-container'));
            }
        }, (error, ev, index) => {
            console.error("[island-pulse] event render failed", {
                index,
                eventId: ev?.id,
                title: ev?.title,
                error
            });
        });

        if (isMobile && events.length > cardLimit) {
            const notice = document.createElement("div");
            notice.className = "mobile-render-limit";
            notice.textContent = `目前顯示 ${cardLimit}／${events.length} 筆；可使用搜尋、城市或分類縮小範圍。`;
            eventList.appendChild(notice);
        }

        const cnt=document.getElementById("mobile-count");
        if(cnt) cnt.textContent=`${events.length} 筆`;
        setStatus(alertZoneFilterEnabled
            ? `警戒區命中：${events.length} 筆事件`
            : (isNearbyMode ? `附近 ${formatRadiusLabel(nearbyRadiusMeters)}：${events.length} 筆事件` : `顯示 ${events.length} 筆事件`));
        updateMobileFilterSummary(events.length);
        updateNearbyControls(events.length);
        if (VIDEO_DEMO_ROUTE) {
            window.VIDEO_DEMO_STATE = {
                eventCount: parsedEvents.length,
                visibleCount: events.length,
                markerCount: document.querySelectorAll(".map-pin.event-marker").length,
                cardCount: document.querySelectorAll(".event-card-v2").length,
                activeCategory,
                nearbyRadiusMeters,
                isNearbyMode
            };
        }
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
    const eventDataManager = createEventDataManager({
        fetchEvents: async () => {
            const response = await fetch("/api/events", { cache: "no-store" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!Array.isArray(data)) throw new Error("Invalid event response");
            return data;
        },
        onState: async (state) => {
            const mobileRefreshState = document.getElementById("event-refresh-state-mobile");
            if (mobileRefreshState) {
                mobileRefreshState.textContent = state.phase === "loading" ? "正在更新…"
                    : state.phase === "success" ? `最後更新：${new Date(state.updatedAt).toLocaleTimeString("zh-TW")}`
                    : state.cached ? "目前顯示先前資料" : "事件資料暫時無法載入";
            }
            document.querySelectorAll("#manual-refresh-btn, #manual-refresh-btn-mobile").forEach((button) => {
                button.disabled = state.phase === "loading";
            });
            const refreshState = document.getElementById("event-refresh-state");
            if (refreshState) {
                if (state.phase === "loading") refreshState.textContent = "正在更新事件資料…";
                else if (state.phase === "success") refreshState.textContent = `最後成功更新：${new Date(state.updatedAt).toLocaleString("zh-TW")}`;
                else if (state.cached) refreshState.textContent = `資料暫時無法更新，顯示先前資料（${new Date(state.cached.updatedAt).toLocaleString("zh-TW")}）`;
                else refreshState.textContent = "事件資料暫時無法載入";
            }
            if (state.phase === "success") {
                const next = deduplicateEvents(state.events.map(normalizeDisplayEvent));
                const unchanged = JSON.stringify(next.map((event) => [event.id, event.updatedAt])) === JSON.stringify(parsedEvents.map((event) => [event.id, event.updatedAt]));
                parsedEvents = next;
                if (!unchanged) { reportSummaryByEvent = {}; renderCategoryButtons(); renderEvents(); }
                try { await syncReportSummary(); focusRequestedSubmission(); focusRequestedEvent(); } catch (error) { console.warn("report summary refresh failed", error); }
            } else if (state.phase === "error") {
                dataTrust.updateError("事件資料暫時無法更新");
                if (!parsedEvents.length && state.cached) { parsedEvents = deduplicateEvents(state.cached.events.map(normalizeDisplayEvent)); renderCategoryButtons(); renderEvents(); }
                else if (!parsedEvents.length) {
                    reportSummaryByEvent = {}; renderCategoryButtons(); renderEvents();
                    if (eventList) eventList.innerHTML = '<div class="empty-state" role="status"><strong>事件資料暫時無法載入</strong><p>請稍後再試，或使用重新整理按鈕。</p><button type="button" class="btn btn-primary" data-action="manual-refresh-empty">重新整理</button></div>';
                }
            }
        }
    });

    async function syncNewsAndRender(){
        if (VIDEO_DEMO_ROUTE) {
            parsedEvents = deduplicateEvents(VIDEO_DEMO_EVENTS.map(normalizeDisplayEvent));
            reportSummaryByEvent = {};
            renderCategoryButtons();
            renderEvents();
            dataTrust.updateFromResponse(parsedEvents, { ok: true, status: 200, headers: new Headers() }, document.querySelectorAll(".event-card-v2").length);
            setStatus("作品展示模式：固定事件資料");
            return parsedEvents;
        }
        setStatus("正在抓取事件資料...");
        renderLoadingState();
        return eventDataManager.refresh();
        let res;
        let list;
        try {
            res = await fetch("/api/events");
            const raw = await res.text();
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = JSON.parse(raw);
            list = Array.isArray(data) ? data : [];
        } catch (error) {
            console.warn("資料服務暫時無法連線，目前顯示展示資料", error);
            parsedEvents=deduplicateEvents(MOCK_EVENTS.map(normalizeDisplayEvent));
            reportSummaryByEvent = {};
            renderCategoryButtons(); renderEvents();
            dataTrust.updateError("資料服務暫時無法連線，目前顯示展示資料");
            setStatus("展示模式：顯示範例資料");
            return parsedEvents;
        }

        const normalizedEvents = [];
        list.forEach((event, index) => {
            try {
                normalizedEvents.push(normalizeDisplayEvent(event));
            } catch (error) {
                console.error("[island-pulse] event normalization failed", { index, event, error });
            }
        });
        parsedEvents = deduplicateEvents(normalizedEvents);

        try {
            await syncReportSummary();
            renderCategoryButtons();
            renderEvents();
            focusRequestedSubmission(); focusRequestedEvent();
            dataTrust.updateFromResponse(parsedEvents, res, document.querySelectorAll(".event-card-v2").length);
        } catch (error) {
            console.error("[island-pulse] 事件渲染失敗", error);
            setStatus("事件資料已取得，但部分事件無法顯示");
        }
        return parsedEvents;
    }

    // ── CITY SYNC ────────────────────────────────────────────
    function syncCityFilter(value){
        trackEvent("city_filter_change", { city: value });
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
      const mapStage = document.getElementById('map-stage');
      const statsEl  = document.getElementById('stats-view'); 
      document.body.classList.toggle('stats-mode', !mode);
 
      ['btn-tw','btn-tw-mobile'].forEach(id=>{ 
        const b=document.getElementById(id); 
        if(b) b.classList.toggle('active', mode); 
      }); 
      ['btn-global','btn-global-mobile'].forEach(id=>{ 
        const b=document.getElementById(id); 
        if(b) b.classList.toggle('active', !mode); 
      }); 
 
      if(mode){ 
        isDragging = false;
        sidebar.style.transform = '';
        sidebar.style.transition = '';
        mapStage.style.display = 'flex';
        mapEl.style.display   = ''; 
        statsEl.style.display = 'none'; 
        flyToLatLng(taiwanView.center, taiwanView.zoom, 800); 
        renderEvents(); 
        requestAnimationFrame(() => {
          if (map && typeof map.resize === 'function') map.resize();
        });
      } else { 
        isDragging = false;
        sidebar.style.transform = '';
        sidebar.style.transition = '';
        mapStage.style.display = 'none';
        mapEl.style.display   = 'none'; 
        statsEl.style.display = 'flex'; 
        statsEl.scrollTop = 0;
        renderStatsView(); 
      } 
    } 
 
    async function renderLegacyStatsView(){ 
      const events = parsedEvents.filter(ev=>{ 
        if (!shouldShowRealtimeEvent(ev)) return false;
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
            <span style="font-size:12px;color:var(--text-secondary);width:52px;text-align:right;flex-shrink:0;">${escapeHtml(city)}</span> 
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
 
      // 熱門事件：批次抓 reaction，取前4 
      const hotEl = document.getElementById('hot-events'); 
      if(!hotEl) return; 
      hotEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">載入中...</div>'; 
 
      let reactionByEvent = {};
      const eventIds = events.map(ev => String(ev.id || "").trim()).filter(Boolean).slice(0, 100);
      if (eventIds.length) {
        try {
          const r = await fetch(`/api/reaction?eventIds=${encodeURIComponent(eventIds.join(","))}`);
          const d = await r.json();
          reactionByEvent = d && d.reactions && typeof d.reactions === "object" ? d.reactions : {};
        } catch {
          reactionByEvent = {};
        }
      }

      const withReactions = events.map(ev => {
        const reaction = reactionByEvent[String(ev.id || "")] || {};
        const muyu = Number(reaction.muyu || 0);
        const candle = Number(reaction.candle || 0);
        return { ...ev, muyu, candle, total: muyu + candle };
      });
 
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
        const title = ev.title || '未命名事件'; 
        const city  = ev.city || ''; 
        const border = i < top4.length-1 ? 'border-bottom:1px solid rgba(99,120,180,0.1);' : ''; 
        return ` 
          <div style="padding:10px 0;${border}"> 
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;"> 
              <span style="font-size:10px;font-weight:500;padding:2px 7px;border-radius:99px;background:${cat.bg};color:${cat.color};">${escapeHtml(cat.text)}</span> 
              <span style="font-size:11px;color:var(--text-secondary);">🪘 ${Number(ev.muyu || 0)} &nbsp;🕯️ ${Number(ev.candle || 0)}</span> 
            </div> 
            <div style="font-size:12px;color:var(--text-primary);line-height:1.55;margin-bottom:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(title)}</div> 
            <div style="font-size:11px;color:var(--text-muted);">📍 ${escapeHtml(city)}</div> 
          </div> 
        `; 
      }).join(''); 
    } 


    // ── SEARCH ───────────────────────────────────────────────
    function formatStatsTime(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '資料整理中';
      return new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    }

    function renderStatsView() {
      const events = parsedEvents.filter((event) => {
        if (!shouldShowRealtimeEvent(event)) return false;
        return Number.isFinite(Number(event.lat)) && Number.isFinite(Number(event.lng)) && isValidTaiwanCoord(Number(event.lat), Number(event.lng));
      });
      updateCurationMeta(events);
      const summary = buildStatsSummary(events);
      const stat = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
      stat('stat-total', summary.total.toLocaleString());
      stat('stat-city-count', summary.cityCount.toLocaleString());
      stat('stat-top-category', summary.topCategory ? summary.topCategory.label : '資料整理中');
      stat('stat-last-updated', formatStatsTime(summary.lastUpdated));
      stat('stats-hero-count', summary.total.toLocaleString());

      const renderRanks = (element, rows, labelKey, category) => {
        if (!element) return;
        const highest = rows[0]?.count || 1;
        element.innerHTML = rows.length ? rows.slice(0, 8).map((row) => `
          <div class="stats-rank-row"><span class="stats-rank-label">${escapeHtml(row[labelKey])}</span><span class="stats-rank-track"><span class="stats-rank-fill${category ? ' stats-rank-fill--category' : ''}" style="width:${Math.round((row.count / highest) * 100)}%"></span></span><strong>${row.count}</strong></div>`).join('') : '<p class="stats-empty">資料整理中</p>';
      };
      renderRanks(document.getElementById('city-bars'), summary.cities, 'city', false);
      renderRanks(document.getElementById('category-bars'), summary.categories, 'label', true);

      const hotEl = document.getElementById('hot-events');
      if (!hotEl) return;
      hotEl.innerHTML = '<p class="stats-empty">正在整理互動資料…</p>';
      const eventIds = events.map((event) => String(event.id || '').trim()).filter(Boolean).slice(0, 100);
      if (!eventIds.length) { hotEl.innerHTML = '<p class="stats-empty">目前沒有可顯示的事件。</p>'; return; }
      fetch(`/api/reaction?eventIds=${encodeURIComponent(eventIds.join(','))}`)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('reaction request failed')))
        .then((payload) => {
          const ranked = sortPopularOrRecentEvents(events, payload?.reactions || {}).slice(0, 5);
          hotEl.innerHTML = ranked.map((event) => {
            const title = String(event.title || '未命名事件').trim() || '未命名事件';
            const time = event.timestamp ? formatStatsTime(new Date(event.timestamp)) : '資料整理中';
            return `<button class="stats-event" type="button" data-stat-event="${escapeAttribute(String(event.id || ''))}"><span class="stats-event-category">${escapeHtml(getStatsCategoryLabel(event.category))}</span><span class="stats-event-body"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(String(event.city || '未標示'))} · ${time}</small></span><span class="stats-event-reactions">${event.total ? `${event.total} 互動` : '最新'}</span></button>`;
          }).join('') || '<p class="stats-empty">資料整理中</p>';
          hotEl.querySelectorAll('[data-stat-event]').forEach((button) => button.addEventListener('click', () => {
            const event = parsedEvents.find((item) => String(item.id || '') === button.dataset.statEvent);
            if (!event) return;
            switchMode(true);
            flyToLatLng(Number(event.lat), Number(event.lng), 12, 700);
            history.replaceState(null, '', `${location.pathname}?event=${encodeURIComponent(String(event.id || ''))}`);
          }));
        })
        .catch(() => { hotEl.innerHTML = '<p class="stats-empty">互動資料暫時無法載入。</p>'; });
      fetch('/api/reactions/total')
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('total request failed')))
        .then((payload) => { stat('stat-muyu', (Number(payload?.muyu) || 0).toLocaleString()); stat('stat-candle', (Number(payload?.candle) || 0).toLocaleString()); })
        .catch(() => { stat('stat-muyu', '0'); stat('stat-candle', '0'); });
    }

    function handleSearch(e){
        searchKeyword=e.target.value.trim().toLowerCase();
        renderEvents();
    }

    // ── DRAWER ───────────────────────────────────────────────
    function updateMobileDrawerBounds() {
        if (window.innerWidth >= 768) return;
        const mobileControls = document.getElementById("mobile-topbar");
        if (!mobileControls || !newsSidebar) return;

        // Measure instead of hard-coding: the mobile refresh/status row can wrap,
        // and Android Chrome changes the visual viewport while its URL bar moves.
        const controlsBottom = Math.max(0, Math.ceil(mobileControls.getBoundingClientRect().bottom));
        newsSidebar.style.setProperty("--mobile-control-area", `${controlsBottom}px`);
    }

    function toggleDrawer(){
        if(window.innerWidth<768 && !document.body.classList.contains('stats-mode')) {
            newsSidebar.classList.toggle("drawer-collapsed");
            scheduleMapResize();
        }
    }

    // ── MOBILE GESTURES ──────────────────────────────────────
    let startY = 0;
    let isDragging = false;
    const sidebar = document.getElementById("news-sidebar");

    sidebar.addEventListener("touchstart", e => {
        if (window.innerWidth >= 768 || document.body.classList.contains('stats-mode')) return;
        const touch = e.touches[0];
        const sidebarTop = sidebar.getBoundingClientRect().top;
        // 只有在頂部區域 (把手附近) 才觸發拖曳
        if (touch.clientY - sidebarTop > 80) return;
        
        isDragging = true;
        startY = touch.clientY;
        sidebar.style.transition = "none";
    }, { passive: true });

    sidebar.addEventListener("touchmove", e => {
        if (document.body.classList.contains('stats-mode')) { isDragging = false; return; }
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
        if (document.body.classList.contains('stats-mode')) { isDragging = false; return; }
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
        if (window.innerWidth < 768 && !document.body.classList.contains('stats-mode')) {
            sidebar.classList.add("drawer-collapsed");
            scheduleMapResize();
        }
    });
    window.addEventListener("resize", scheduleMapResize);
    window.addEventListener("resize", updateMobileDrawerBounds);
    window.addEventListener("orientationchange", updateMobileDrawerBounds);
    const handleMobileViewportChange = () => {
        updateMobileDrawerBounds();
        scheduleMapResize();
    };
    window.visualViewport?.addEventListener("resize", handleMobileViewportChange);
    window.visualViewport?.addEventListener("scroll", handleMobileViewportChange);
    updateMobileDrawerBounds();
    if (typeof ResizeObserver !== "undefined") {
        const layoutObserver = new ResizeObserver(() => {
            scheduleMapResize();
        });
        if (mapStage) layoutObserver.observe(mapStage);
        if (newsSidebar) layoutObserver.observe(newsSidebar);
    }
    const REPORT_TYPE_OPTIONS = ["資料錯誤", "座標錯誤", "事件已解除", "不是同一事件", "分類錯誤", "來源失效", "其他"];
    let currentReportEvent = null;
    let currentSubmissionReportId = "";

    function ensureReportStatusElements(){
        const actions = document.querySelector("#report-modal .modal-actions");
        if (!actions) return;
        if (!document.getElementById("report-error")) {
            const error = document.createElement("div");
            error.id = "report-error";
            error.className = "report-status error";
            error.style.display = "none";
            actions.parentNode.insertBefore(error, actions);
        }
        if (!document.getElementById("report-success")) {
            const success = document.createElement("div");
            success.id = "report-success";
            success.className = "report-status success";
            success.style.display = "none";
            actions.parentNode.insertBefore(success, actions);
        }
    }

    function setReportStatus(type, message){
        ensureReportStatusElements();
        const error = document.getElementById("report-error");
        const success = document.getElementById("report-success");
        if (error) {
            error.textContent = type === "error" ? message : "";
            error.style.display = type === "error" ? "block" : "none";
        }
        if (success) {
            success.textContent = type === "success" ? message : "";
            if (type === "success" && VIDEO_DEMO_ROUTE) {
                const note = document.createElement("div");
                note.className = "video-demo-report-note";
                note.textContent = "影片示範模式不寫入正式資料庫。";
                success.append(note);
            }
            success.style.display = type === "success" ? "block" : "none";
            success.style.whiteSpace = "pre-line";
        }
    }

    function openReportModal(identifier, visibleTitle = ""){
        currentSubmissionReportId = "";
        ensureReportStatusElements();
        currentReportEvent = findReportEvent(identifier);
        const title = currentReportEvent?.title || normalizeText(visibleTitle) || String(identifier || "");
        document.getElementById("report-title").value = title;
        const typeEl = document.getElementById("report-type");
        if (typeEl) {
            typeEl.innerHTML = REPORT_TYPE_OPTIONS.map(option => `<option value="${option}">${option}</option>`).join("");
            typeEl.value = REPORT_TYPE_OPTIONS[0];
        }
        document.getElementById("report-message").value="";
        const submitBtn = document.getElementById("report-submit-btn");
        const cancelBtn = document.getElementById("report-cancel-btn");
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "送出回報";
        }
        if (cancelBtn) cancelBtn.textContent = "取消";
        setReportStatus("", "");
        reportModal.classList.add("visible");
        reportModal.setAttribute("aria-hidden", "false");
    }
    function closeReportModal(){ reportModal.classList.remove("visible"); reportModal.setAttribute("aria-hidden", "true"); document.getElementById("report-cancel-btn")?.focus(); }
    function openSubmissionReportModal(submissionId) {
        if (!submissionId) return;
        currentSubmissionReportId = submissionId;
        currentReportEvent = null;
        ensureReportStatusElements();
        document.getElementById("report-title").value = "檢舉使用者投稿";
        const typeEl = document.getElementById("report-type");
        if (typeEl) typeEl.innerHTML = ["information_incorrect", "expired", "duplicate", "spam", "inappropriate", "wrong_location", "other"].map(value => `<option value="${value}">${value}</option>`).join("");
        document.getElementById("report-message").value = "";
        setReportStatus("", "");
        reportModal.classList.add("visible"); reportModal.setAttribute("aria-hidden", "false"); document.getElementById("report-type")?.focus();
    }

    async function submitReport(){
        const title=document.getElementById("report-title").value.trim();
        const errorType=document.getElementById("report-type").value || REPORT_TYPE_OPTIONS[0];
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
    async function submitReportWithReview(){
        const ev = currentReportEvent;
        const title = document.getElementById("report-title").value.trim();
        const errorType = document.getElementById("report-type").value || REPORT_TYPE_OPTIONS[0];
        const message = document.getElementById("report-message").value.trim();
        if (VIDEO_DEMO_ROUTE) {
            if (!message) {
                setReportStatus("error", "請補充說明，方便人工覆核。");
                return;
            }
            const btn = document.getElementById("report-submit-btn");
            if (btn) {
                btn.textContent = "已送出";
                btn.disabled = true;
            }
            setReportStatus("success", "已送出，等待覆核。");
            const cancelBtn = document.getElementById("report-cancel-btn");
            if (cancelBtn) cancelBtn.textContent = "關閉";
            return;
        }
        if (currentSubmissionReportId) {
            const btn = document.getElementById("report-submit-btn");
            btn.disabled = true;
            try {
                const res = await fetch("/api/submission-reports", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ submissionId: currentSubmissionReportId, reason: errorType, note: message })
                });
                const result = await res.json().catch(() => ({}));
                if (!res.ok || !result.success) throw new Error(result.error || "report failed");
                setReportStatus("success", "已收到檢舉，感謝你協助維護資訊品質。");
                btn.textContent = "已送出";
            } catch {
                setReportStatus("error", "檢舉送出失敗，請稍後再試。");
                btn.disabled = false;
            }
            return;
        }
        if (!ev || !ev.id) {
            setReportStatus("error", "找不到事件 ID，請重新開啟事件卡再回報。");
            return;
        }
        if (!errorType) {
            setReportStatus("error", "請選擇回報類型。");
            return;
        }
        if (!message) {
            setReportStatus("error", "請補充說明，方便人工覆核。");
            return;
        }
        const btn = document.getElementById("report-submit-btn");
        btn.textContent = "送出中...";
        btn.disabled = true;
        try {
            const res = await fetch("/api/report", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    eventId: String(ev.id),
                    title,
                    errorType,
                    message,
                    eventSnapshot: buildReportSnapshot(ev)
                })
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || !result.success) throw new Error(result.error || "回報送出失敗");
            setReportStatus("success", `已收到回報 #${result.reportId}\nAI 初判：${result.aiSummary || "待人工覆核"}\n我們會依來源與資料狀態覆核。`);
            btn.textContent = "已送出";
            btn.disabled = true;
            const cancelBtn = document.getElementById("report-cancel-btn");
            if (cancelBtn) cancelBtn.textContent = "關閉";
            await syncReportSummary();
            renderEvents();
        } catch(e) {
            console.warn("report submit failed", e);
            setReportStatus("error", "回報送出失敗，請稍後再試。");
        } finally {
            const successEl = document.getElementById("report-success");
            if (!successEl || successEl.style.display !== "block") {
                btn.textContent = "送出回報";
                btn.disabled = false;
            }
        }
    }

    function checkBetaModal(){
        if (VIDEO_DEMO_ROUTE) {
            betaModal.classList.remove("visible");
            return;
        }
        if(!localStorage.getItem("beta_accepted")) betaModal.classList.add("visible");
    }
    function closeBetaModal(){
        localStorage.setItem("beta_accepted","true");
        betaModal.classList.remove("visible");
    }

    // ── DONATE ───────────────────────────────────────────────
    let videoDemoStarted = false;

    function videoDemoWait(ms) {
        const delay = VIDEO_DEMO_TEST_MODE ? Math.max(60, Math.round(ms * 0.2)) : ms;
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    async function videoDemoWaitFor(predicate, timeout = 8000, interval = 120) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
            try {
                if (predicate()) return true;
            } catch {
                // Keep polling while the map and data settle.
            }
            await videoDemoWait(interval);
        }
        return false;
    }

    function ensureVideoDemoShell() {
        let overlay = document.getElementById("video-demo-overlay");
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "video-demo-overlay";
            overlay.className = "video-demo-overlay";
            overlay.setAttribute("aria-hidden", "true");
            overlay.innerHTML = [
                '<div class="video-demo-caption">',
                '<div class="video-demo-kicker">Island Pulse / 網頁操作導覽</div>',
                '<div class="video-demo-step"></div>',
                '<h1></h1>',
                '<p></p>',
                '</div>',
                '<div class="video-demo-frame"></div>',
                '<div class="video-demo-range"><span></span><strong>3 km</strong></div>',
                '<div class="video-demo-click"></div>',
                '<div class="video-demo-cursor"><i class="fa-solid fa-arrow-pointer"></i></div>',
                '<div class="video-demo-summary">',
                '<article><span>01</span><strong>先看位置</strong><small>用地圖掌握事件在哪裡</small></article>',
                '<article><span>02</span><strong>再篩類型</strong><small>把不相關的訊息降到最低</small></article>',
                '<article><span>03</span><strong>切到附近</strong><small>只留下目前半徑內的事件</small></article>',
                '<article><span>04</span><strong>回報修正</strong><small>讓公共訊號越來越準</small></article>',
                '</div>'
            ].join("");
            document.body.appendChild(overlay);
        }
        if (!overlay.querySelector(".video-demo-range")) {
            const range = document.createElement("div");
            range.className = "video-demo-range";
            range.innerHTML = "<span></span><strong>3 km</strong>";
            overlay.insertBefore(range, overlay.querySelector(".video-demo-click"));
        }
        return {
            overlay,
            caption: overlay.querySelector(".video-demo-caption"),
            step: overlay.querySelector(".video-demo-step"),
            title: overlay.querySelector(".video-demo-caption h1"),
            copy: overlay.querySelector(".video-demo-caption p"),
            frame: overlay.querySelector(".video-demo-frame"),
            range: overlay.querySelector(".video-demo-range"),
            click: overlay.querySelector(".video-demo-click"),
            cursor: overlay.querySelector(".video-demo-cursor"),
            summary: overlay.querySelector(".video-demo-summary")
        };
    }

    function setVideoDemoCaption(title, copy, step = "", placement = "top-left") {
        const shell = ensureVideoDemoShell();
        shell.caption.dataset.placement = placement;
        shell.step.textContent = step;
        shell.title.textContent = title;
        shell.copy.textContent = copy;
    }

    function setVideoDemoSummary(visible) {
        const shell = ensureVideoDemoShell();
        shell.summary.classList.toggle("visible", Boolean(visible));
    }

    function setVideoDemoFinalSummary() {
        const shell = ensureVideoDemoShell();
        shell.summary.innerHTML = [
            '<article class="video-demo-brand-card"><span>Island Pulse</span><strong>島嶼脈搏</strong><small>台灣事件地圖</small></article>',
            '<article><span>核心價值</span><strong>看見、理解、行動、共同修正。</strong><small>從分散資訊，到可以採取行動的在地判斷。</small></article>',
            '<article><span>TISDC</span><strong>作品展示影片</strong><small>台灣國際學生創意設計大賽</small></article>',
            '<article><span>System</span><strong>持續完善中</strong><small>資料來源、覆核機制與使用體驗持續優化</small></article>'
        ].join("");
    }

    function placeVideoDemoCaptionAwayFrom(rect = null) {
        const shell = ensureVideoDemoShell();
        if (!rect) {
            shell.caption.dataset.placement = "top-left";
            return;
        }
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const horizontal = centerX > window.innerWidth / 2 ? "left" : "right";
        const vertical = centerY > window.innerHeight / 2 ? "top" : "bottom";
        shell.caption.dataset.placement = `${vertical}-${horizontal}`;
    }

    function getVideoDemoElement(target) {
        if (!target) return null;
        if (target instanceof Element) return target;
        return document.querySelector(target);
    }

    function frameVideoDemoElement(target, padding = 12) {
        const shell = ensureVideoDemoShell();
        const el = getVideoDemoElement(target);
        if (!el) {
            shell.frame.classList.remove("visible");
            return null;
        }
        const rect = el.getBoundingClientRect();
        const left = Math.max(8, rect.left - padding);
        const top = Math.max(8, rect.top - padding);
        const width = Math.min(window.innerWidth - left - 8, rect.width + padding * 2);
        const height = Math.min(window.innerHeight - top - 8, rect.height + padding * 2);
        shell.frame.style.transform = "translate3d(" + left + "px, " + top + "px, 0)";
        shell.frame.style.width = Math.max(42, width) + "px";
        shell.frame.style.height = Math.max(42, height) + "px";
        shell.frame.classList.add("visible");
        placeVideoDemoCaptionAwayFrom({ left, top, width, height });
        return rect;
    }

    async function moveVideoDemoCursorTo(target, placement = "center", delay = 650) {
        const shell = ensureVideoDemoShell();
        const el = getVideoDemoElement(target);
        let x = window.innerWidth * 0.72;
        let y = window.innerHeight * 0.34;
        if (el) {
            const rect = el.getBoundingClientRect();
            if (placement === "right") {
                x = rect.right - 18;
                y = rect.top + rect.height / 2;
            } else if (placement === "left") {
                x = rect.left + 18;
                y = rect.top + rect.height / 2;
            } else if (placement === "bottom") {
                x = rect.left + rect.width / 2;
                y = rect.bottom - 18;
            } else {
                x = rect.left + rect.width / 2;
                y = rect.top + rect.height / 2;
            }
        }
        shell.cursor.classList.add("visible");
        shell.cursor.style.transform = "translate3d(" + Math.round(x) + "px, " + Math.round(y) + "px, 0)";
        await videoDemoWait(delay);
    }

    function pulseVideoDemoClick(target) {
        const shell = ensureVideoDemoShell();
        const rect = frameVideoDemoElement(target, 10);
        if (!rect) return;
        shell.click.style.left = (rect.left + rect.width / 2) + "px";
        shell.click.style.top = (rect.top + rect.height / 2) + "px";
        shell.click.classList.remove("visible");
        shell.click.getBoundingClientRect();
        shell.click.classList.add("visible");
        setTimeout(() => shell.click.classList.remove("visible"), 520);
    }

    function waitForVideoDemoFrames(count = 2) {
        return new Promise((resolve) => {
            const nextFrame = () => {
                if (--count <= 0) resolve();
                else requestAnimationFrame(nextFrame);
            };
            requestAnimationFrame(nextFrame);
        });
    }

    async function waitForVideoDemoReportSubmitLayout(submitButton, maxFrames = 45) {
        let previousRect = null;
        for (let frame = 0; frame < maxFrames; frame += 1) {
            await waitForVideoDemoFrames(frame === 0 ? 2 : 1);
            const success = document.getElementById("report-success");
            const rect = submitButton?.getBoundingClientRect();
            const successVisible = success?.style.display === "block";
            if (!successVisible || !rect?.width || !rect?.height) continue;

            if (previousRect
                && Math.abs(rect.left - previousRect.left) < 0.5
                && Math.abs(rect.top - previousRect.top) < 0.5
                && Math.abs(rect.width - previousRect.width) < 0.5
                && Math.abs(rect.height - previousRect.height) < 0.5) {
                return rect;
            }
            previousRect = rect;
        }
        return previousRect;
    }

    function getVideoDemoLocationMarkerCenter() {
        const markerEl = userLocationMarker?.getElement?.() || document.querySelector(".user-location-dot");
        if (!markerEl) return null;
        const rect = markerEl.getBoundingClientRect();
        if (!rect.width && !rect.height) return null;
        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
    }

    function setVideoDemoRange(visible, target = null, radiusMeters = nearbyRadiusMeters) {
        const shell = ensureVideoDemoShell();
        if (!shell.range) return;
        if (!visible) {
            shell.range.classList.remove("visible");
            return;
        }
        const mapEl = getVideoDemoElement(target) || mapContainer || document.getElementById("map-stage");
        const mapRect = mapEl?.getBoundingClientRect();
        const markerCenter = getVideoDemoLocationMarkerCenter();
        const x = markerCenter ? markerCenter.x : (mapRect ? mapRect.left + mapRect.width * 0.52 : window.innerWidth * 0.64);
        const y = markerCenter ? markerCenter.y : (mapRect ? mapRect.top + mapRect.height * 0.48 : window.innerHeight * 0.48);
        const base = Math.min(window.innerWidth, window.innerHeight);
        const size = Math.min(base * 0.48, Math.max(base * 0.29, base * (0.22 + Number(radiusMeters || 3000) / 22000)));
        const label = Number(radiusMeters || 3000) >= 5000 ? "5 km" : "3 km";
        shell.range.style.width = Math.round(size) + "px";
        shell.range.style.height = Math.round(size) + "px";
        shell.range.style.transform = "translate3d(" + Math.round(x - size / 2) + "px, " + Math.round(y - size / 2) + "px, 0)";
        const labelEl = shell.range.querySelector("strong");
        if (labelEl) labelEl.textContent = label;
        shell.range.classList.add("visible");
        if (VIDEO_DEMO_ROUTE) {
            window.VIDEO_DEMO_RANGE_STATE = { x, y, size, radiusMeters: Number(radiusMeters || 3000) };
        }
    }

    function pickVideoDemoEvent(preferredCategory = "") {
        const events = parsedEvents
            .filter(ev => shouldShowRealtimeEvent(ev) && shouldRenderLocationMarker(ev))
            .filter(ev => Number.isFinite(Number(ev.lat)) && Number.isFinite(Number(ev.lng)));
        if (VIDEO_DEMO_ROUTE) {
            const fixed = events.find(ev => ev.id === VIDEO_DEMO_PRIMARY_EVENT_ID);
            if (fixed && (!preferredCategory || inferEventGroupCategory(fixed) === preferredCategory)) return fixed;
        }
        if (preferredCategory) {
            return events.find(ev => inferEventGroupCategory(ev) === preferredCategory) || events[0] || null;
        }
        return events[0] || null;
    }

    function getVideoDemoPin(eventId = VIDEO_DEMO_PRIMARY_EVENT_ID) {
        return document.querySelector(`.map-pin.event-marker[data-event-id="${eventId}"]`) || document.querySelector(".map-pin.event-marker");
    }

    function getVideoDemoCard(eventId = "") {
        if (!eventId) return eventList.querySelector(".event-card-v2");
        const reportButton = eventList.querySelector(`[data-event-id="${eventId}"], [data-report="${encodeURIComponent(eventId)}"]`);
        return reportButton?.closest(".event-card-v2") || eventList.querySelector(".event-card-v2");
    }

    function getVideoDemoLocation() {
        if (VIDEO_DEMO_ROUTE) return { ...VIDEO_DEMO_USER_LOCATION };
        const seed = pickVideoDemoEvent("traffic") || pickVideoDemoEvent();
        if (!seed) return { ...VIDEO_DEMO_FALLBACK_LOCATION };
        return { lat: Number(seed.lat) + 0.003, lng: Number(seed.lng) + 0.003, accuracy: 20 };
    }

    function prepareVideoDemoBaseline() {
        document.documentElement.classList.add("video-demo-mode");
        document.body.classList.add("video-demo-mode");
        document.body.classList.remove("tw-online-mode", "stats-mode");
        betaModal.classList.remove("visible");
        settingsModal.classList.remove("visible");
        reportModal.classList.remove("visible");
        currentMapMode = "normal";
        activeCategory = "all";
        alertZoneFilterEnabled = false;
        isNearbyMode = false;
        userLocation = null;
        clearUserLocationMarker();
        ["city-filter", "city-filter-mobile"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "all";
        });
        setNearbyRadius(3000);
        applyMapMode("normal");
        switchMode(true);
        renderCategoryButtons();
        renderEvents();
        updateNearbyControls();
        scheduleMapResize();
    }

    function activateVideoDemoNearbyMode() {
        userLocation = getVideoDemoLocation();
        isNearbyMode = true;
        activeCategory = "all";
        setNearbyRadius(3000);
        if (!window._fallbackMap) updateUserLocationMarker();
        renderCategoryButtons();
        renderEvents();
        updateNearbyControls();
        if (window._fallbackMap && typeof window._fallbackMap.setView === "function") {
            window._fallbackMap.setView([userLocation.lat, userLocation.lng], 12);
        } else {
            flyToLatLng([userLocation.lat, userLocation.lng], 12.2, 650);
        }
    }

    function openVideoDemoReportModal() {
        const reportButton = eventList.querySelector('[data-action="open-report"]');
        if (reportButton) {
            const payload = readReportPayload(reportButton);
            openReportModal(payload.identifier, payload.title);
        } else {
            const ev = pickVideoDemoEvent();
            openReportModal(ev?.id || ev?.title || "demo-event", ev?.title || "Demo event");
        }
        const typeEl = document.getElementById("report-type");
        if (typeEl && typeEl.options.length > 1) typeEl.selectedIndex = 1;
        const messageEl = document.getElementById("report-message");
        if (messageEl) {
            messageEl.value = "這個事件的位置或內容需要補充，請協助更新。";
            messageEl.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    async function runVideoDemoSequence() {
        const shell = ensureVideoDemoShell();
        shell.overlay.classList.add("ready");
        try {
            do {
                window.VIDEO_DEMO_DONE = false;
                setVideoDemoSummary(false);
                setVideoDemoRange(false);
                prepareVideoDemoBaseline();

                setVideoDemoCaption("資訊很多，卻不知道哪一件會影響自己", "公共事件散落在新聞、交通資訊與社群裡。", "01｜問題意識");
                flyToLatLng([23.7, 120.95], 7.1, 520);
                frameVideoDemoElement("#map-stage", 14);
                await moveVideoDemoCursorTo("#map-stage", "center", 450);
                await videoDemoWait(2200);

                setVideoDemoCaption("把事件轉成位置", "島嶼脈搏將分散資訊整理成可以直接判斷的地圖訊號。", "02｜地圖訊號");
                renderEvents();
                const primaryEvent = pickVideoDemoEvent("traffic") || pickVideoDemoEvent();
                if (primaryEvent) flyToLatLng([Number(primaryEvent.lat), Number(primaryEvent.lng)], 11.8, 520);
                frameVideoDemoElement("#map-stage", 14);
                await moveVideoDemoCursorTo(getVideoDemoPin() || "#map-stage", "center", 430);
                await videoDemoWait(2700);

                const primaryPin = getVideoDemoPin();
                setVideoDemoCaption("看見事件", "點擊固定事件 PIN，位置、時間、來源與摘要會一起出現。", "03｜看見事件");
                if (primaryPin) {
                    frameVideoDemoElement(primaryPin, 18);
                    await moveVideoDemoCursorTo(primaryPin, "center", 420);
                    pulseVideoDemoClick(primaryPin);
                    primaryPin.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                } else {
                    frameVideoDemoElement("#map-stage", 14);
                }
                await videoDemoWait(2900);
                closeActivePopup();

                setVideoDemoCaption("左側保留判斷細節", "事件卡片補上來源、時間與摘要，讓評審看到資料如何被整理。", "04｜資料來源");
                eventList.scrollTop = 0;
                const primaryCard = getVideoDemoCard(VIDEO_DEMO_PRIMARY_EVENT_ID);
                frameVideoDemoElement(primaryCard || "#event-list", 14);
                await moveVideoDemoCursorTo(primaryCard || "#event-list", "right", 420);
                await videoDemoWait(2200);

                setVideoDemoCaption("降低資訊噪音", "用分類只留下此刻關心的事件，先看最可能影響行動的訊號。", "05｜分類聚焦");
                const trafficChip = catFilters.querySelector('[data-category="traffic"]') || catFilters.querySelector("[data-category]");
                frameVideoDemoElement(trafficChip || "#category-filters", 12);
                await moveVideoDemoCursorTo(trafficChip || "#category-filters", "center", 420);
                pulseVideoDemoClick(trafficChip || "#category-filters");
                if (trafficChip) trafficChip.click();
                await videoDemoWait(2600);

                setVideoDemoCaption("切到附近模式", "先選擇目前位置，再看 3 km 內真正靠近自己的事件。", "06｜附近 3 km");
                const nearbyToggle = document.getElementById("nearby-toggle-desktop") || document.getElementById("nearby-toggle-mobile");
                frameVideoDemoElement(nearbyToggle || "#map-stage", 14);
                await moveVideoDemoCursorTo(nearbyToggle || "#map-stage", "center", 420);
                pulseVideoDemoClick(nearbyToggle || "#map-stage");
                await videoDemoWait(250);
                activateVideoDemoNearbyMode();
                setVideoDemoRange(true, "#map-stage", 3000);
                requestAnimationFrame(() => setVideoDemoRange(true, "#map-stage", 3000));
                setTimeout(() => setVideoDemoRange(true, "#map-stage", 3000), 720);
                frameVideoDemoElement("#map-stage", 14);
                await videoDemoWait(5200);

                setVideoDemoCaption("調整關注範圍", "把 3 km 切成 5 km，地圖圓圈放大，事件清單同步納入更遠的影響。", "07｜半徑 5 km");
                const radiusSelect = document.getElementById("nearby-radius-desktop") || document.getElementById("nearby-radius-mobile");
                frameVideoDemoElement(radiusSelect || "#map-stage", 14);
                await moveVideoDemoCursorTo(radiusSelect || "#map-stage", "center", 420);
                pulseVideoDemoClick(radiusSelect || "#map-stage");
                await videoDemoWait(250);
                if (radiusSelect) {
                    radiusSelect.value = "5000";
                    radiusSelect.dispatchEvent(new Event("change", { bubbles: true }));
                } else {
                    setNearbyRadius(5000);
                }
                setVideoDemoRange(true, "#map-stage", 5000);
                requestAnimationFrame(() => setVideoDemoRange(true, "#map-stage", 5000));
                await videoDemoWait(3300);

                setVideoDemoCaption("共同修正資料", "使用者可補充錯誤位置或分類，送出回報後進入資料覆核流程。", "08｜回報修正");
                setVideoDemoRange(false);
                isNearbyMode = false;
                userLocation = null;
                clearUserLocationMarker();
                activeCategory = "all";
                renderCategoryButtons();
                renderEvents();
                eventList.scrollTop = 0;
                await videoDemoWait(250);
                const reportCard = getVideoDemoCard(VIDEO_DEMO_REPORT_EVENT_ID);
                const reportButton = reportCard?.querySelector('[data-action="open-report"]') || eventList.querySelector('[data-action="open-report"]');
                frameVideoDemoElement(reportButton || reportCard || "#event-list", 12);
                await moveVideoDemoCursorTo(reportButton || reportCard || "#event-list", "center", 420);
                pulseVideoDemoClick(reportButton || reportCard || "#event-list");
                openVideoDemoReportModal();
                await videoDemoWait(1500);
                frameVideoDemoElement("#report-modal .modal-box", 16);
                const submitButton = document.getElementById("report-submit-btn");
                await moveVideoDemoCursorTo(submitButton || "#report-modal .modal-box", "center", 350);
                pulseVideoDemoClick(submitButton || "#report-modal .modal-box");
                if (submitButton) submitButton.click();
                await waitForVideoDemoReportSubmitLayout(submitButton);
                frameVideoDemoElement(submitButton || "#report-modal .modal-box", 10);
                await moveVideoDemoCursorTo(submitButton || "#report-modal .modal-box", "center", 0);
                await videoDemoWait(3800);
                closeReportModal();
                await videoDemoWait(300);

                shell.frame.classList.remove("visible");
                shell.cursor.classList.remove("visible");
                setVideoDemoCaption("從分散資訊，到可以採取行動的在地判斷。", "看見、理解、行動、共同修正。", "09｜Island Pulse");
                setVideoDemoFinalSummary();
                setVideoDemoSummary(true);
                await videoDemoWait(4500);
                setVideoDemoSummary(false);
            } while (VIDEO_DEMO_LOOP);
        } catch (error) {
            console.error("[video-demo] sequence failed", error);
        } finally {
            shell.frame.classList.remove("visible");
            shell.cursor.classList.remove("visible");
            setVideoDemoRange(false);
            window.VIDEO_DEMO_DONE = true;
        }
    }

    async function startVideoDemoWhenReady(dataPromise) {
        if (!VIDEO_DEMO_ROUTE || videoDemoStarted) return;
        videoDemoStarted = true;
        document.documentElement.classList.add("video-demo-mode");
        document.body.classList.add("video-demo-mode");
        try {
            await dataPromise;
        } catch {
            // syncNewsAndRender already falls back to mock data.
        }
        const hasCards = await videoDemoWaitFor(() => parsedEvents.length && document.querySelector(".event-card-v2"), 10000);
        if (!hasCards) {
            console.warn("[video-demo] cards not ready; forcing fixed demo events");
            parsedEvents = deduplicateEvents(VIDEO_DEMO_EVENTS.map(normalizeDisplayEvent));
            renderCategoryButtons();
            renderEvents();
        }
        const hasMap = await videoDemoWaitFor(() => window._fallbackMap || !map || !map.isStyleLoaded || map.isStyleLoaded(), 10000);
        if (!hasMap) console.warn("[video-demo] map style not ready; continuing with overlay demo");
        await videoDemoWait(700);
        runVideoDemoSequence();
    }

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
            btn.innerHTML='支持維護'; btn.disabled=false;
        }
    }

    // ── EVENTS ───────────────────────────────────────────────
    bindDelegatedActions(document, {
        donate(event, target) {
            event.preventDefault();
            event.stopPropagation();
            handleDonate(Number(target.dataset.donateAmount || 100), target);
        },
        "open-report"(event, target) {
            event.preventDefault();
            event.stopPropagation();
            const payload = readReportPayload(target);
            trackEvent("report_open", { sourceType: "event_card" });
            openReportModal(payload.identifier, payload.title);
        },
        "manual-refresh-empty"(event) {
            event.preventDefault();
            trackEvent("manual_refresh", {});
            eventDataManager.refresh({ manual: true });
        },
        "report-submission"(event, target) {
            event.preventDefault();
            event.stopPropagation();
            openSubmissionReportModal(target.dataset.submissionId || "");
        },
        "toggle-sources"(event, target) {
            event.preventDefault();
            event.stopPropagation();
            target.nextElementSibling?.classList.toggle("visible");
        },
        react(event, target) {
            const payload = readReactionPayload(target);
            if (!payload.eventId || !payload.type) return;
            handleReactClick(event, payload.eventId, payload.type, target);
        }
    });
    window.openReportModal=openReportModal;
    window.handleDonate=handleDonate;

    const debouncedHandleSearch = debounce(handleSearch, 180);
    document.getElementById("event-search")?.addEventListener("input", debouncedHandleSearch);
    document.getElementById("event-search-mobile")?.addEventListener("input", debouncedHandleSearch);
    document.getElementById("city-filter").addEventListener("change",e=>syncCityFilter(e.target.value));
    document.getElementById("city-filter-mobile").addEventListener("change",e=>syncCityFilter(e.target.value));
    ["manual-refresh-btn", "manual-refresh-btn-mobile"].forEach((id) => {
        document.getElementById(id)?.addEventListener("click", () => {
            trackEvent("manual_refresh", {});
            eventDataManager.refresh({ manual: true });
        });
    });
    document.addEventListener("visibilitychange", () => eventDataManager.onVisibilityChange());
    window.addEventListener("pagehide", () => eventDataManager.stop(), { once: true });
    document.getElementById("btn-tw")?.addEventListener("click",()=>switchMode(true));
    document.getElementById("btn-global")?.addEventListener("click",()=>switchMode(false));
    document.getElementById("btn-tw-mobile")?.addEventListener("click",()=>switchMode(true));
    document.getElementById("btn-global-mobile")?.addEventListener("click",()=>switchMode(false));
    document.getElementById("btn-dark")?.addEventListener("click",()=>switchTheme("dark"));
    document.getElementById("btn-light")?.addEventListener("click",()=>switchTheme("light"));
    document.getElementById("btn-dark-mobile")?.addEventListener("click",()=>switchTheme("dark"));
    document.getElementById("btn-light-mobile")?.addEventListener("click",()=>switchTheme("light"));
    document.getElementById("drawer-handle").addEventListener("click",toggleDrawer);
    document.getElementById("report-cancel-btn").addEventListener("click",closeReportModal);
    document.getElementById("report-submit-btn").addEventListener("click",submitReportWithReview);
    document.getElementById("nearby-toggle-mobile")?.addEventListener("click", requestNearbyLocation);
    document.getElementById("nearby-toggle-desktop")?.addEventListener("click", requestNearbyLocation);
    document.addEventListener("click", (event) => {
        if (event.target.closest(".card-action-btn.link, .popup-btn-v2.primary")) trackEvent("source_link_open", { sourceType: "external" });
        if (event.target.closest(".mobile-submit-event-btn")) trackEvent("submission_entry_click", {});
        if (event.target.closest(".donate-btn")) trackEvent("donation_click", {});
    }, true);
    document.getElementById("nearby-radius-mobile")?.addEventListener("change", (e) => setNearbyRadius(e.target.value));
    document.getElementById("nearby-radius-desktop")?.addEventListener("change", (e) => setNearbyRadius(e.target.value));
    document.getElementById("alert-zone-add-current")?.addEventListener("click", requestAlertZoneLocation);
    document.getElementById("alert-zone-type")?.addEventListener("change", updateAlertZoneLabelPlaceholder);
    document.getElementById("alert-zone-list")?.addEventListener("click", handleAlertZoneListClick);
    document.getElementById("alert-zone-list")?.addEventListener("change", handleAlertZoneListChange);
    document.getElementById("alert-zone-filter-toggle")?.addEventListener("click", () => {
        if (!enabledAlertZones().length) return;
        alertZoneFilterEnabled = !alertZoneFilterEnabled;
        renderEvents();
    });
    
    document.getElementById("mode-normal-btn")?.addEventListener("click", () => {
        applyMapMode("normal");
        closeBetaModal();
    });
    document.getElementById("mode-online-btn")?.addEventListener("click", () => {
        applyMapMode("online");
        closeBetaModal();
    });
    document.getElementById("settings-btn")?.addEventListener("click", () => {
        renderAlertZoneSettings();
        settingsModal.classList.add("visible");
    });
    document.getElementById("settings-btn-mobile")?.addEventListener("click", () => {
        renderAlertZoneSettings();
        settingsModal.classList.add("visible");
    });
    document.getElementById("settings-close-btn")?.addEventListener("click", () => {
        settingsModal.classList.remove("visible");
    });
    document.getElementById("map-mode-select")?.addEventListener("change", (e) => {
        if (document.body.classList.contains("stats-mode")) switchMode(true);
        applyMapMode(e.target.value);
        settingsModal.classList.remove("visible");
    });
    ["time-range", "time-range-mobile"].forEach((id) => document.getElementById(id)?.addEventListener("change", (event) => {
        activeTimeRange = event.target.value;
        ["time-range", "time-range-mobile"].forEach((peer) => { const input = document.getElementById(peer); if (input) input.value = activeTimeRange; });
        renderEvents();
    }));
    document.getElementById("upcoming-toggle-mobile")?.addEventListener("change", (event) => { showUpcomingEvents = event.target.checked; renderEvents(); });
    document.getElementById("search-map-area-btn")?.addEventListener("click", () => {
        appliedMapBounds = normalizeBounds(map.getBounds());
        mapBoundsDirty = false;
        document.getElementById("search-map-area-btn")?.setAttribute("hidden", "");
        document.getElementById("clear-map-area-btn")?.removeAttribute("hidden");
        renderEvents();
    });
    document.getElementById("clear-map-area-btn")?.addEventListener("click", () => {
        appliedMapBounds = null;
        document.getElementById("clear-map-area-btn")?.setAttribute("hidden", "");
        renderEvents();
    });
    const mapHelp = document.getElementById("map-help-card");
    if (localStorage.getItem("map_help_dismissed") === "true") mapHelp?.setAttribute("hidden", "");
    document.getElementById("map-help-close")?.addEventListener("click", () => { localStorage.setItem("map_help_dismissed", "true"); mapHelp?.setAttribute("hidden", ""); });
    document.getElementById("settings-stats-btn")?.addEventListener("click", () => { switchMode(false); settingsModal.classList.remove("visible"); });
    document.getElementById("settings-refresh-btn")?.addEventListener("click", () => eventDataManager.refresh({ manual: true }));
    document.getElementById("settings-theme-btn")?.addEventListener("click", () => switchTheme(document.body.classList.contains("light-mode") ? "dark" : "light"));

    document.getElementById("beta-close-btn")?.addEventListener("click",closeBetaModal);
    reportModal.addEventListener("click",e=>{ if(e.target===reportModal) closeReportModal(); });
    betaModal.addEventListener("click",e=>{ if(e.target===betaModal) closeBetaModal(); });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        if (reportModal.classList.contains("visible")) closeReportModal();
        else if (settingsModal.classList.contains("visible")) settingsModal.classList.remove("visible");
        else if (betaModal.classList.contains("visible")) closeBetaModal();
    });

    function bootstrapApp(){
        if (VIDEO_DEMO_ROUTE) {
            document.documentElement.classList.add("video-demo-mode");
            document.body.classList.add("video-demo-mode");
            currentMapMode = "normal";
        }
        populateCityFilters();
        removeMapOverlays();
        initMobileFilterCollapse();
        if (isMobileViewport() && !document.body.classList.contains("stats-mode")) {
            newsSidebar.classList.add("drawer-collapsed");
        }
        checkBetaModal();
        applyMapMode(currentMapMode); // 套用快取的模式
        updateNearbyControls();
        renderAlertZoneSettings();
        renderAlertZoneSummary();
        updateNearbyControls();
        const dataPromise = VIDEO_DEMO_ROUTE ? syncNewsAndRender() : eventDataManager.start();
        loadTwGeoJSON();
        if (VIDEO_DEMO_ROUTE) startVideoDemoWhenReady(dataPromise);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bootstrapApp, { once: true });
    } else {
        bootstrapApp();
    }
