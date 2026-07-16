const { getCachedValue, setCachedValue } = require("./event-store");

const INTEGRATION_STATUS_KEY = "integrations:events:status";
const SERVICES = ["kktix", "kktv"];

function emptyStatus(service) {
  return {
    service,
    status: "never_run",
    lastSuccessfulSyncAt: null,
    lastAttemptAt: null,
    lastErrorType: null,
    fetchedCount: 0,
    insertedCount: 0,
    duplicateCount: 0,
    failedCount: 0,
  };
}

async function getEventIntegrationStatuses() {
  const stored = await getCachedValue(INTEGRATION_STATUS_KEY);
  const source = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  return SERVICES.map((service) => ({ ...emptyStatus(service), ...(source[service] || {}) }));
}

async function recordEventIntegrationStatus(service, patch = {}) {
  if (!SERVICES.includes(service)) throw new Error("Unsupported event integration");
  const statuses = await getEventIntegrationStatuses();
  const next = Object.fromEntries(statuses.map((status) => [status.service, status]));
  const previous = next[service];
  const now = new Date().toISOString();
  next[service] = {
    ...previous,
    ...patch,
    service,
    lastAttemptAt: patch.lastAttemptAt || now,
    lastSuccessfulSyncAt: patch.status === "success" ? (patch.lastSuccessfulSyncAt || now) : previous.lastSuccessfulSyncAt,
    fetchedCount: Number(patch.fetchedCount ?? previous.fetchedCount ?? 0),
    insertedCount: Number(patch.insertedCount ?? previous.insertedCount ?? 0),
    duplicateCount: Number(patch.duplicateCount ?? previous.duplicateCount ?? 0),
    failedCount: Number(patch.failedCount ?? previous.failedCount ?? 0),
  };
  await setCachedValue(INTEGRATION_STATUS_KEY, next);
  return next[service];
}

module.exports = { INTEGRATION_STATUS_KEY, getEventIntegrationStatuses, recordEventIntegrationStatus };
