const categories = require("./event-categories");

const CATEGORY_SOURCES = new Set(["manual", "official", "rule", "ai", "fallback"]);

function plain(value, max) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function validateAiCategoryResult(input = {}) {
  const rawCategory = String(input.category || "").trim().toLowerCase();
  const confidence = Number(input.categoryConfidence);
  const categoryReason = plain(input.categoryReason, 180);
  if (!Object.prototype.hasOwnProperty.call(categories.NEWS_CATEGORIES, rawCategory)) return { valid: false, reason: "invalid_category" };
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return { valid: false, reason: "invalid_confidence" };
  if (!categoryReason) return { valid: false, reason: "missing_reason" };
  return { valid: true, value: { category: rawCategory, categoryConfidence: confidence, categoryReason, secondaryTags: categories.normalizeSecondaryTags((Array.isArray(input.secondaryTags) ? input.secondaryTags : []).map((tag) => plain(tag, 12))), sourceCategory: plain(input.sourceCategory, 80) } };
}

function resolveEventCategory(input = {}) {
  const manual = categories.normalizeEventCategory(input.manualCategory);
  if (input.manualCategory && manual !== "other") return { category: manual, categorySource: "manual", reviewState: "reviewed", autoPublish: true };
  const official = categories.normalizeEventCategory(input.officialCategory);
  if (input.officialCategory && official !== "other") return { category: official, categorySource: "official", reviewState: "reviewed", autoPublish: true };
  const rule = categories.normalizeEventCategory(input.ruleCategory);
  if (input.ruleCategory && rule !== "other") return { category: rule, categorySource: "rule", reviewState: "reviewed", autoPublish: true };
  const validated = input.aiResult || validateAiCategoryResult(input);
  if (validated.valid) {
    const result = { ...validated.value, categorySource: "ai" };
    return result.categoryConfidence >= 0.8 ? { ...result, reviewState: "unreviewed", autoPublish: true } : { ...result, reviewState: "pending_review", autoPublish: false };
  }
  return { category: "other", categorySource: "fallback", reviewState: "pending_review", autoPublish: false, categoryError: validated.reason || "ai_unavailable" };
}

module.exports = { CATEGORY_SOURCES, validateAiCategoryResult, resolveEventCategory };
