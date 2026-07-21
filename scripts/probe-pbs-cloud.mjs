#!/usr/bin/env node
// Manual diagnostic only. It does not invoke event refresh or write application data.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import probe from "../pbs-cloud-probe.js";

const output = resolve(process.env.PBS_PROBE_OUTPUT || "scripts/probe-output/pbs-cloud-probe.json");
const report = await probe.runPbsCloudProbe();
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2));
for (const result of report.results) {
  console.log(JSON.stringify({ endpoint: result.endpoint, variant: result.testVariant, timeoutMs: result.timeoutMs, status: result.status, durationMs: result.durationMs, bodyBytes: result.bodyBytes, jsonParsed: result.jsonParsed, formDataCount: result.formDataCount, error: result.error?.causeCode || result.error?.message || null }));
}
console.log(`Saved ${output}`);
