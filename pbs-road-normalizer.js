"use strict";

const crypto = require("node:crypto");
const { resolveLocationSync } = require("./location-resolver");

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const isoTaipei = (value) => {
  const text = clean(value);
  if (!text) return null;
  const parsed = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(?:\.\d+)?$/.exec(text);
  const date = new Date(parsed ? `${parsed[1]}T${parsed[2]}+08:00` : text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const fingerprint = (record) => crypto.createHash("sha256").update(JSON.stringify([record.name, record.region, record.area_sn, record.highway, record.direction, record.comment, record.happendate, record.happentime].map(clean))).digest("hex").slice(0, 32);
function categoryFor(record) {
  const text = clean(`${record.name} ${record.comment}`);
  if (/[\u8eca\u798d\u4e8b\u6545\u78b0\u649e]/.test(text)) return "accident";
  if (/[\u65bd\u5de5\u5de5\u7a0b]/.test(text)) return "construction";
  if (/[\u6df9\u6c34\u843d\u77f3\u574d\u65b9\u98b1\u98a8\u5730\u9707]/.test(text)) return "disaster";
  return "traffic";
}
function cityForRegion(value) {
  const region = clean(value).toUpperCase();
  return ({ N: "Taipei", C: "Taichung", S: "Tainan", E: "Hualien" })[region] || clean(value) || "Taiwan";
}
function normalizePbsRoadRecord(record, now = new Date().toISOString()) {
  const number = clean(record.number);
  const fallback = fingerprint(record);
  const id = `pbs:${number || fallback}`;
  const locationText = clean([record.name, record.area_sn, record.highway, record.direction, record.comment].filter(Boolean).join(" "));
  const location = resolveLocationSync({ city: cityForRegion(record.region), name: record.name, title: locationText, content: clean(record.comment), location: locationText });
  const title = clean([record.roadtype, record.highway, record.name].filter(Boolean).join(" ")) || "PBS road event";
  const sourceUpdatedAt = isoTaipei(record.lastmodified) || isoTaipei(`${clean(record.happendate)} ${clean(record.happentime)}`);
  return {
    id, eventFingerprint: id, source: "pbs", sourceName: "PBS", sourceRecordId: number || fallback,
    sourceRegion: clean(record.region) || null, adminCode: clean(record.area_sn) || null, sourceUpdatedAt,
    title, content: clean(record.comment) || title, summary: clean(record.comment) || title, category: categoryFor(record),
    city: location.city || "Taiwan", lat: location.lat, lng: location.lng, locationText,
    ...location, createdAt: now, updatedAt: sourceUpdatedAt || now, raw: { ...record },
  };
}
function normalizePbsRoadRecords(records, now) { return (Array.isArray(records) ? records : []).map((record) => normalizePbsRoadRecord(record, now)).filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng)); }
module.exports = { categoryFor, cityForRegion, isoTaipei, normalizePbsRoadRecord, normalizePbsRoadRecords };
