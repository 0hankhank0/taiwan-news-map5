const sentAt = new Map();
function sanitizeAlertText(value) {
  return String(value || "")
    .replace(/(authorization|bearer|token|api[_ -]?key|secret)\s*[:=]?\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/https?:\/\/[^\s?#]+\?[^\s]+/gi, (url) => url.split("?")[0])
    .slice(0, 900);
}
async function notifyRefreshAlert(type, message, { webhook = process.env.DISCORD_WEBHOOK_URL, now = Date.now(), cooldownMs = 1800000, fetchImpl = global.fetch } = {}) {
  if (!webhook || typeof fetchImpl !== "function") return { sent: false, reason: "not_configured" };
  if (now - (sentAt.get(type) || 0) < cooldownMs) return { sent: false, reason: "cooldown" };
  const content = `【Island Pulse】${sanitizeAlertText(message)}`;
  try {
    const response = await fetchImpl(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    sentAt.set(type, now); return { sent: true, content };
  } catch { return { sent: false, reason: "delivery_failed" }; }
}
module.exports = { notifyRefreshAlert, sanitizeAlertText };
