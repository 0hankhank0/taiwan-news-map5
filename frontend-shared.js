(function () {
  const CATEGORY_CONFIG = {
    all: { text: "?券", icon: "fa-list", color: "#4A5878" },
    disaster: { text: "?賢拿鈭?", icon: "fa-triangle-exclamation", color: "#C0392B" },
    criminal: { text: "??獢辣", icon: "fa-handcuffs", color: "#8E44AD" },
    traffic: { text: "鈭日???", icon: "fa-car-burst", color: "#2471A3" },
    medical: { text: "?怎?蝺?", icon: "fa-truck-medical", color: "#D35400" },
    activity: { text: "瘣餃?", icon: "fa-users", color: "#1E8449" },
    other: { text: "?嗡?鈭辣", icon: "fa-circle-info", color: "#4A5878" }
  };

  const CAT_META = {
    disaster: { rgba: "192,57,43", tint: "#E8856A", cssVar: "--cat-disaster" },
    criminal: { rgba: "142,68,173", tint: "#BB8FCE", cssVar: "--cat-criminal" },
    traffic: { rgba: "36,113,163", tint: "#7FB3D3", cssVar: "--cat-traffic" },
    medical: { rgba: "211,84,0", tint: "#F0B27A", cssVar: "--cat-medical" },
    activity: { rgba: "30,132,73", tint: "#58D68D", cssVar: "--cat-activity" },
    other: { rgba: "74,88,120", tint: "#AEB6BF", cssVar: "--cat-other" },
    accident: { rgba: "142,68,173", tint: "#BB8FCE", cssVar: "--cat-criminal" },
    construction: { rgba: "211,84,0", tint: "#F0B27A", cssVar: "--cat-medical" }
  };

  const TW_ONLINE_CATEGORIES = {
    all: { text: "?券霅血", icon: "fa-list", color: "#475569" },
    traffic: { text: "???憛?", icon: "fa-car-burst", color: "#4f8cff" },
    accident: { text: "PK 鈭辣", icon: "fa-handcuffs", color: "#f05a5a" },
    construction: { text: "隡箸??函雁霅?", icon: "fa-wrench", color: "#fb923c" },
    disaster: { text: "蝺亥郎??", icon: "fa-triangle-exclamation", color: "#dc2626" },
    activity: { text: "??隞餃?", icon: "fa-users", color: "#34d399" },
    other: { text: "蝟餌絞?砍?", icon: "fa-circle-info", color: "#6b7280" }
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
    "TDX CMS": { text: "TDX ?單?頝舀?", shortText: "TDX", bg: "rgba(15,118,110,0.2)", color: "#5eead4" },
    RSS: { text: "RSS ?啗?鈭辣", shortText: "RSS", bg: "rgba(29,78,216,0.2)", color: "#93c5fd" },
    news: { text: "AI ?瑕?鈭辣", shortText: "AI", bg: "rgba(124,58,237,0.2)", color: "#c4b5fd" },
    default: { text: "?嗡?靘?", shortText: "?嗡?", bg: "rgba(71,85,105,0.25)", color: "#94a3b8" }
  };

  const CITY_OPTIONS = [
    { value: "?粹?", label: "?粹?撣?" }, { value: "?啣?", label: "?啣?撣?" }, { value: "?啣?", label: "?啣?撣?" },
    { value: "獢?", label: "獢?撣?" }, { value: "?啁姘", label: "?啁姘蝮??" }, { value: "??", label: "??蝮?" },
    { value: "?唬葉", label: "?唬葉撣?" }, { value: "敶啣?", label: "敶啣?蝮?" }, { value: "??", label: "??蝮?" },
    { value: "?脫?", label: "?脫?蝮?" }, { value: "?儔", label: "?儔蝮??" }, { value: "?啣?", label: "?啣?撣?" },
    { value: "擃?", label: "擃?撣?" }, { value: "撅", label: "撅蝮?" }, { value: "摰", label: "摰蝮?" },
    { value: "?梯", label: "?梯蝮?" }, { value: "?唳", label: "?唳蝮?" }, { value: "瞉?", label: "瞉?蝮?" },
    { value: "??", label: "??蝮?" }, { value: "???", label: "???蝮?" },
    { value: "??", label: "?? (擃頝?" }, { value: "??", label: "??" }
  ];

  const BAR_COLORS = ["#4f8cff", "#a78bfa", "#34d399", "#fb923c", "#f05a5a", "#fbbf24", "#5eead4", "#c4b5fd", "#86efac", "#fdba74"];

  const CAT_COLORS = {
    traffic: { bg: "rgba(79,140,255,0.15)", color: "#4f8cff", text: "鈭日???" },
    accident: { bg: "rgba(79,140,255,0.15)", color: "#4f8cff", text: "鈭日???" },
    disaster: { bg: "rgba(240,90,90,0.15)", color: "#f05a5a", text: "?賢拿鈭?" },
    criminal: { bg: "rgba(240,90,90,0.15)", color: "#f05a5a", text: "??獢辣" },
    medical: { bg: "rgba(251,146,60,0.15)", color: "#fb923c", text: "?怎?蝺?" },
    construction: { bg: "rgba(251,191,36,0.15)", color: "#fbbf24", text: "?賢極蝞∪" },
    activity: { bg: "rgba(52,211,153,0.15)", color: "#34d399", text: "瘣餃?" },
    other: { bg: "rgba(107,114,128,0.15)", color: "#6b7280", text: "?嗡?" }
  };

  function normalizeText(v) {
    return String(v || "").trim();
  }

  function tryParseJson(t, fb) {
    try {
      return t ? JSON.parse(t) : fb;
    } catch {
      return fb;
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

  function formatEventTime(ev) {
    const raw = ev.updatedAt || ev.publishedAt || ev.time || ev.createdAt;
    if (!raw) return "";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function isValidTaiwanCoord(lat, lng) {
    return lat >= 21 && lat <= 26.5 && lng >= 118 && lng <= 123;
  }

  window.TNM_SHARED = {
    CATEGORY_CONFIG,
    CAT_META,
    TW_ONLINE_CATEGORIES,
    CATEGORY_MAP,
    FIXED_CATEGORY_ORDER,
    SOURCE_CONFIG,
    CITY_OPTIONS,
    BAR_COLORS,
    CAT_COLORS,
    normalizeText,
    tryParseJson,
    normalizeSource,
    formatEventTime,
    isValidTaiwanCoord,
  };
})();
