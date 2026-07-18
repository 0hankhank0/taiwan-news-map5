const { createReport, getPublicReportSummary } = require("../report-store");

const AI_STATUSES = new Set(["valid", "likely_valid", "unclear", "likely_invalid", "spam"]);
const AI_ACTIONS = new Set([
  "check_coordinates",
  "mark_resolved",
  "merge_duplicate",
  "fix_category",
  "ignore",
  "needs_human_review",
]);

function sendJson(res, status, payload) {
  return res.status(status).json(payload);
}

function truncateText(value, maxLength = 1200) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function sanitizeSnapshot(snapshot, fallback = {}) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : fallback;
  return {
    id: source.id || source.eventId || fallback.eventId || "",
    title: truncateText(source.title || source.eventTitle || fallback.title || "", 220),
    content: truncateText(source.content || source.summary || source.text || "", 1200),
    city: source.city || "",
    category: source.category || source.type || "",
    lat: source.lat ?? source.latitude ?? null,
    lng: source.lng ?? source.lon ?? source.longitude ?? null,
    source: source.source || source.sourceName || "",
    sourceName: source.sourceName || source.source || "",
    sourceUrl: source.sourceUrl || source.url || "",
    url: source.url || source.sourceUrl || "",
    publishedAt: source.publishedAt || source.time || "",
    updatedAt: source.updatedAt || "",
    status: source.status || "",
  };
}

function normalizeAiReview(value, fallbackSummary = "AI review unavailable.") {
  const review = value && typeof value === "object" ? value : {};
  const status = AI_STATUSES.has(review.status) ? review.status : "unclear";
  const suggestedAction = AI_ACTIONS.has(review.suggestedAction)
    ? review.suggestedAction
    : "needs_human_review";
  const confidence = Number(review.confidence);
  return {
    status,
    summary: truncateText(review.summary || fallbackSummary, 360),
    suggestedAction,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
  };
}

