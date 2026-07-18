const { sanitizeKktixBodyPreview } = require("../event-refresh");

const configuredFeed = String(process.env.KKTIX_EVENTS_FEED_URL || "https://kktix.com/events.atom").trim();
const targets = [
  { label: "KKTIX_EVENTS_FEED_URL", url: configuredFeed },
  { label: "kktix.com", url: "https://kktix.com/events.atom" },
  { label: "www.kktix.com", url: "https://www.kktix.com/events.atom" },
  { label: "kktix.cc", url: "https://kktix.cc/events.atom" },
];

async function diagnose(target) {
  try {
    const response = await fetch(target.url, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8" },
    });
    let body = "";
    try { body = await response.text(); } catch {}
    return {
      target: target.label,
      status: Number(response.status) || null,
      url: String(response.url || target.url).slice(0, 1000),
      contentType: String(response.headers.get("content-type") || "").slice(0, 200),
      bodyPreview: sanitizeKktixBodyPreview(body),
    };
  } catch {
    return { target: target.label, status: null, url: target.url, contentType: "", bodyPreview: "Request failed" };
  }
}

(async () => {
  for (const target of targets) console.log(JSON.stringify(await diagnose(target)));
})();
