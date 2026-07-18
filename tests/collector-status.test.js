const assert=require("assert"); const refresh=require("../event-refresh");
(async()=>{
  assert.equal((await refresh.runCollector("TDX",async()=>[],{skipReason:"缺少 TDX_CLIENT_ID"})).status,"skipped");
  const empty=await refresh.runCollector("empty",async()=>[]); assert.equal(empty.status,"success"); assert.equal(empty.fetchedCount,0); assert.ok(Number.isFinite(empty.durationMs));
  const unauthorized=await refresh.runCollector("TDX",async()=>{throw new Error("HTTP 401")}); assert.equal(unauthorized.status,"failed");
  const timeout=await refresh.runCollector("TDX",async()=>{throw new Error("timeout")}); assert.equal(timeout.status,"failed");
  const schema=await refresh.runCollector("TDX",async()=>({bad:true})); assert.equal(schema.status,"failed");
  const ai=await refresh.runCollector("AI",async()=>[],{skipReason:"沒有可供 AI 提取的來源資料"}); assert.equal(ai.status,"skipped");
  console.log("collector status tests passed");
})().catch(e=>{console.error(e);process.exit(1)});
