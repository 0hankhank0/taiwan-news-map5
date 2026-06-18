const { getReactionTotals } = require("../reaction-store");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    return res.status(200).json(await getReactionTotals());
  } catch (error) {
    console.error("[reactions-total] API error:", error.message);
    return res.status(200).json({ muyu: 0, candle: 0 });
  }
};
