import { createRequire } from "node:module"; const require=createRequire(import.meta.url);
if (!process.argv.includes("--apply") && !process.argv.includes("--dry-run")) throw new Error("Use --dry-run or --apply");
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const store=require("../event-store"); const repo=require("../supabase-event-repository");
const candidates=await store.getEventCandidates(),events=await store.getOfficialEvents();
const report={candidates:candidates.length,officialEvents:events.length,publishedCandidates:candidates.filter(x=>x.status==="published").length,orphanCandidates:candidates.filter(x=>x.status==="published"&&!x.publishedEventId).length,orphanOfficialEvents:events.filter(x=>x.candidateId&&!candidates.some(c=>c.candidateId===x.candidateId)).length};
console.log(JSON.stringify(report,null,2)); if(process.argv.includes("--dry-run"))process.exit(0);
await repo.createEventCandidates(candidates); await repo.setOfficialEvents(events); console.log("Applied SQLite to Supabase migration");
