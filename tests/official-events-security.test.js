const assert = require("assert"); const os = require("os"); const path = require("path");
process.env.EVENT_STORE_MODE = "local";
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `taiwan-news-official-${Date.now()}.sqlite`); process.env.REPORT_ADMIN_TOKEN = "secret";
const store = require("../event-store"); const candidatesApi = require("../api/event-candidates"); const eventsApi = require("../api/events");
function res() { return { headers:{}, statusCode:200, setHeader(k,v){this.headers[k]=v}, status(c){this.statusCode=c;return this}, json(x){this.payload=x;return this}, end(){return this} }; }
async function call(handler, req) { const out=res(); await handler({ method:"GET",headers:{},query:{},body:{},...req },out); return out; }
(async()=>{
  await store.deleteCachedValue(store.OFFICIAL_EVENTS_KEY); await store.clearEventCaches();
  assert.deepEqual(await store.migrateLegacyEvents(), { migrated:0, total:0 }); // empty store
  const legacy = [{ id:"legacy-1", title:"legacy", lat:25, lng:121, category:"life" }];
  await store.setCachedEvents(legacy); await store.deleteCachedValue(store.OFFICIAL_EVENTS_KEY);
  assert.deepEqual(await store.migrateLegacyEvents(), { migrated:1, total:1 }); assert.equal((await store.getOfficialEvents()).length,1);
  assert.equal((await store.migrateLegacyEvents()).migrated,0); // repeat safe
  await store.setCachedValue(store.OFFICIAL_EVENTS_KEY, [{ id:"official-only",title:"official" }]);
  await store.setCachedEvents([...legacy,{id:"new-legacy",title:"new"}]);
  assert.equal((await store.migrateLegacyEvents()).total,3); // partial official backfill
  const [candidate]=await store.createEventCandidates([{source:"test",event:{title:"one",lat:25,lng:121}}]);
  const [one,two]=await Promise.all([store.publishEventCandidate(candidate.candidateId),store.publishEventCandidate(candidate.candidateId)]);
  assert.equal(one.event.id,two.event.id); assert.equal((await store.getOfficialEvents()).filter(x=>x.id===one.event.id).length,1);
  const denied=await call(candidatesApi,{method:"GET"}); assert.equal(denied.statusCode,401);
  const deniedPost=await call(candidatesApi,{method:"POST",query:{action:"publish"},body:{candidateId:candidate.candidateId}}); assert.equal(deniedPost.statusCode,401);
  await store.setOfficialEvents([{id:"safe",title:"safe",lat:25,lng:121,rawSourceData:{secret:true},adminReview:{adminNote:"secret"},contactInfo:"private",candidateId:"internal",category:"life"}]);
  const publicRes=await call(eventsApi,{method:"GET"}); const published=publicRes.payload.find(x=>x.id==="safe");
  assert.equal(Object.hasOwn(published,"rawSourceData"),false); assert.equal(Object.hasOwn(published,"adminReview"),false); assert.equal(Object.hasOwn(published,"contactInfo"),false); assert.equal(Object.hasOwn(published,"candidateId"),false);
  console.log("official events security tests passed");
})().catch(e=>{console.error(e);process.exit(1)});
