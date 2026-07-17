#!/usr/bin/env node
require("dotenv").config();

const { clearEventCaches } = require("./event-store");
const { runEventRefresh } = require("./event-refresh");

function readArgValue(prefix) {
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : "";
}

function getMode() {
  if (process.argv.includes("--mode=news")) return "news";
  if (process.argv.includes("--mode=traffic")) return "traffic";
  const explicit = readArgValue("--mode=");
  return ["news", "traffic", "all"].includes(explicit) ? explicit : "all";
}

async function main() {
  if (process.argv.includes("--clear-cache")) {
    const result = await clearEventCaches();
    console.log(JSON.stringify({ success: true, ...result }, null, 2));
    return;
  }

  const mode = getMode();
  const result = await runEventRefresh({
    mode,
    runId: `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    skipAi: process.argv.includes("--skip-ai"),
    skipExternalGeocoding: process.argv.includes("--skip-external-geocoding"),
    write: !process.argv.includes("--dry-run"),
  });

  const { events, ...summary } = result;
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[scraper] failed:", error);
  process.exitCode = 1;
});
