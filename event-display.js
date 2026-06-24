(function initEventDisplay(root, factory) {
  if (typeof module === "object" && module.exports && !(root && root.document)) {
    module.exports = factory();
  } else {
    root.TNM_EVENT_DISPLAY = factory();
    if (root.document?.documentElement) root.document.documentElement.dataset.tnmEventDisplay = "ready";
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function eventDisplayFactory() {
  const CATEGORY_GROUPS = {
    traffic: "traffic",
    construction: "traffic",
    roadwork: "traffic",
    accident: "accident",
    incident: "accident",
    safety: "accident",
    publicsafety: "accident",
    "public-safety": "accident",
    criminal: "accident",
    crime: "accident",
    police: "accident",
    medical: "accident",
    fire: "accident",
    disaster: "disaster",
    earthquake: "disaster",
    typhoon: "disaster",
    weather: "disaster",
    climate: "disaster",
    activity: "activity",
    event: "activity",
    market: "activity",
    exhibition: "activity",
    sports: "activity",
    news: "other",
    other: "other",
  };

  const STATUS_LABELS = {
    active: "影響中",
    upcoming: "未來活動",
    resolved: "已解除",
    cleared: "已解除",
    expired: "已過期",
  };

  const REVIEW_STATE_LABELS = {
    unreviewed: "未覆核",
    pending_review: "待人工覆核",
    reviewed: "已人工覆核",
    merged: "已合併",
    rejected: "已退回",
  };

  function normalizeText(value, fallback = "") {
    return String(value ?? fallback).replace(/\s+/g, " ").trim();
  }

  function eventText(event) {
    if (typeof event === "string") return normalizeText(event);
    if (!event || typeof event !== "object") return "";
    return normalizeText([
      event.title,
      event.content,
      event.summary,
      event.description,
      event.text,
      event.location,
      event.address,
      event.venue,
      event.city,
      event.district,
      event.category,
      event.groupCategory,
      event.type,
    ].filter(Boolean).join(" "));
  }

  function normalizeCategory(value) {
    const category = normalizeText(value, "other").toLowerCase().replace(/_/g, "-");
    return CATEGORY_GROUPS[category] ? category : "other";
  }

  function resolveGroupCategory(input) {
    const raw = normalizeText(
      typeof input === "string" ? input : (input?.groupCategory || input?.category || input?.type || "other"),
      "other"
    ).toLowerCase().replace(/_/g, "-");
    const text = eventText(input);
    if (["traffic", "construction", "roadwork", "road", "congestion", "jam"].includes(raw)
      && /(車禍|交通事故|追撞|擦撞|對撞|自撞|撞上|翻車|摔車|肇事|事故.*(傷|死|送醫)|死亡|傷亡)/.test(text)) {
      return "accident";
    }

    const direct = CATEGORY_GROUPS[raw];
    if (direct && direct !== "other") return direct;

    if (/(活動|展覽|市集|演唱會|球賽|賽事|路跑|表演|節慶)/.test(text)) return "activity";
    if (/(地震|颱風|豪雨|大雨|淹水|積水|土石流|落石|坍方|災害|災情|強風|停班停課)/.test(text)) return "disaster";
    if (/(車禍|交通事故|追撞|擦撞|對撞|自撞|撞上|翻車|摔車|肇事|事故.*(傷|死|送醫)|死亡|傷亡|火災|火警|爆炸|氣爆|工安|墜落|溺水|刑案|搶劫|殺人|攻擊)/.test(text)) return "accident";
    if (/(交通|路況|施工|封路|管制|壅塞|塞車|國道|省道|公車|捷運|台鐵|高鐵)/.test(text)) return "traffic";
    return direct || "other";
  }

  function parseTime(value) {
    if (!value) return null;
    const timestamp = typeof value === "number" ? value : Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function deriveEventStatus(event) {
    const raw = normalizeText(event?.status).toLowerCase();
    if (raw && raw !== "unknown") return raw;
    const now = Date.now();
    const startAt = parseTime(event?.startsAt || event?.startAt);
    const endAt = parseTime(event?.endsAt || event?.endAt || event?.expiresAt);
    if (endAt && endAt < now) return "expired";
    if (startAt && startAt > now) return "upcoming";
    return "active";
  }

  function parseFutureActivityDate(event) {
    const raw = event?.startsAt || event?.startAt || "";
    const direct = raw ? new Date(raw) : null;
    if (direct && !Number.isNaN(direct.getTime())) return direct;
    const match = eventText(event).match(/(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|號)/);
    if (!match) return null;
    const now = new Date();
    const candidate = new Date(now.getFullYear(), Number(match[1]) - 1, Number(match[2]), 0, 0, 0);
    if (candidate.getTime() + 24 * 60 * 60 * 1000 < now.getTime()) candidate.setFullYear(candidate.getFullYear() + 1);
    return candidate;
  }

  function isFutureActivity(event) {
    if (resolveGroupCategory(event) !== "activity") return false;
    const date = parseFutureActivityDate(event);
    return Boolean(date && date.getTime() > Date.now() + 6 * 60 * 60 * 1000);
  }

  function getEventStatusLabel(event) {
    const status = deriveEventStatus(event);
    if (isFutureActivity(event) || status === "upcoming") return STATUS_LABELS.upcoming;
    if (STATUS_LABELS[status]) return STATUS_LABELS[status];

    const text = eventText(event);
    if (/已解除|恢復通行|搶修完成|解除|恢復供電|恢復正常/.test(text)) return "已解除";
    if (/管制|封閉|中斷|停駛|停班停課|施工中|搶修中|處理中/.test(text)) return "影響中";
    if (/注意|提醒|預警|可能|預計|將於/.test(text)) return "注意";
    return "待確認";
  }

  function deriveEventImpact(event, category = resolveGroupCategory(event)) {
    const text = eventText(event);
    if (category === "activity") return "活動期間周邊可能有人潮與交通變化。";
    if (category === "traffic" || /施工|封路|管制|壅塞|塞車/.test(text)) return "周邊道路可能壅塞或受管制影響。";
    if (category === "accident") return "現場周邊通行與安全可能受影響。";
    if (category === "disaster" || /火災|淹水|坍方|地震|停電|停水/.test(text)) return "周邊民生、交通或安全可能受影響。";
    return "此事件可能影響周邊活動與通行。";
  }

  function deriveEventAdvice(event, category = resolveGroupCategory(event)) {
    const text = eventText(event);
    if (category === "activity") return "前往前請確認活動頁公告、交通方式與入場時間。";
    if (category === "traffic" || /封閉|管制|壅塞|塞車|改道/.test(text)) return "行經附近請放慢車速，必要時提前改道。";
    if (category === "accident") return "避開事故現場，依警方或現場人員指揮通行。";
    if (category === "disaster" || /火災|淹水|坍方|土石流|地震/.test(text)) return "避免靠近危險區域，留意官方最新公告。";
    return "前往附近前先確認最新資訊。";
  }

  function getEventAdviceLabel(event) {
    const category = resolveGroupCategory(event);
    const text = eventText(event);
    const status = getEventStatusLabel(event);
    if (category === "activity") {
      return /管制|人潮|路跑|賽事|封街|演唱會|展覽|活動/.test(text)
        ? "前往前確認時間、交通與入場資訊"
        : "前往前確認時間與地點";
    }
    if (event?.advice) return normalizeText(event.advice);
    if (status === "已解除") return "事件已解除，仍請確認最新現場狀況";
    return deriveEventAdvice(event, category);
  }

  function getEventImpactTags(event) {
    const text = eventText(event);
    const category = resolveGroupCategory(event);
    const tags = [];
    const add = (label) => { if (!tags.includes(label)) tags.push(label); };
    if (category === "traffic" || /交通|道路|車禍|封閉|管制|壅塞|塞車|國道|省道/.test(text)) add("交通");
    if (/人潮|活動|市集|演唱會|賽事|展覽|封街/.test(text) || category === "activity") add("人潮");
    if (/停水|停電|停班停課|停駛|停航|停運/.test(text)) add("民生服務");
    if (category === "disaster" || /災害|地震|颱風|豪雨|淹水|坍方|火災|爆炸/.test(text)) add("安全");
    return tags.length ? tags.slice(0, 3) : ["狀態待確認"];
  }

  function getLocationQuality(event) {
    const explicit = normalizeText(event?.locationQuality).toLowerCase();
    if (["high", "medium", "low"].includes(explicit)) return explicit;
    const confidence = Number(event?.locationConfidence);
    if (Number.isFinite(confidence)) {
      if (confidence >= 0.8) return "high";
      if (confidence >= 0.45) return "medium";
      return "low";
    }
    const precision = normalizeText(event?.locationPrecision).toLowerCase();
    if (precision === "exact") return "high";
    if (precision === "district") return "medium";
    return "low";
  }

  function getLocationDisplayMode(event) {
    const explicit = normalizeText(event?.locationDisplayMode).toLowerCase();
    if (["point", "estimated", "list_only"].includes(explicit)) return explicit;
    const quality = getLocationQuality(event);
    const precision = normalizeText(event?.locationPrecision).toLowerCase();
    if (quality === "high" && precision === "exact") return "point";
    if (quality === "medium") return "estimated";
    return "list_only";
  }

  function getLocationConfidenceLabel(event) {
    const confidence = Number(event?.locationConfidence);
    return Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : "";
  }

  function getLocationPrecisionLabel(event) {
    const precision = normalizeText(event?.locationPrecision).toLowerCase();
    const displayMode = getLocationDisplayMode(event);
    const quality = getLocationQuality(event);
    if (displayMode === "list_only" || quality === "low") return "定位待確認";
    if (displayMode === "estimated" || quality === "medium") {
      if (precision === "district") return "區域推估";
      if (precision === "city") return "城市推估";
      return "位置推估";
    }
    if (precision === "exact") return "精準定位";
    return "定位待確認";
  }

  function getReviewStateLabel(event) {
    const state = normalizeText(event?.reviewState).toLowerCase();
    const verified = normalizeText(event?.verifiedStatus).toLowerCase();
    if (REVIEW_STATE_LABELS[state]) return REVIEW_STATE_LABELS[state];
    if (verified === "verified") return "已驗證";
    if (verified === "resolved") return "已解除";
    if (verified === "rejected") return "已退回";
    return "未覆核";
  }

  function getSourceTraceLabel(event) {
    const count = Array.isArray(event?.sourceTrace) ? event.sourceTrace.length : 0;
    const source = normalizeText(event?.sourceName || event?.source || "資料來源");
    return count > 1 ? `${source} +${count - 1}` : source;
  }

  function formatEventTime(event) {
    const raw = event?.updatedAt || event?.publishedAt || event?.time || event?.createdAt;
    if (!raw) return "";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function formatEventDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("zh-TW", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function formatEventDateRange(event) {
    const start = formatEventDateTime(event?.startsAt || event?.startAt);
    const end = formatEventDateTime(event?.endsAt || event?.endAt);
    if (start && end && start !== end) return `${start} - ${end}`;
    return start || end || "";
  }

  return {
    CATEGORY_GROUPS,
    STATUS_LABELS,
    REVIEW_STATE_LABELS,
    normalizeText,
    eventText,
    normalizeCategory,
    resolveGroupCategory,
    deriveEventStatus,
    deriveEventImpact,
    deriveEventAdvice,
    isFutureActivity,
    getEventStatusLabel,
    getEventAdviceLabel,
    getEventImpactTags,
    getLocationQuality,
    getLocationDisplayMode,
    getLocationConfidenceLabel,
    getLocationPrecisionLabel,
    getReviewStateLabel,
    getSourceTraceLabel,
    formatEventTime,
    formatEventDateTime,
    formatEventDateRange,
  };
});
