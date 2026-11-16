const { NEWS_CATEGORIES } = require("./event-categories");

const PUBLIC_CASE_ANALYSIS = /(?:公安|工安|建案|鄰損|大直案).{0,20}(?:法律疑點|法律分析|責任歸屬)/;

const NEWS_RULES = [
  ["politics", "選舉、選戰或政治評論", /政見發表|候選人|選舉|選戰|選情|選前|掃街拜票|競選|造勢|政黨輪替|黨紀|立法院|[市縣]議會/],
  ["politics", "公共案件的法律分析", PUBLIC_CASE_ANALYSIS],
  ["disaster", "天氣或天然災害", /地震|颱風|豪雨|暴雨|淹水|土石流|坍方|坍塌道路|道路坍塌|落石|停班停課/],
  ["crime", "刑案、違法行為或司法追蹤", /縱火|蓄意放火|詐騙|詐欺|竊盜|偷竊|搶劫|性侵|性騷擾|殺人|槍擊|持刀(?:砍|傷|襲)|毒品|通緝犯|遭(?:逮捕|起訴)|(?:偵辦|查辦)(?:刑案|共諜案)|共諜案.{0,12}(?:起訴|判刑|偵辦|約談)/],
  ["accident", "道路或運輸工具事故", /車禍|交通事故|道路事故|(?:汽車|機車|轎車|貨車|拖板車|砂石車|遊覽車|小客車|公車|客運).{0,10}(?:追撞|對撞|相撞|擦撞|自撞|翻覆|翻落|摔落|撞上|起火)|追撞|對撞|自撞|翻車|摔車|連環撞|列車.{0,12}出軌/],
  ["accident", "火警、受傷或現場救援", /火警|火災|失火|起火|氣爆|工安(?:事故|意外)|職災|(?:怪手|挖土機|堆高機|吊車).{0,12}(?:翻覆|傾覆)|墜樓|墜落|溺水|摔傷|跌傷|高山症|登山.{0,10}失聯|(?:吊掛|受困|山難|落海|落水).{0,10}救援/],
  ["livelihood", "民生服務或生活設施", /停水|停電|限水|水質異常|民生物資|(?:運動中心|壘球場|運動館|全民館).{0,16}(?:啟用|開幕)/],
  ["medical", "醫療、公衛或疾病", /健康網|眼部健康|食物中毒|疫情|疫苗|登革熱|流感|確診|醫療疏失|醫療糾紛|急診壅塞|醫院.{0,12}(?:開診|啟用)|疾病篩檢/],
  ["traffic", "通行、道路管制或施工", /塞車|回堵|封路|封街|(?:道路|國道|省道|匝道|車道|隧道|橋梁|橋樑|路段|路口|交流道|交通|車流).{0,16}(?:壅塞|封閉|封鎖|管制|施工|改道|中斷|阻塞)|(?:封閉|封鎖|管制|施工).{0,10}(?:道路|國道|省道|匝道|車道|隧道|路段|路口)|(?:捷運|台鐵|臺鐵|高鐵|列車|航班).{0,12}(?:停駛|誤點|中斷|取消|故障)/],
  ["education", "學校、課程或考試", /學測|統測|會考|招生|入學|教學|校園霸凌|停課|學校.{0,10}(?:開學|合併)/],
  ["economy", "產業、勞資或財經", /勞資爭議|勞資糾紛|股市|匯率|財報|裁員|設廠|企業併購|工會.{0,10}(?:抗議|罷工|控)/],
  ["culture", "文化、娛樂或賽事報導", /展覽|演唱會|市集|球賽|賽事|競賽|(?:救援|棒壘球|邀請)賽|路跑|節慶|音樂節|開唱|影展|星聞|粉絲|電影上映|活動.{0,8}人潮/],
  ["international", "外交或國際事件", /外交會談|國際峰會|聯合國.{0,12}(?:會議|決議)|外國.{0,10}(?:大使|使節).{0,10}(?:訪台|抵台)/],
];

