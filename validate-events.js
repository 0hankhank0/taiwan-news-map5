const { Redis } = require("@upstash/redis");

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isValidNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isTaiwanReasonableLat(lat) {
  return lat >= 21.5 && lat <= 25.5;
}

function isTaiwanReasonableLng(lng) {
  return lng >= 119 && lng <= 122.5;
}

function summarizeEvent(event) {
  return {
    id: event?.id ?? null,
    title: event?.title ?? null,
  };
}

function validateEvent(event, index) {
  const reasons = [];
  const warnings = [];

  if (!isNonEmptyString(String(event?.id ?? "").trim())) {
    reasons.push("id missing or empty");
  }

  if (!isNonEmptyString(event?.title)) {
    reasons.push("title missing or empty");
  }

  if (!isNonEmptyString(event?.content)) {
    reasons.push("content missing or empty");
  }

  if (!isNonEmptyString(event?.category)) {
    reasons.push("category missing or empty");
  }

  if (!isNonEmptyString(event?.source)) {
    reasons.push("source missing or empty");
  }

  if (!isNonEmptyString(event?.city)) {
    reasons.push("city missing or empty");
  }

  if (!isValidNumber(event?.lat)) {
    reasons.push("lat invalid");
  }

  if (!isValidNumber(event?.lng)) {
    reasons.push("lng invalid");
  }

  if (!isValidNumber(event?.createdAt)) {
    reasons.push("createdAt invalid");
  }

  if (event?.sources !== undefined && !Array.isArray(event.sources)) {
    reasons.push("sources must be an array if present");
  }

  if (isValidNumber(event?.lat) && !isTaiwanReasonableLat(event.lat)) {
    warnings.push("lat outside recommended Taiwan range");
  }

  if (isValidNumber(event?.lng) && !isTaiwanReasonableLng(event.lng)) {
    warnings.push("lng outside recommended Taiwan range");
  }

  return {
    index,
    valid: reasons.length === 0,
    reasons,
    warnings,
    summary: summarizeEvent(event),
  };
}

async function main() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    console.error("Missing KV_REST_API_URL or KV_REST_API_TOKEN");
    process.exit(1);
  }

  const raw = await kv.get("taiwan_traffic_events");

  if (!Array.isArray(raw)) {
    console.error('KV key "taiwan_traffic_events" is not an array');
    process.exit(1);
  }

  const results = raw.map((event, index) => validateEvent(event, index));
  const invalid = results.filter(r => !r.valid);
  const valid = results.filter(r => r.valid);
  const warningEvents = results.filter(r => r.warnings.length > 0);
  const warningCount = warningEvents.reduce((sum, item) => sum + item.warnings.length, 0);

  console.log("Validation Result");
  console.log(`Total: ${results.length}`);
  console.log(`Valid: ${valid.length}`);
  console.log(`Invalid: ${invalid.length}`);
  console.log(`Warnings: ${warningCount}`);

  if (invalid.length > 0) {
    console.log("\nFirst 10 invalid events:");
    invalid.slice(0, 10).forEach((item, i) => {
      console.log(
        `${i + 1}. id=${JSON.stringify(item.summary.id)} title=${JSON.stringify(item.summary.title)} reasons=${item.reasons.join("; ")}`
      );
    });
  }

  if (warningEvents.length > 0) {
    console.log("\nFirst 10 warning events:");
    warningEvents.slice(0, 10).forEach((item, i) => {
      console.log(
        `${i + 1}. id=${JSON.stringify(item.summary.id)} title=${JSON.stringify(item.summary.title)} warnings=${item.warnings.join("; ")}`
      );
    });
  }

  if (invalid.length > 0) {
    process.exitCode = 2;
  } else {
    console.log("\nAll events passed the minimum EventItem contract.");
  }
}

main().catch((error) => {
  console.error("Validation failed:", error);
  process.exit(1);
});
