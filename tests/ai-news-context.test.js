const assert = require("assert");
const {
  ARTICLE_CONTEXT_MAX_CHARS,
  buildFallbackNewsContext,
  extractArticleContextFromHtml,
  fetchNewsContext,
  normalizeAiExtractedEvents,
} = require("../ai-news-context");

async function run() {
  const html = `
    <html>
      <head>
        <meta name="description" content="台北市信義區松仁路發生火警，消防到場搶救。">
        <script>window.ad = true;</script>
        <style>.ad{display:none}</style>
      </head>
      <body>
        <nav>會員登入 訂閱 分享</nav>
        <article>
          <p>今天上午台北市信義區松仁路與松壽路口發生火災，現場濃煙竄出。</p>
          <p>消防局派員到場搶救，警方在周邊進行交通管制。</p>
          <p>推薦閱讀：其他熱門新聞</p>
        </article>
      </body>
    </html>
  `;

  const context = extractArticleContextFromHtml(html);
  assert(context.includes("台北市信義區松仁路"), context);
  assert(context.includes("交通管制"), context);
  assert(!context.includes("window.ad"), context);
  assert(!context.includes("會員登入"), context);
  assert(context.length <= ARTICLE_CONTEXT_MAX_CHARS);

  const fallback = buildFallbackNewsContext({
    title: "新聞標題",
    contentSnippet: "RSS 摘要提到高雄市鼓山區道路坍方。",
    link: "https://example.test/news",
  });
  assert.equal(fallback.contextSource, "rss");
  assert(fallback.content.includes("高雄市鼓山區"));

  const fetched = await fetchNewsContext({
    title: "火警",
    contentSnippet: "RSS 摘要",
    link: "https://example.test/full",
  }, {
    axios: {
      get: async () => ({
        headers: { "content-type": "text/html; charset=utf-8" },
        data: html,
      }),
    },
  });
  assert.equal(fetched.contextSource, "article");
  assert(fetched.content.includes("松仁路"));

  const failedFetch = await fetchNewsContext({
    title: "失敗新聞",
    contentSnippet: "RSS fallback 摘要",
    link: "https://example.test/403",
  }, {
    axios: { get: async () => { throw new Error("403"); } },
  });
  assert.equal(failedFetch.contextSource, "rss");
  assert(failedFetch.content.includes("RSS fallback"));

  const normalized = normalizeAiExtractedEvents([
    {
      title: "台北火警",
      content: "信義區火警，現場交通管制。",
      category: "fire",
      url: "https://example.test/a",
      lat: 25.033,
      lng: 121.5654,
      city: "台北市",
      locationText: "台北市信義區松仁路與松壽路口",
      locationEvidence: "台北市信義區松仁路與松壽路口發生火災",
      locationPrecision: "exact",
      locationConfidence: 0.92,
      source: "news",
      eventFingerprint: "taipei_fire_songren",
    },
    {
      title: "只有城市",
      content: "台南市發布活動消息。",
      category: "activity",
      url: "https://example.test/b",
      lat: 0,
      lng: 0,
      city: "台南市",
      locationText: "台南市",
      locationEvidence: "活動在台南市舉行",
      locationPrecision: "city",
      locationConfidence: 0.7,
      source: "news",
      eventFingerprint: "tainan_activity_city",
    },
    {
      title: "低信心",
      content: "背景提到很多地名。",
      category: "other",
      url: "https://example.test/c",
      lat: 25,
      lng: 121,
      city: "台北市",
      locationText: "",
      locationEvidence: "",
      locationPrecision: "unknown",
      locationConfidence: 0.2,
      source: "news",
      eventFingerprint: "low_confidence",
    },
  ]);

  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].locationPrecision, "exact");
  assert.equal(normalized[0].locationQuery, "台北市信義區松仁路與松壽路口");
  assert.equal(normalized[1].locationPrecision, "city");
  assert(Number.isFinite(normalized[1].lat));
  assert(!normalized.some((event) => event.eventFingerprint === "low_confidence"));

  console.log("ai-news-context tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
