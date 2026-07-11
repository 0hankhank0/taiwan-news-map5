(function initEventContentFilter(root, factory) {
  if (typeof module === "object" && module.exports && !(root && root.document)) {
    module.exports = factory();
  } else {
    root.TNM_EVENT_CONTENT_FILTER = factory();
    if (root.document?.documentElement) root.document.documentElement.dataset.tnmEventContentFilter = "ready";
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function eventContentFilterFactory() {
  const VISIBILITY = {
    VISIBLE: "visible",
    LOW_REALTIME_HIDDEN: "low_realtime_hidden",
    VISIBLE_POLICY_IMPACT: "visible_policy_impact",
  };

  const POLICY_OR_INSTITUTIONAL_PATTERN = /制度|政策|補助|申請|修法|預算|會議|論壇|統計|表揚|撥款|禮金|津貼|福利|資格|名冊|公告|行政服務|申辦|領取|發放|補發|入帳|線上填寫|多元領取|法案|條例|自治條例|辦法|規範|施政|計畫|方案|措施|專案|成果|政績|招商|招標|採購|補強計畫|說明會|公聽會|座談會|研討會|記者會|宣導|呼籲|提醒|核定|審議|審查|通過|三讀|編列|追加預算|決算|績效|民調|排名|評鑑|表揚|頒獎|視察|考察|拜會|爭取|盤點/;
  const GOVERNMENT_ACTOR_PATTERN = /市府|縣府|縣市政府|區公所|鄉公所|鎮公所|公所|局處|中央|行政院|立法院|議會|市議會|縣議會|部會|委員會|交通部|經濟部|教育部|農業部|衛福部|勞動部|內政部|環境部|文化部|觀光署|水利署|農糧署|工務局|社會局|民政局|教育局|都發局|警察局|消防局/;
  const GOVERNMENT_PROCESS_PATTERN = /宣布|公布|表示|指出|說明|推動|研議|規劃|辦理|啟動|核定|補助|發放|撥款|編列|追加|通過|審查|審議|宣導|提醒|呼籲|舉行|召開|視察|考察|拜會|爭取|成立|表揚|頒獎|受理|開放申請|受理申請|徵件|開辦|開課|招生|開放報名|受理報名/;
  const RECAP_OR_BACKGROUND_PATTERN = /回顧|盤點|懶人包|昔日|周年|週年|歷史|判決回顧|專題整理|整理|懷舊|往事|一文看懂|懶人整理/;
  const DIRECT_IMPACT_PATTERN = /封路|交通管制|管制|停水|停電|停班停課|停課|停班|疏散|撤離|改道|搶修|災害|公共安全|今日生效|今天生效|即日生效|警戒|停駛|停航|停運|封閉|禁止通行|交通影響|影響交通|道路中斷|積淹水|淹水|坍方|土石流|危險設施|拆除|颱風|豪雨|警報|火警|火災|爆炸|有毒氣體|避難|停車管制|人潮管制|大規模影響/;
  const OPERATIONAL_IMPACT_PATTERN = /封路|交通管制|管制|停水|停電|停班停課|停課|停班|疏散|撤離|改道|搶修|災害|公共安全|今日生效|今天生效|即日生效|警戒|停駛|停航|停運|封閉|禁止通行|交通影響|影響交通|道路中斷|積淹水|淹水|坍方|土石流|危險設施|拆除|颱風|豪雨|警報|火警|火災|爆炸|有毒氣體|避難|停車管制|人潮管制|大規模影響/;
  const CONSUMER_OR_ADMIN_SERVICE_PATTERN = /吃到|異物|保麗龍|客訴|消費糾紛|消費爭議|店家|店員|服務態度|評價|退費|退款|禮金|撥款|領取|發放|補發|入帳|申辦|線上填寫|多元領取|資格|名冊|福利|津貼/;
  const LOW_PUBLIC_VALUE_PATTERN = /水蜜桃.*(熱銷|滯銷|買氣|盛產|澄清)|農產.*(熱銷|滯銷|產銷|澄清)|文蛤.*(暴斃|救助|育苗|損失)|養殖.*(暴斃|救助|育苗|損失)|產業損失|農損|漁損|飛彈車|軍事部署|國軍.*(進駐|演訓|操演)|軍演/;
  const ACTIVITY_PATTERN = /活動|演唱會|音樂祭|展覽|展會|市集|賽事|路跑|球賽|煙火|燈會|祭典|遶境|卡司|售票|開賣|場館|舞台|大型活動/;

  function normalizeText(value) {
    return String(value || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&[a-zA-Z0-9#]+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function eventToText(input) {
    if (typeof input === "string") return normalizeText(input);
    if (!input || typeof input !== "object") return "";
    return normalizeText([
      input.title,
      input.content,
      input.summary,
      input.description,
      input.text,
      input.location,
      input.address,
      input.venue,
      input.city,
      input.category,
    ].filter(Boolean).join(" "));
  }

  function classifyEventVisibility(input) {
    const text = eventToText(input);

    if (CONSUMER_OR_ADMIN_SERVICE_PATTERN.test(text) && !DIRECT_IMPACT_PATTERN.test(text)) {
      return { visibility: VISIBILITY.LOW_REALTIME_HIDDEN, reason: "consumer-or-admin-service" };
    }

    if (LOW_PUBLIC_VALUE_PATTERN.test(text) && !DIRECT_IMPACT_PATTERN.test(text)) {
      return { visibility: VISIBILITY.LOW_REALTIME_HIDDEN, reason: "low-public-value" };
    }

    if (DIRECT_IMPACT_PATTERN.test(text)) {
      return { visibility: VISIBILITY.VISIBLE_POLICY_IMPACT, reason: "direct-impact" };
    }

    const hasActivitySignal = ACTIVITY_PATTERN.test(text);
    if (hasActivitySignal && hasUsableLocation(input)) {
      return { visibility: VISIBILITY.VISIBLE, reason: "activity-with-location" };
    }

    const hasRecapSignal = RECAP_OR_BACKGROUND_PATTERN.test(text);
    const hasGovernmentProcessSignal = GOVERNMENT_ACTOR_PATTERN.test(text) && GOVERNMENT_PROCESS_PATTERN.test(text);
    const hasLowRealtimeSignal = POLICY_OR_INSTITUTIONAL_PATTERN.test(text) || hasGovernmentProcessSignal || hasRecapSignal;
    if (!hasLowRealtimeSignal) {
      return { visibility: VISIBILITY.VISIBLE, reason: "live-event" };
    }

    if (hasRecapSignal && !OPERATIONAL_IMPACT_PATTERN.test(text)) {
      return { visibility: VISIBILITY.LOW_REALTIME_HIDDEN, reason: "recap-or-background" };
    }

    const reason = hasRecapSignal ? "recap-or-background" : "institutional";
    return { visibility: VISIBILITY.LOW_REALTIME_HIDDEN, reason };
  }

  function shouldShowEvent(input) {
    return classifyEventVisibility(input).visibility !== VISIBILITY.LOW_REALTIME_HIDDEN;
  }

  function hasUsableLocation(input) {
    if (!input || typeof input !== "object") return false;
    const lat = Number(input.lat ?? input.latitude);
    const lng = Number(input.lng ?? input.lon ?? input.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return true;
    return Boolean(normalizeText([input.location, input.address, input.venue, input.city].filter(Boolean).join(" ")));
  }

  function isLowRealtimeEvent(input) {
    return classifyEventVisibility(input).visibility === VISIBILITY.LOW_REALTIME_HIDDEN;
  }

  return {
    VISIBILITY,
    classifyEventVisibility,
    isLowRealtimeEvent,
    shouldShowEvent,
  };
});
