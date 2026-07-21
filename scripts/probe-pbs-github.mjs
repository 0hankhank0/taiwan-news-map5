#!/usr/bin/env node
// Manual GitHub Actions connectivity diagnostic. It never invokes event refresh.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import githubProbe from "../pbs-github-probe.js";

const outputDir = resolve(process.env.PBS_GITHUB_PROBE_OUTPUT || "scripts/probe-output/pbs-github");
const concise = (report) => ({
  runnerOs: report.runnerOs,
  nodeVersion: report.nodeVersion,
  status: report.status,
  durationMs: report.durationMs,
  contentType: report.contentType,
  bodyBytes: report.bodyBytes,
  parserSuccess: report.parserSuccess,
  formDataCount: report.formDataCount,
  sampleRecords: report.sampleRecords,
});

await mkdir(outputDir, { recursive: true });
try {
  const { report, rawBody } = await githubProbe.runPbsGitHubProbe();
  await Promise.all([
    writeFile(resolve(outputDir, "pbs-roadall-response.json"), rawBody),
    writeFile(resolve(outputDir, "pbs-github-probe.json"), JSON.stringify(report, null, 2)),
  ]);
  console.log(JSON.stringify(concise(report)));
} catch (error) {
  const report = error.report || { error: { stage: "unexpected", message: "Probe failed unexpectedly" } };
  await writeFile(resolve(outputDir, "pbs-github-probe.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(concise(report)));
  process.exitCode = 1;
}
