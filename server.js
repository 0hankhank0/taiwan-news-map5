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
mountHandler("/api/payment-callback", "./api/create-payment");
mountHandler("/event/:eventId", "./event-page");
mountHandler("/category/:categoryKey", "./event-page");

app.use("/assets", express.static(path.join(rootDir, "assets"), { dotfiles: "deny" }));
app.use("/shared", express.static(path.join(rootDir, "shared"), { dotfiles: "deny", extensions: false }));
const publicFiles = new Set(["index.html", "submit-event.html", "admin-reports.html", "admin-refresh-log.html", "admin-health.html", "admin-submissions.html", "admin-action-log.html", "admin-events.html", "robots.txt", "sitemap.xml", "brand-logo.jpg", "event-content-filter.js", "event-display.js"]);
app.get("/{*file}", (req, res, next) => {
  const name = req.path.slice(1);
  if (publicFiles.has(name)) return res.sendFile(path.join(rootDir, name));
  next();
});

app.use((req, res) => {
  if (req.method === "GET" && ["/", "/video", "/video/"].includes(req.path)) return res.sendFile(path.join(rootDir, "index.html"));
  res.status(404).json({ error: "Not found" });
});

app.listen(port, process.env.HOST || "127.0.0.1", () => {
  console.log(`Taiwan news map running at http://localhost:${port}`);
});
