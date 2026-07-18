const { normalizeEventsForFrontend } = require("../event-normalizer");
const { isAuthorized } = require("../admin-auth");
const { getOfficialEvents, updateOfficialEvent } = require("../event-store");

const ALLOWED_STATUSES = new Set(["active", "upcoming", "resolved", "cleared", "expired"]);
const ALLOWED_REVIEW_STATES = new Set(["unreviewed", "pending_review", "reviewed", "merged", "rejected"]);
const ALLOWED_VERIFIED_STATUSES = new Set(["unverified", "verified", "resolved", "rejected"]);

function sendJson(res, status, payload) {
  return res.status(status).json(payload);
}

function getBody(req) {
  return req.body && typeof req.body === "object" ? req.body : {};
}

function sanitizePatch(input = {}) {
  const patch = {};
  if (input.title !== undefined) patch.title = String(input.title).trim().slice(0, 160);
  if (input.content !== undefined) patch.content = String(input.content).trim().slice(0, 600);
  if (input.category !== undefined) patch.category = String(input.category).trim().slice(0, 40);
  if (input.address !== undefined) patch.address = String(input.address).trim().slice(0, 180);
  if (input.venue !== undefined) patch.venue = String(input.venue).trim().slice(0, 120);
  if (input.city !== undefined) patch.city = String(input.city).trim().slice(0, 40);
  if (input.district !== undefined) patch.district = String(input.district).trim().slice(0, 40);
  if (input.adminNote !== undefined) patch.adminNote = String(input.adminNote).trim().slice(0, 1000);
  if (input.mergedIntoEventId !== undefined) patch.mergedIntoEventId = String(input.mergedIntoEventId).trim().slice(0, 160);

  if (input.status !== undefined) {
    const status = String(input.status).trim();
    if (!ALLOWED_STATUSES.has(status)) throw new Error("Invalid status");
    patch.status = status;
  }
  if (input.reviewState !== undefined) {
    const reviewState = String(input.reviewState).trim();
    if (!ALLOWED_REVIEW_STATES.has(reviewState)) throw new Error("Invalid reviewState");
    patch.reviewState = reviewState;
  }
  if (input.verifiedStatus !== undefined) {
    const verifiedStatus = String(input.verifiedStatus).trim();
    if (!ALLOWED_VERIFIED_STATUSES.has(verifiedStatus)) throw new Error("Invalid verifiedStatus");
    patch.verifiedStatus = verifiedStatus;
  }
  if (input.resolvedAt !== undefined) patch.resolvedAt = input.resolvedAt ? String(input.resolvedAt).trim() : null;
  if (input.lat !== undefined && input.lat !== "") {
    const lat = Number(input.lat);
    if (!Number.isFinite(lat) || lat < 21 || lat > 27) throw new Error("Invalid lat");
    patch.lat = lat;
    patch.locationPrecision = "exact";
    patch.locationSource = "manual";
    patch.locationConfidence = 1;
    patch.locationQuality = "high";
    patch.locationDisplayMode = "point";
  }
  if (input.lng !== undefined && input.lng !== "") {
    const lng = Number(input.lng);
    if (!Number.isFinite(lng) || lng < 118 || lng > 123) throw new Error("Invalid lng");
    patch.lng = lng;
    patch.locationPrecision = "exact";
    patch.locationSource = "manual";
    patch.locationConfidence = 1;
    patch.locationQuality = "high";
    patch.locationDisplayMode = "point";
  }
  return patch;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();

  const auth = isAuthorized(req);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });

  if (req.method === "GET") {
    const q = String(req.query?.q || "").trim().toLowerCase();
    const reviewState = String(req.query?.reviewState || "").trim();
    const locationQuality = String(req.query?.locationQuality || "").trim();
    const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 120)));
    const events = normalizeEventsForFrontend(await getOfficialEvents());
    let filtered = events;
    if (reviewState) filtered = filtered.filter((event) => String(event.reviewState || "") === reviewState);
    if (locationQuality) filtered = filtered.filter((event) => String(event.locationQuality || "") === locationQuality);
    if (q) {
      filtered = filtered.filter((event) =>
        [event.id, event.title, event.content, event.city, event.district, event.address, event.sourceName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    return sendJson(res, 200, { events: filtered.slice(0, limit), total: filtered.length });
  }

  if (req.method === "PATCH") {
    const body = getBody(req);
    const eventId = String(req.query?.eventId || body.eventId || "").trim();
    if (!eventId) return sendJson(res, 400, { error: "Missing eventId" });

    let patch;
    try {
      patch = sanitizePatch(body);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }

    const event = await updateOfficialEvent(eventId, patch, "admin");
    if (!event) return sendJson(res, 404, { error: "Event not found" });
    return sendJson(res, 200, { success: true, event });
  }

  return sendJson(res, 405, { error: "Method not allowed" });
};
