const assert = require("assert");
const os = require("os"), path = require("path");
process.env.EVENT_STORE_MODE = "local";
process.env.REPORT_ADMIN_TOKEN = "submission-test-token";
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `taiwan-news-submission-test-${Date.now()}.sqlite`);
process.env.OPENAI_API_KEY = "";
const submission = require("../api/submission");
const { createSubmission, updateSubmission, getPublicMapSubmissionEvents, listSubmissions } = require("../submission-store");

function res() { return { statusCode: 200, headers: {}, payload: null, setHeader(k,v){this.headers[k]=v}, status(n){this.statusCode=n;return this}, json(v){this.payload=v;return this}, end(){return this} }; }
async function call(req) { const response = res(); await submission({ method:"GET", headers:{}, query:{}, body:{}, ...req }, response); return response; }
function input(overrides = {}) { return { title:"重要道路中斷事件", description:"此事件造成多名用路人受影響，請管理員確認後再加入公開地圖。", category:"traffic", sourceType:"news_report", sourceUrl:"https://example.test/report", publicImpactConfirmed:true, latitude:25.033, longitude:121.565, ...overrides }; }

(async () => {
  const safeAnalysis = { risk_level:"low", location_valid:true, possible_duplicate:false, spam_probability:0, credibility_score:1, evidence_score:1, missing_information:[], safety_flags:[] };
  assert.deepEqual(submission.decidePublication(input(), safeAnalysis, false), { status:"pending_admin", approvalMethod:null, riskLevel:"low", publicationNotice:null });
  assert.equal((await call({ method:"POST", headers:{"x-forwarded-for":"missing-news"}, body:input({sourceUrl:""}) })).statusCode, 400);
  assert.equal((await call({ method:"POST", headers:{"x-forwarded-for":"missing-official"}, body:input({sourceType:"official_notice",sourceUrl:""}) })).statusCode, 400);
  assert.equal((await call({ method:"POST", headers:{"x-forwarded-for":"missing-eyewitness-coordinates"}, body:input({sourceType:"eyewitness",sourceUrl:"",latitude:null,longitude:null}) })).statusCode, 400);
  assert.equal((await call({ method:"POST", headers:{"x-forwarded-for":"short-eyewitness"}, body:input({sourceType:"eyewitness",sourceUrl:"",description:"太短"}) })).statusCode, 400);
  assert.equal((await call({ method:"POST", headers:{"x-forwarded-for":"missing-confirmation"}, body:input({publicImpactConfirmed:false}) })).statusCode, 400);
  const created = await call({ method:"POST", headers:{"x-forwarded-for":"valid-submission"}, body:input() });
  assert.equal(created.statusCode, 201); assert.equal(created.payload.status, "pending_admin"); assert.equal(created.payload.publicationNotice, null);
  const pending = await listSubmissions({status:"pending_admin", limit:100}); const saved = pending.find(x => x.submissionId === created.payload.submissionId);
  assert.equal(saved.status, "pending_admin"); assert.equal(saved.sourceType, "news_report");
  process.env.OPENAI_API_KEY = "test-key"; const originalFetch = global.fetch;
  global.fetch = async () => ({ ok:true, json:async()=>({choices:[{message:{content:JSON.stringify(safeAnalysis)}}]}) });
  const aiSafe = await call({ method:"POST", headers:{"x-forwarded-for":"ai-safe"}, body:input({title:"AI 也不可自動發布的事件"}) });
  assert.equal(aiSafe.statusCode, 201); assert.equal(aiSafe.payload.status, "pending_admin");
  global.fetch = originalFetch; process.env.OPENAI_API_KEY = "";
  const approved = await call({ method:"PATCH", headers:{authorization:"Bearer submission-test-token"}, query:{submissionId:created.payload.submissionId}, body:{status:"approved",reviewNote:"管理員確認"} });
  assert.equal(approved.statusCode, 200); assert.equal(approved.payload.submission.approvalMethod, "admin");
  assert.equal((await getPublicMapSubmissionEvents()).some(x => x.submissionId === created.payload.submissionId), true);
  const direct = await createSubmission(input({title:"正式管理員發布流程"}));
  await updateSubmission(direct.submissionId, {status:"approved",approvalMethod:"admin"}, {action:"admin_approve"});
  assert.equal((await getPublicMapSubmissionEvents()).some(x => x.submissionId === direct.submissionId), true);
  console.log("submission API tests passed");
})().catch(error => { console.error(error); process.exit(1); });
