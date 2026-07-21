// TEMPORARY diagnostic endpoint. Delete after Vercel environment evidence is collected.
const { runPbsCloudProbe } = require("../pbs-cloud-probe");

function isAuthorized(req) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  return Boolean(secret) && String(req.headers?.authorization || "").trim() === `Bearer ${secret}`;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });
  const report = await runPbsCloudProbe();
  return res.status(200).json({
    runtime: report.runtime,
    nodeVersion: report.nodeVersion,
    region: report.vercelRegion,
    results: report.results.map(({ endpoint, testVariant, timeoutMs, status, durationMs, contentType, contentLength, bodyBytes, jsonParsed, formDataPresent, formDataCount, error }) => ({ endpoint, testVariant, timeoutMs, status, durationMs, contentType, contentLength, bodyBytes, jsonParsed, formDataPresent, formDataCount, error })),
  });
};

module.exports.isAuthorized = isAuthorized;