const POLITICAL_CONTEXT = NEWS_RULES[0][2];
const INCIDENT_CATEGORIES = new Set(["disaster", "crime", "traffic", "accident"]);
const SIMULATION = /演練|演習|救援賽/;
const ACTUAL_HARM = /(?:演練|演習|比賽)(?:中|時|期間).{0,24}(?:摔傷|跌傷|墜落|送醫|受傷|昏迷|死亡)|(?:意外|不慎).{0,10}(?:摔傷|跌傷|墜落|送醫|受傷)|真的.{0,6}(?:受傷|起火|火警|送醫)/;
const PREVENTION = /事故預防|預防事故|防災宣導|交通安全宣導|防詐(?:宣導|講座|課程)|(?:詐騙|性騷擾|火災|車禍).{0,6}(?:防治|防制|預防|宣導|統計)/;
const BACKGROUND = /(?:事故|火災|車禍|地震|氣爆|災情).{0,10}(?:回顧|周年|週年|紀念|紀錄片)|(?:回顧|紀念).{0,10}(?:事故|火災|車禍|地震|氣爆)|(?:防災|抗震|防震|減災)(?:教育|展覽|課程|講座)/;
const NATURAL_HAZARD = /淹水|土石流|坍方|坍塌道路|道路坍塌|落石|(?:發生|規模|有感)地震|地震.{0,10}(?:震度|餘震|倒塌)|停班停課/;
const WEATHER_CAUSE = /(?:因|受)(?:強烈)?(?:颱風|豪雨|暴雨)|(?:颱風|豪雨|暴雨|地震).{0,12}(?:造成|導致|引發|釀|致)/;
const NEGATED_INCIDENT = /(?:並無|並未|未有|沒有|並非|不是)(?:發生)?(?:地震|火警|火災|車禍|交通事故|道路事故|淹水|土石流|坍方|氣爆)/g;
const OUTLET_SECTIONS = { politics: "politics", life: "livelihood", business: "economy", entertainment: "culture", sports: "culture", international: "international" };

function outletCategory(event) {
  if (Object.hasOwn(NEWS_CATEGORIES, event.sourceCategory) && event.sourceCategory !== "other") {
    return event.sourceCategory;
  }
  try {
    const { hostname, pathname } = new URL(event.sourceUrl || event.url || event.link);
    const section = pathname.split("/")[2];
    if (hostname === "news.ltn.com.tw" && Object.hasOwn(OUTLET_SECTIONS, section)) return OUTLET_SECTIONS[section];
    return { "ent.ltn.com.tw": "culture", "sports.ltn.com.tw": "culture", "health.ltn.com.tw": "medical", "ec.ltn.com.tw": "economy" }[hostname];
  } catch {
    return undefined;
  }
}

function matchNewsRules(text, lead = "") {
  const evidence = text.replace(NEGATED_INCIDENT, "");
  const contextOnly = PREVENTION.test(text) || BACKGROUND.test(text);
  const simulation = SIMULATION.test(text);
  if (simulation && ACTUAL_HARM.test(evidence)) return ["accident", "演習或比賽中發生實際傷害"];
  const matches = NEWS_RULES.filter(([category, , pattern]) => {
    if (INCIDENT_CATEGORIES.has(category) && (contextOnly || simulation)) return false;
    return pattern.test(INCIDENT_CATEGORIES.has(category) ? evidence : text);
  });
  const incident = matches.find(([category]) => INCIDENT_CATEGORIES.has(category));
  if (!incident || contextOnly) return matches[0];

  const physicalAccident = matches.find(([category]) => category === "accident" || category === "crime");
  const weatherIsBackground = incident[0] === "disaster" && physicalAccident
    && !NATURAL_HAZARD.test(evidence) && !WEATHER_CAUSE.test(`${evidence} ${lead}`);
  if (PUBLIC_CASE_ANALYSIS.test(text) && !/今[日天]|剛剛|稍早|現場仍/.test(text)) return matches[0];
  return weatherIsBackground ? physicalAccident : incident;
}

