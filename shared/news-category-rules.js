const { NEWS_CATEGORIES } = require("./event-categories");

const NEWS_RULES = [
  ["politics", "選舉、選戰或政治評論", /政見發表|候選人|選舉|選戰|選情|選前|掃街拜票|競選|造勢|政黨輪替|黨紀|立法院|[市縣]議會/],
  ["politics", "公共案件的法律分析", /(?:公安|工安|建案|鄰損|大直案).{0,20}(?:法律疑點|責任歸屬)|法律疑點|法律分析/],
  ["disaster", "天氣或天然災害", /地震|颱風|豪雨|暴雨|淹水|土石流|坍方|坍塌道路|道路坍塌|落石|停班停課/],
  ["crime", "刑案、違法行為或司法追蹤", /縱火|蓄意放火|詐騙|詐欺|竊盜|偷竊|搶劫|性侵|性騷擾|殺人|槍擊|持刀(?:砍|傷|襲)|毒品|通緝犯|共諜|遭(?:逮捕|起訴)|偵辦刑案/],
  ["accident", "道路或運輸工具事故", /車禍|交通事故|道路事故|(?:汽車|機車|轎車|貨車|拖板車|砂石車|遊覽車|小客車|公車|客運).{0,10}(?:追撞|對撞|相撞|擦撞|自撞|翻覆|撞上|起火)|追撞|對撞|自撞|翻車|摔車|連環撞|列車.{0,12}出軌/],
  ["accident", "火警、受傷或現場救援", /火警|火災|失火|起火|氣爆|工安事故|職災|墜樓|墜落|溺水|摔傷|跌傷|高山症|登山.{0,10}失聯|(?:吊掛|受困|山難|落海|落水).{0,10}救援/],
  ["livelihood", "民生服務或生活設施", /停水|停電|限水|水質異常|民生物資|(?:運動中心|壘球場|運動館|全民館).{0,16}(?:啟用|開幕)/],
  ["medical", "醫療、公衛或疾病", /健康網|眼部健康|食物中毒|疫情|疫苗|登革熱|流感|確診|醫療疏失|醫療糾紛|急診壅塞|醫院.{0,12}(?:開診|啟用)|疾病篩檢/],
  ["traffic", "通行、道路管制或施工", /塞車|回堵|封路|封街|(?:道路|國道|省道|匝道|車道|隧道|橋梁|橋樑|路段|路口|交流道|交通|車流).{0,16}(?:壅塞|封閉|封鎖|管制|施工|改道|中斷|阻塞)|(?:封閉|封鎖|管制|施工).{0,10}(?:道路|國道|省道|匝道|車道|隧道|路段|路口)|(?:捷運|台鐵|臺鐵|高鐵|列車|航班).{0,12}(?:停駛|誤點|中斷|取消|故障)/],
  ["education", "學校、課程或考試", /學測|統測|會考|招生|入學|教學|校園霸凌|停課|學校.{0,10}(?:開學|合併)/],
  ["economy", "產業、勞資或財經", /勞資爭議|勞資糾紛|股市|匯率|財報|裁員|設廠|企業併購|工會.{0,10}(?:抗議|罷工|控)/],
  ["culture", "文化、娛樂或賽事報導", /展覽|演唱會|市集|球賽|賽事|競賽|(?:救援|棒壘球|邀請)賽|路跑|節慶|音樂節|開唱|影展|星聞|粉絲|電影上映|活動.{0,8}人潮/],
  ["international", "外交或國際事件", /外交會談|國際峰會|聯合國.{0,12}(?:會議|決議)|外國.{0,10}(?:大使|使節).{0,10}(?:訪台|抵台)/],
];

const POLITICAL_CONTEXT = NEWS_RULES[0][2];
const PUBLIC_ACTION = /車禍|交通事故|追撞|摔傷|火災|火警|氣爆|縱火|持刀|槍擊|停水|停電|封路|封街|交通管制/;
const NON_INCIDENT_CONTEXT = /演練|演習|救援賽|防災宣導|事故預防|預防事故/;
const LEGAL_FOLLOW_UP = /法律疑點|法律分析|責任歸屬/;
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

function matchNewsRules(text) {
  // Scheduled drills and competitions often name the emergency they simulate.
  const contextOnly = NON_INCIDENT_CONTEXT.test(text);
  const hasPublicAction = PUBLIC_ACTION.test(text);
  return NEWS_RULES.find(([category, , pattern]) => {
    if (category === "politics" && hasPublicAction && !LEGAL_FOLLOW_UP.test(text)) return false;
    if (contextOnly && ["disaster", "crime", "traffic", "accident"].includes(category)) return false;
    return pattern.test(text);
  });
}

function classifyNewsCategory(event = {}) {
  const title = String(event.title || "").normalize("NFKC");
  const summary = String(event.summary || event.content || "").normalize("NFKC").slice(0, 350);
  const headline = matchNewsRules(title);
  if (headline) return { category: headline[0], categoryReason: headline[1] };

  const section = outletCategory(event);
  // Google News RSS summaries often concatenate several linked headlines.
  // Those can describe different events and are unsafe classification input.
  const sourceUrl = String(event.sourceUrl || event.url || event.link || "");
  const isAggregatedSummary = /^https?:\/\/news\.google\.com\//i.test(sourceUrl);
  const lead = isAggregatedSummary ? "" : summary.split(/[。！？!?\n]/u, 1)[0];
  if (section && !PUBLIC_ACTION.test(lead)) {
    return { category: section, categoryReason: "來源新聞版面" };
  }
  const context = matchNewsRules(lead);
  if (context) return { category: context[0], categoryReason: context[1] };
  if (!isAggregatedSummary && POLITICAL_CONTEXT.test(summary)) {
    return { category: "politics", categoryReason: "摘要中的政治脈絡" };
  }
  return { category: "other", categoryReason: "標題與摘要缺少明確的分類依據" };
}

module.exports = { classifyNewsCategory };
