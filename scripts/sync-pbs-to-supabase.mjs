#!/usr/bin/env node
import service from "../pbs-sync-service.js";
import diagnostics from "../pbs-cli-diagnostics.js";
try { console.log(JSON.stringify(await service.syncPbsToSupabase())); }
catch (error) { console.error(JSON.stringify(diagnostics.syncFailurePayload(error))); process.exitCode = 1; }