function getNewsEvidence(event) {
  const title = String(event.title || "").normalize("NFKC");
  const summary = String(event.summary || event.content || "").normalize("NFKC").slice(0, 350);
  // Google News RSS summaries often concatenate several linked headlines.
  // Those can describe different events and are unsafe classification input.
  const sourceUrl = String(event.sourceUrl || event.url || event.link || "");
  const isAggregatedSummary = /^https?:\/\/news\.google\.com\//i.test(sourceUrl);
  const lead = isAggregatedSummary ? "" : summary.split(/[。！？!?\n]/u, 1)[0];
  return { title, summary, lead, isAggregatedSummary };
}

const TRAFFIC_IMPACT = /塞車|車流回堵|封路|封街|交通管制|(?:道路|國道|省道|車道|隧道|路口|路段|匝道|交流道|[台臺]\d+線|捷運|台鐵|臺鐵|高鐵|列車|航班).{0,14}(?:封閉|封鎖|管制|改道|壅塞|中斷|停駛|誤點|取消)|(?:雙向|單向|全線).{0,5}(?:封閉|封鎖|中斷)/;
const UNCERTAIN_TRAFFIC = /未(?:實施|進行)?(?:封路|封街|封閉|管制|改道|停駛)|(?:不影響|尚未|並未|沒有|無須|無需|可能|預計視情況|過去曾).{0,18}(?:封閉|封路|封街|管制|壅塞|回堵|改道|中斷|停駛|交通)/g;
const ROAD_ACCIDENT = NEWS_RULES.find(([category]) => category === "accident")[2];

function inferRelatedCategories(event) {
  const { category, eventKind, categorySource } = event;
  if (categorySource === "manual" || (!INCIDENT_CATEGORIES.has(category) && eventKind !== "activity")) return [];

  const { title, lead } = getNewsEvidence(event);
  const evidence = [title, lead].filter((text) => (
    !SIMULATION.test(text) && !PREVENTION.test(text) && !BACKGROUND.test(text)
  )).map((text) => text.replace(NEGATED_INCIDENT, "").replace(UNCERTAIN_TRAFFIC, ""));
  const related = [];

  if (category !== "traffic" && evidence.some((text) => TRAFFIC_IMPACT.test(text))) {
    related.push("traffic");
  }
  if (category === "disaster" && evidence.some((text) => ROAD_ACCIDENT.test(text))) {
    related.push("accident");
  }
  // For a road-feed record, the road impact is the provider's primary category.
  if (eventKind === "traffic_data" && category === "traffic") {
    const cause = evidence.map((text) => matchNewsRules(text)?.[0]).find((value) => value && value !== "traffic");
    if (INCIDENT_CATEGORIES.has(cause)) related.push(cause);
  }
  return related;
}

function classifyNewsCategory(event = {}) {
  const { title, summary, lead, isAggregatedSummary } = getNewsEvidence(event);
  const headline = matchNewsRules(title, lead);
  if (headline && INCIDENT_CATEGORIES.has(headline[0])) {
    return { category: headline[0], categoryReason: headline[1] };
  }
  // A festival, candidate or school can be the setting for a real incident.
  // Read the lead when the headline describes the setting without the action.
  const contextualHeadline = PREVENTION.test(title) || SIMULATION.test(title) || BACKGROUND.test(title) || /法律疑點|法律分析|責任歸屬/.test(title);
  const context = contextualHeadline ? undefined : matchNewsRules(lead);
  if (context && INCIDENT_CATEGORIES.has(context[0])) {
    return { category: context[0], categoryReason: context[1] };
  }
  if (headline || context) {
    const [category, categoryReason] = headline || context;
    return { category, categoryReason };
  }
  const section = outletCategory(event);
  if (section && !INCIDENT_CATEGORIES.has(section)) {
    return { category: section, categoryReason: "來源新聞版面" };
  }
  if (!isAggregatedSummary && POLITICAL_CONTEXT.test(summary)) {
    return { category: "politics", categoryReason: "摘要中的政治脈絡" };
  }
  return { category: "other", categoryReason: "標題與摘要缺少明確的分類依據" };
}

module.exports = { classifyNewsCategory, inferRelatedCategories };