function fallbackAiReview(summary) {
  return normalizeAiReview({
    status: "unclear",
    summary,
    suggestedAction: "needs_human_review",
    confidence: 0,
  });
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {}
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function getAiProviderConfig() {
  const azureEndpoint = String(process.env.AZURE_OPENAI_ENDPOINT || "").trim().replace(/\/+$/, "");
  const azureApiKey = String(process.env.AZURE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const azureDeployment = String(process.env.AZURE_OPENAI_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "").trim();
  const hasPartialAzureConfig = Boolean(azureEndpoint || process.env.AZURE_OPENAI_API_KEY || azureDeployment);
  if (hasPartialAzureConfig && (!azureEndpoint || !azureApiKey || !azureDeployment)) {
    const missing = [];
    if (!azureEndpoint) missing.push("AZURE_OPENAI_ENDPOINT");
    if (!azureApiKey) missing.push("AZURE_OPENAI_API_KEY");
    if (!azureDeployment) missing.push("AZURE_OPENAI_DEPLOYMENT");
    return {
      provider: "azure-incomplete",
      missing,
    };
  }
  if (azureEndpoint && azureApiKey && azureDeployment) {
    const apiVersion = String(process.env.AZURE_OPENAI_API_VERSION || "2024-02-15-preview").trim();
    return {
      provider: "azure",
      url: `${azureEndpoint}/openai/deployments/${encodeURIComponent(azureDeployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
      headers: {
        "api-key": azureApiKey,
        "Content-Type": "application/json",
      },
      bodyExtra: {},
    };
  }

  const openAiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!openAiKey) return null;
  return {
    provider: "openai",
    url: "https://api.openai.com/v1/chat/completions",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    bodyExtra: {
      model: process.env.REPORT_AI_MODEL || "gpt-4o-mini",
    },
  };
}

async function reviewReportWithAi({ title, eventSnapshot, errorType, message }) {
  const aiConfig = getAiProviderConfig();
  if (!aiConfig) return fallbackAiReview("AI 未啟用，需人工覆核。");
  if (aiConfig.provider === "azure-incomplete") {
    return fallbackAiReview(`Azure OpenAI 設定不完整，缺少 ${aiConfig.missing.join(", ")}，需人工覆核。`);
  }

  const promptPayload = {
    event: {
      title,
      content: eventSnapshot.content,
      city: eventSnapshot.city,
      category: eventSnapshot.category,
      lat: eventSnapshot.lat,
      lng: eventSnapshot.lng,
      source: eventSnapshot.sourceName || eventSnapshot.source,
      sourceUrl: eventSnapshot.sourceUrl || eventSnapshot.url,
      publishedAt: eventSnapshot.publishedAt,
      updatedAt: eventSnapshot.updatedAt,
    },
    userReport: { errorType, message },
  };

  try {
    const response = await fetch(aiConfig.url, {
      method: "POST",
      headers: aiConfig.headers,
      body: JSON.stringify({
        ...aiConfig.bodyExtra,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You review user reports about Taiwan public event map data. Return only JSON with keys status, confidence, summary, suggestedAction. Valid status: valid, likely_valid, unclear, likely_invalid, spam. Valid suggestedAction: check_coordinates, mark_resolved, merge_duplicate, fix_category, ignore, needs_human_review. You only provide a moderation suggestion; never claim data was changed.",
          },
          {
            role: "user",
            content: JSON.stringify(promptPayload),
          },
        ],
      }),
    });

    if (!response.ok) {
      let errorDetail = "";
      try {
        const errorBody = await response.json();
        errorDetail = errorBody?.error?.message || errorBody?.error?.code || "";
      } catch {}
      const error = new Error(`${aiConfig.provider} ${response.status}${errorDetail ? `: ${errorDetail}` : ""}`);
      error.status = response.status;
      error.provider = aiConfig.provider;
      throw error;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    return normalizeAiReview(extractJsonObject(content), "AI 審核結果格式異常，需人工覆核。");
  } catch (error) {
    console.warn("[report] AI review failed:", error.message);
    const providerLabel = error.provider === "azure" ? "Azure OpenAI" : "OpenAI";
    if (error.status === 429) {
      return fallbackAiReview(`AI 審核受 ${providerLabel} 額度或速率限制影響，需人工覆核。`);
    }
    if (error.status === 401 || error.status === 403) {
      return fallbackAiReview(`AI 金鑰未通過 ${providerLabel} 驗證，需人工覆核。`);
    }
    if (error.status === 404 && error.provider === "azure") {
      return fallbackAiReview("AI 審核找不到 Azure OpenAI deployment，需人工覆核。");
    }
    return fallbackAiReview("AI 審核暫時失敗，需人工覆核。");
  }
}

function buildAdminUrl(req, reportId) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  if (!host) return `/admin-reports.html?reportId=${encodeURIComponent(reportId)}`;
  const proto = req.headers["x-forwarded-proto"] || (String(host).includes("localhost") ? "http" : "https");
  return `${proto}://${host}/admin-reports.html?reportId=${encodeURIComponent(reportId)}`;
}

async function notifyDiscord(req, report) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[report] Missing DISCORD_WEBHOOK_URL; report persisted without Discord notification.");
    return;
  }

  const adminUrl = buildAdminUrl(req, report.reportId);
  const sourceUrl = report.eventSnapshot?.sourceUrl || report.eventSnapshot?.url || "";
  const ai = report.aiReview || {};
  const payload = {
    embeds: [
      {
        title: "事件資料回報",
        color: ai.status === "spam" || ai.status === "likely_invalid" ? 10038562 : 15158332,
        fields: [
          { name: "回報編號", value: report.reportId, inline: true },
          { name: "事件 ID", value: report.eventId, inline: true },
          { name: "狀態", value: report.status, inline: true },
          { name: "事件標題", value: truncateText(report.title, 900), inline: false },
          { name: "回報類型", value: report.errorType, inline: true },
          { name: "AI 判斷", value: `${ai.status || "unclear"} (${Math.round((ai.confidence || 0) * 100)}%)`, inline: true },
          { name: "AI 建議", value: ai.suggestedAction || "needs_human_review", inline: true },
          { name: "補充說明", value: truncateText(report.message, 900), inline: false },
          { name: "AI 摘要", value: truncateText(ai.summary || "AI 未啟用", 900), inline: false },
          { name: "後台處理", value: adminUrl, inline: false },
          ...(sourceUrl ? [{ name: "原始來源", value: sourceUrl, inline: false }] : []),
        ],
        timestamp: report.createdAt,
        footer: { text: "台灣即時事件地圖 回報系統" },
      },
    ],
  };

  try {
    const response = await fetch(new URL(webhookUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`Discord webhook HTTP ${response.status}`);
  } catch (error) {
    console.warn("[report] Discord webhook failed:", error.message);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    try {
      return sendJson(res, 200, await getPublicReportSummary());
    } catch (error) {
      console.error("[report] Summary failed:", error.message);
      return sendJson(res, 200, { byEvent: {}, total: 0 });
    }
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const eventId = String(body.eventId || "").trim();
    const title = truncateText(body.title || body.eventTitle || "", 260);
    const errorType = truncateText(body.errorType || body.type || "", 80);
    const message = truncateText(body.message || body.note || "", 1200);

    if (!eventId || !title || !errorType || !message) {
      return sendJson(res, 400, { error: "缺少必要欄位 eventId/title/errorType/message" });
    }

    const eventSnapshot = sanitizeSnapshot(body.eventSnapshot, {
      eventId,
      title,
      content: body.content,
      city: body.city,
      category: body.category,
      sourceUrl: body.sourceUrl || body.url,
    });
    const aiReview = await reviewReportWithAi({ title, eventSnapshot, errorType, message });
    const report = await createReport({
      eventId,
      title,
      eventSnapshot,
      errorType,
      message,
      aiReview,
      status: "ai_reviewed",
    });

    await notifyDiscord(req, report);

    return sendJson(res, 200, {
      success: true,
      reportId: report.reportId,
      status: report.status,
      aiSummary: report.aiReview.summary,
    });
  } catch (error) {
    console.error("[report] API error:", error.message);
    return sendJson(res, 500, { error: "回報送出失敗" });
  }
};
