require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const port = Number(process.env.PORT || 3000);
const rootDir = __dirname;

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

function mountHandler(route, handlerPath) {
  const handler = require(handlerPath);
  app.all(route, (req, res) => Promise.resolve(handler(req, res)).catch((error) => {
    console.error(`[server] ${route} failed:`, error);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }));
}

mountHandler("/api/config.js", "./api/config");
mountHandler("/api/events", "./api/events");
mountHandler("/api/admin-events", "./api/admin");
mountHandler("/api/event-candidates", "./api/event-candidates");
mountHandler("/api/health", "./api/admin");
mountHandler("/api/refresh-log", "./api/admin");
mountHandler("/api/cron", "./api/cron");
mountHandler("/api/reaction", "./api/reaction");
mountHandler("/api/reactions/total", "./api/reactions-total");
mountHandler("/api/report", "./api/report");
mountHandler("/api/submissions", "./api/submission");
mountHandler("/api/submission-reports", "./api/submission");
mountHandler("/api/submission-audit-log", "./api/submission");
mountHandler("/api/integrations/events/status", "./api/events");
mountHandler("/api/reports", "./api/admin");
mountHandler("/api/reports/:reportId", "./api/admin");
mountHandler("/api/create-payment", "./api/create-payment");
mountHandler("/event/:eventId", "./event-page");
mountHandler("/category/:categoryKey", "./event-page");

app.use(express.static(rootDir));

app.use((req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

app.listen(port, () => {
  console.log(`Taiwan news map running at http://localhost:${port}`);
});
