const { isAuthorized } = require("../admin-auth");
const { getEventCandidates, publishEventCandidate } = require("../event-store");
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const auth = isAuthorized(req); if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (req.method === "GET") { const candidates = await getEventCandidates({ status: req.query?.status }); return res.json({ candidates, total: candidates.length }); }
  if (req.method === "POST" && String(req.query?.action) === "publish") {
    try { const result = await publishEventCandidate(String(req.body?.candidateId || ""), req.body?.event || {}); return result ? res.json({ success: true, ...result }) : res.status(404).json({ error: "Candidate not found" }); }
    catch (error) { console.error("[event-candidates] publish failed:", error.message); return res.status(error?.code === "CONFIG" ? 503 : 500).json({ error: "Unable to publish candidate" }); }
  }
  return res.status(405).json({ error: "Method not allowed" });
};
