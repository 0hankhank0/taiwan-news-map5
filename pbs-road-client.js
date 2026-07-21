"use strict";

const { ROAD_ALL_URL, PbsProbeError, runPbsGitHubProbe } = require("./pbs-github-probe");

async function fetchPbsRoadEvents(options = {}) {
  try {
    const { report, rawBody } = await runPbsGitHubProbe(options);
    return { records: JSON.parse(rawBody.toString("utf8")).formData, report, rawBody };
  } catch (error) {
    if (error instanceof PbsProbeError) throw error;
    throw new PbsProbeError("PBS client failed", { endpoint: ROAD_ALL_URL, error: { stage: "network", message: error.message } });
  }
}

module.exports = { fetchPbsRoadEvents, ROAD_ALL_URL };
