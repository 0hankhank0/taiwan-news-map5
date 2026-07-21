"use strict";

// Kept separate from the event refresh pipeline: this validates the PBS
// transport schema before any caller decides whether it is safe to replace
// previously retained data.
function parsePbsRoadPayload(payload) {
  const isObject = payload !== null && typeof payload === "object" && !Array.isArray(payload);
  const formDataPresent = isObject && Object.prototype.hasOwnProperty.call(payload, "formData");

  if (!isObject || !Array.isArray(payload.formData)) {
    return {
      ok: false,
      formDataPresent,
      records: [],
      error: "PBS payload must be an object containing a formData array",
    };
  }

  if (payload.formData.some((record) => record === null || typeof record !== "object" || Array.isArray(record))) {
    return {
      ok: false,
      formDataPresent: true,
      records: [],
      error: "PBS formData must contain only event objects",
    };
  }

  return { ok: true, formDataPresent: true, records: payload.formData, error: null };
}

module.exports = { parsePbsRoadPayload };
