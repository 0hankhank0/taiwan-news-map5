const assert = require("assert");
const {
  VISIBILITY,
  classifyEventVisibility,
  isLowRealtimeEvent,
  shouldShowEvent,
} = require("../event-content-filter");

function expectHidden(input) {
  const result = classifyEventVisibility(input);
  assert.equal(result.visibility, VISIBILITY.LOW_REALTIME_HIDDEN, JSON.stringify(input));
  assert.equal(isLowRealtimeEvent(input), true, JSON.stringify(input));
  assert.equal(shouldShowEvent(input), false, JSON.stringify(input));
}

function expectHiddenReason(input, reason) {
  const result = classifyEventVisibility(input);
  assert.equal(result.visibility, VISIBILITY.LOW_REALTIME_HIDDEN, JSON.stringify(input));
  assert.equal(result.reason, reason, JSON.stringify(input));
  assert.equal(isLowRealtimeEvent(input), true, JSON.stringify(input));
  assert.equal(shouldShowEvent(input), false, JSON.stringify(input));
}

function expectVisible(input, expectedVisibility = null) {
  const result = classifyEventVisibility(input);
  if (expectedVisibility) assert.equal(result.visibility, expectedVisibility, JSON.stringify(input));
  else assert.notEqual(result.visibility, VISIBILITY.LOW_REALTIME_HIDDEN, JSON.stringify(input));
  assert.equal(isLowRealtimeEvent(input), false, JSON.stringify(input));
  assert.equal(shouldShowEvent(input), true, JSON.stringify(input));
}

[
  "請保持安全距離",
  "行車安全第一",
  "雨天路滑請減速慢行",
  "酒後不開車、開車不喝酒",
  "請繫安全帶",
  "注意車前狀況",
  "禮讓行人",
  "旅途平安",
  "防詐宣導、提高警覺、小心詐騙",
  "防火宣導",
  "防災宣導",
  "交通安全宣導",
  { title: "CMS", content: "請減速慢行", category: "traffic" },
].forEach((input) => expectHiddenReason(input, "generic-warning-slogan"));

[
  "前方車禍回堵，請減速慢行",
  "事故封閉，請保持安全距離",
  "落石坍方交通管制，請小心駕駛",
  "火災搶修停電，請提高警覺",
  "前方號誌故障，請減速慢行",
  "交流道車多，請小心駕駛",
  "前方拋錨車，請小心駕駛",
  "單線雙向通行，請減速慢行",
  "救援中，請減速慢行",
  "外側車道有掉落物，請小心駕駛",
  "accident congestion ahead, slow down",
  "lane closed due to debris",
].forEach((input) => expectVisible(input));

[
  "市府公布青年補助申請辦法，下月起開放線上填寫",
  "敬老禮金撥款入帳，區公所提醒領取方式",
  "交通政策論壇今日登場，專家討論預算與修法",
  "行政院統計報告出爐，表揚績優單位",
  "社福津貼資格名冊公告，民眾可查詢補發進度",
  "高雄市府推動青年租金方案，說明申請資格與受理時程",
  "縣府宣布產業升級計畫核定，將編列預算補助地方業者",
  "市議會審查追加預算，局處說明施政成果與採購進度",
  "工務局舉行道路改善說明會，邀請居民報名參加座談",
  "農業部視察地方農損，爭取救助補助與產銷調節",
].forEach(expectHidden);

[
  "921周年專題回顧：歷史災情與判決回顧",
  "年度事件盤點懶人包，一文看懂昔日爭議",
  "判決回顧與歷史整理：十年前案件再受關注",
  "週年專題整理，回顧地方建設發展",
].forEach(expectHidden);

[
  "民眾吃到保麗龍引發消費爭議，店家回應服務態度",
  "店員態度遭投訴，網友留下負面評價",
  "餐廳退費糾紛延燒，消費者要求退款",
].forEach(expectHidden);

[
  "拉拉山水蜜桃熱銷，市府澄清沒有滯銷問題",
  "水蜜桃買氣旺，農產產銷單位說明盛產狀況",
  "文蛤暴斃產業損失，地方爭取救助與育苗補助",
  "飛彈車進駐營區，國軍演訓部署動態曝光",
].forEach(expectHidden);

[
  "新交通政策今日生效，市區多路段封路並實施交通管制",
  "補助工程搶修造成停水停電，居民需提前儲水",
  "颱風來襲宣布停班停課，沿海居民疏散撤離",
  "論壇周邊道路因大型活動人潮管制，部分公車改道",
  "飛彈車事故造成道路封閉，警方提醒改道",
  "養殖區淹水達警戒，居民緊急疏散撤離",
  "農產市場火災延燒，周邊封路管制",
  "市府宣布地下水管破裂搶修，三里今晚停水並實施交通管制",
  "工務局道路改善工程今晨封路，公車改道並禁止通行",
].forEach((text) => expectVisible(text, VISIBILITY.VISIBLE_POLICY_IMPACT));

[
  "台中工廠火災濃煙竄出，消防搶救中",
  "國道車禍造成回堵，警方到場處理",
  "豪雨造成市區淹水，地下道暫時封閉",
  "山區坍方中斷道路，工程單位搶修",
  "刑案現場警方拉封鎖線採證",
  "颱風前拆除危險設施，防止招牌掉落",
  { title: "9月演唱會首辦，卡司公布並開賣", category: "activity", city: "台北市", venue: "台北小巨蛋" },
  { title: "數月後大型展覽公布活動卡司", category: "activity", lat: 25.033, lng: 121.565 },
  { title: "國際賽事明年登場", category: "activity", location: "高雄巨蛋" },
  { title: "高雄在地講座今晚登場", category: "activity", city: "高雄市", venue: "高雄市立圖書館" },
].forEach((input) => expectVisible(input));

console.log("event-content-filter tests passed");
