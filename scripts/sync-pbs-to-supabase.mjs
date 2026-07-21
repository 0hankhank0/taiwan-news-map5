#!/usr/bin/env node
import service from "../pbs-sync-service.js";
try { console.log(JSON.stringify(await service.syncPbsToSupabase())); }
catch (error) { console.error(JSON.stringify({ error: error.message, stage: error.stage || error.report?.error?.stage || "unknown" })); process.exitCode = 1; }
