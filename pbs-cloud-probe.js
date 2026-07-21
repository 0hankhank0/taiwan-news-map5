const ENDPOINTS = Object.freeze([
  { name: "RoadAllServlet", url: "https://rtr.pbs.gov.tw/pbsmgt/RoadAllServlet?ajaxAction=roadAllCache" },
  { name: "PBS all_road wrapper", url: "https://www.pbs.gov.tw/cht/index.php?act=rss&code=all_road" },
]);

const VARIANTS = Object.freeze([
  { name: "bare", headers: {} },
  { name: "json", headers: { Accept: "application/json, text/javascript, */*; q=0.01" } },
  { name: "pbs-xhr", headers: { Accept: "application/json, text/javascript, */*; q=0.01", Referer: "https://www.pbs.gov.tw/cht/index.php?code=list&ids=30", "X-Requested-With": "XMLHttpRequest", "User-Agent": "Mozilla/5.0" } },
]);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runtimeInfo() {
  return {
    runtime: process.env.VERCEL ? "vercel-serverless" : (process.env.GITHUB_ACTIONS ? "github-actions" : "node-local"),
    nodeVersion: process.version,
    githubRunner: process.env.RUNNER_OS ? `${process.env.RUNNER_OS}/${process.env.RUNNER_ARCH || "unknown"}` : null,
    vercelRegion: process.env.VERCEL_REGION || process.env.AWS_REGION || null,
  };
}

function errorSummary(error) {
  const cause = error?.cause;
  return {
    name: error?.name || null,
    message: error?.message || String(error),
    cause: cause ? String(cause.message || cause) : null,
    causeCode: cause?.code || null,
    causeErrno: cause?.errno || null,
    causeSyscall: cause?.syscall || null,
    causeHostname: cause?.hostname || null,
    isAbortError: error?.name === "AbortError" || error?.name === "TimeoutError",
  };
}

function schemaSummary(payload) {
  const rows = Array.isArray(payload?.formData) ? payload.formData : [];
  return {
    jsonParsed: true,
    formDataPresent: Array.isArray(payload?.formData),
    formDataCount: rows.length,
    sampleSchema: rows[0] ? Object.keys(rows[0]).sort() : [],
    sampleRows: rows.slice(0, 2).map(({ number, name, region, area_sn, highway, roadtype, comment, direction, happendate, happentime, lastmodified }) => ({ number, name, region, area_sn, highway, roadtype, comment: String(comment || "").slice(0, 160), direction, happendate, happentime, lastmodified })),
  };
}

async function probeOnce(endpoint, variant, timeoutMs, fetchImpl = fetch) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  try {
    const response = await fetchImpl(endpoint.url, { headers: variant.headers, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
    const bytes = Buffer.from(await response.arrayBuffer());
    let parsed;
    let jsonError = null;
    try { parsed = JSON.parse(bytes.toString("utf8")); } catch (error) { jsonError = error.message; }
    return {
      endpoint: endpoint.name, requestUrl: endpoint.url, testVariant: variant.name, ...runtimeInfo(), startedAt, durationMs: Date.now() - started,
      timeoutMs, status: response.status, redirectUrl: response.redirected ? response.url : null,
      contentType: response.headers.get("content-type"), contentLength: response.headers.get("content-length"), bodyBytes: bytes.length,
      ...(parsed ? schemaSummary(parsed) : { jsonParsed: false, formDataPresent: false, formDataCount: null, sampleSchema: [], sampleRows: [], jsonError }),
      error: null,
    };
  } catch (error) {
    return {
      endpoint: endpoint.name, requestUrl: endpoint.url, testVariant: variant.name, ...runtimeInfo(), startedAt, durationMs: Date.now() - started,
      timeoutMs, status: null, redirectUrl: null, contentType: null, contentLength: null, bodyBytes: null,
      jsonParsed: false, formDataPresent: false, formDataCount: null, sampleSchema: [], sampleRows: [], error: errorSummary(error),
    };
  }
}

async function runPbsCloudProbe({ fetchImpl = fetch, pauseMs = 350 } = {}) {
  const results = [];
  for (const endpoint of ENDPOINTS) for (const variant of VARIANTS) {
    const initial = await probeOnce(endpoint, variant, 15_000, fetchImpl);
    results.push(initial);
    // Only distinguish an actual 15-second abort. DNS/TLS/reset errors are not retried as timeouts.
    if (initial.error?.isAbortError) {
      await delay(pauseMs);
      results.push(await probeOnce(endpoint, variant, 30_000, fetchImpl));
      await delay(pauseMs);
      results.push(await probeOnce(endpoint, variant, 5_000, fetchImpl));
    }
    await delay(pauseMs);
  }
  return { generatedAt: new Date().toISOString(), ...runtimeInfo(), results };
}

module.exports = { ENDPOINTS, VARIANTS, errorSummary, probeOnce, runPbsCloudProbe };
