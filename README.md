# Taiwan News Map / Island Pulse

Beta 版台灣事件地圖。此專案把新聞、交通、活動與公共事件整理成地圖點位，提供一般模式、出門前模式、TW Online 模式、回報機制、beta 後台與營運監控。

此服務不是官方警報系統。資料可能有延遲或錯誤，所有人工修正與回報都應視為 beta 覆核流程。

## Project Structure

- `index.html`: 主頁 HTML、SEO metadata、CDN imports、前端資產入口。
- `assets/index/main.js`: Mapbox 地圖、事件渲染、篩選、附近模式、回報、贊助與 beta 信任標籤。
- `assets/index/index.css`: 主頁、卡片、地圖 marker、popup、modal、RWD 樣式。
- `assets/index/data-trust.js`: 事件資料狀態與信任面板。
- `api/`: Vercel Serverless Functions。Hobby plan 上限是 12 個 function，目前維持 11 個。
- `event-store.js`: 事件快取、KV/SQLite fallback、人工覆核更新。
- `event-normalizer.js`: API 輸出正規化、去重、beta 可信度欄位。
- `location-resolver.js`: 地點解析、城市範圍、已知地標、定位可信度。
- `report-store.js`: 使用者回報儲存、回報狀態與公開統計。
- `scraper.js`: GitHub Actions 使用的新聞/交通抓取器。
- `.github/workflows/`: 排程抓取新聞與交通資料。
- `tests/`: Node 測試，涵蓋定位與 admin API。

## Public Pages

- `/`: 事件地圖 beta 主頁。
- `/poster-gallery.html`, `/poster-export.html`: 海報/圖像輸出相關頁面。
- `/video-opening.html`: 開場視覺頁面。

## Admin Pages

所有後台都使用 `REPORT_ADMIN_TOKEN`。

- `/admin-reports.html`: 使用者回報審核。
- `/admin-events.html`: 事件管理，可修座標、分類、狀態、合併事件、加管理備註。
- `/admin-health.html`: beta 監控頁，顯示事件數、來源分布、快取狀態、待處理回報與整合設定是否存在。

## API Inventory

Vercel Hobby plan 不能超過 12 個 Serverless Functions。不要把 helper 放進 `api/`，否則也會被算成 function。

Current functions:

- `/api/config.js`: Mapbox public token bootstrap.
- `/api/events`: 事件清單 API。
- `/api/cron`: Vercel cron/manual trigger 用資料抓取 API。
- `/api/admin-events`: 後台事件管理 API。
- `/api/health`: 後台監控 API。
- `/api/report`: 使用者事件回報 API。
- `/api/reports`: 後台回報列表與更新 API。
- `/api/reports/[reportId]`: 單筆回報 route wrapper。
- `/api/reaction`: 事件反應 API。
- `/api/reactions/total`: 反應總數 API。
- `/api/create-payment`: 綠界支持維護付款入口。

Shared helpers must stay outside `api/`:

- `admin-auth.js`
- `event-normalizer.js`
- `event-store.js`
- `location-resolver.js`
- `report-store.js`
- `reaction-store.js`

## Environment Variables

Core:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `REPORT_ADMIN_TOKEN`
- `CRON_SECRET`
- `MAPBOX_PUBLIC_TOKEN`

Optional/enrichment:

- `MAPBOX_GEOCODING_TOKEN`
- `TDX_CLIENT_ID`
- `TDX_CLIENT_SECRET`
- `OPENAI_API_KEY`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_DEPLOYMENT`
- `DISCORD_WEBHOOK_URL`

Payments:

- `ECPAY_MERCHANT_ID`
- `ECPAY_HASH_KEY`
- `ECPAY_HASH_IV`

Local-only:

- `EVENT_DB_PATH`
- `DISABLE_LOCAL_EVENT_CACHE`
- `MAX_GEOCODING_PER_CRON`

## Commands

```bash
npm install
npm start
npm run test:location
npm run test:admin
```

`npm start` runs `server.js` locally. Local data may be empty unless KV env vars or a local SQLite cache are available.

## Deployment Notes

- Keep `api/` under 12 `.js` files for Vercel Hobby deployment.
- Keep shared helper modules outside `api/`.
- Keep `node_modules`, `.git`, `.vercel`, `data`, `exports`, and tests out of deployment uploads where possible.
- After changing event schema or admin APIs, run:
  - `npm run test:location`
  - `npm run test:admin`
  - `node --check` on changed API/frontend files.

## Current Beta Product Scope

Implemented:

- Event map and list UI.
- Category/city/search/nearby filtering.
- TW Online and statistics views.
- Event report flow and AI moderation suggestion.
- Admin report review.
- Admin event edits and merge/resolved workflow.
- Health dashboard.
- Location precision labels: exact, district, city, unknown.
- Source trace and review state fields.

Still beta:

- Events are derived from third-party/news/traffic sources.
- Manual review changes affect cached display data.
- No full user account system.
- No formal incident SLA.
- Not an official emergency or traffic authority source.
