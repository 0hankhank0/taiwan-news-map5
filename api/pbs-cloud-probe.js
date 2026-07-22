"use strict";

const { runPbsCloudProbe } = require("../pbs-cloud-probe");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Cache-Control", "no-store");
  // This diagnostic makes no database calls and never returns response bodies or request headers.
  return res.status(200).json(await runPbsCloudProbe());
};
