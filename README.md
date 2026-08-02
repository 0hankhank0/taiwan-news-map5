# 新聞事件地圖

這是一個以地圖呈現台灣新聞事件、官方公告與交通影響的新聞事件地圖。它不是緊急服務或官方交通指揮系統；重要資訊應以主管機關公告為準。

## 投稿與審核

`/submit-event.html` 用於提交具有公共影響的新聞線索、官方公告或目擊資訊，不是一般生活事件投稿頁。所有新線索都固定以 `pending_admin` 進入審核流程。AI 只分析風險、可信度、缺漏和垃圾內容，不會決定是否發布；必須由管理員人工核准後才會公開。

## 活動生命週期

活動辨識支援活動、展覽、市集、演唱會、賽事、路跑、表演、節慶、講座與工作坊，以及相對應英文關鍵字與分類。沒有時區的日期和日期時間一律依台灣 UTC+8 解析。

- 僅顯示未來 30 天內的活動；超過 30 天永遠隱藏。
- 只有開始時間時，預設持續 24 小時；只有結束時間時，開始時間回推 24 小時。
- 活動期間標示「進行中」，結束後 6 小時標示「剛結束」並保留顯示。
- 超過結束時間 6 小時、排程無效、缺少開始時間的 upcoming/scheduled，或為 cancelled、expired、resolved、cleared 等終止狀態時一律隱藏。
- 未來活動必須由使用者開啟「未來活動」；進行中與剛結束活動不受一般新聞 6h／24h／3d／7d 篩選誤傷。

## API function inventory

`api/` 必須維持少於 12 個 `.js` 入口；rewrite route 是同一個入口的路由別名，不能當成獨立 Serverless Function。合併後文件列出的 9 個入口如下：

- `api/config.js`
- `api/events.js`
- `api/cron.js`
- `api/admin.js`
- `api/submission.js`
- `api/report.js`
- `api/reaction.js`
- `api/reactions-total.js`
- `api/create-payment.js`

合併路由：

```text
api/events.js
- /api/events
- /api/integrations/events/status

api/admin.js
- /api/admin-events
- /api/health
- /api/refresh-log
- /api/reports
- /api/reports/:reportId

api/submission.js
- /api/submissions
- /api/submission-reports
- /api/submission-audit-log
```

## API 使用方式

公開 API：

- `GET /api/config`：讀取前端公開設定。
- `GET /api/events`：事件清單；可帶事件篩選 query 參數。`GET /api/integrations/events/status`：整合來源同步狀態。
- `POST /api/submissions`：提交公共影響線索（body 為線索、來源與位置資料）；`GET /api/submissions?status=approved&limit=n`：讀取公開核准投稿。
- `POST /api/report`：回報事件問題（body 為事件識別與原因）。
- `GET /api/reaction?eventIds=id1,id2`：讀取反應；`POST /api/reaction`（`eventId`、`type`）：送出反應；`GET /api/reactions/total`：讀取總數。
- `POST /api/create-payment`（`amount`、`itemName`）：建立付款資訊。

管理與維運 API：

- `GET|POST /api/cron`（`mode` 可由 query 或 body 指定）：執行受控資料更新，需 `CRON_SECRET`。
- `/api/admin-events`、`/api/health`、`/api/refresh-log`、`/api/reports` 與 `/api/reports/:reportId`：管理事件、健康狀態、更新紀錄及回報，使用 `REPORT_ADMIN_TOKEN`。
- `GET|PATCH /api/submissions`：管理員可依 `status`、`limit` 查詢或以 `submissionId` 與 body 更新審核；`POST /api/submission-reports`、`GET /api/submission-audit-log` 亦使用 `REPORT_ADMIN_TOKEN`。

`REPORT_ADMIN_TOKEN` 是人工審核和管理資料的授權；`CRON_SECRET` 只授權排程／手動抓取觸發。兩者不可互相替代，也不可放到前端。

## 本機開發與測試

Windows 請使用 `npm.cmd`：

```powershell
npm.cmd install
npm.cmd start
npm.cmd run test:news-map-modules
npm.cmd run test:homepage-news-focus
npm.cmd run test:news-map-ui
npm.cmd test
```

共用 helper 請放在 `api/` 外，避免被 Vercel 計入 function 入口。活動、新聞、TDX、PBS、iCulture 與 KKTIX 的抓取和合併規則由既有資料管線維護。
