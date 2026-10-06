# 全專案診斷報告

日期：2026-10-06（台灣）。範圍：目前本機工作目錄，包含前兩輪尚未推送的修正。

## 結論

診斷確認 11 項問題；下方保留原始重現紀錄。後續依「修」的指示完成程式修正與回歸測試，涵蓋投稿公開狀態、資料保存、Supabase 分頁、付款回呼、API 顯示欄位、部署檢查與前端篩選。

本報告記錄本機修正與測試結果。正式 Supabase、Redis、Vercel 與實際金流尚未驗證；推送程式碼後仍需確認部署結果。

## 修正狀態（2026-10-06）

| 原問題 | 已完成的修正與驗證 |
| --- | --- |
| 1 投稿撤回與公開資料不同步 | 核准更新同一投稿事件；退回、隱藏、到期撤下；公開讀取以投稿現況為準，避免跨儲存同步失敗留下舊資料。測試核准、退回、再核准、隱藏與到期 |
| 2 投稿發布遺失時間 | 保存開始、結束、到期、發布與事件時間，明確標示 eventKind；輸入無時區時間轉為台灣時間；活動預設 24 小時加 6 小時保留 |
| 3 並行寫入覆蓋 | 投稿、審核更新、檢舉與回報使用 Redis/SQLite 共用鎖；Redis Lua 提交會檢查鎖擁有者，阻擋過期鎖寫入。測試並行 20 筆及鎖過期 |
| 4 保存失敗回報成功 | 持久儲存讀寫錯誤拋出，API 回報 503；正式環境不以本機暫存假裝成功。測試 Redis GET、SET、提交失敗 |
| 5 Supabase 單頁截斷 | 正式事件、候選、PBS 以穩定排序每頁 500 筆讀取，檢查 exact count；空缺頁或數量變動中止。三個實際 repository 各模擬 1,201 筆 |
| 6 本機檔案公開 | 只提供指定頁面、公開資產和共用前端模組，未知路由 404；預設綁定 127.0.0.1。HTTP 測試原始碼、設定與 SQLite 不可讀取 |
| 7 付款回呼缺失 | 共用既有付款 function，加入 callback rewrite；建立訂單先保存，再產生 HTML；驗證 CheckMacValue、商店、金額、訂單與模擬付款旗標，重送保留相同入帳結果。通過綠界官方簽章測試值與模擬回呼，未實際交易 |
| 8 公開 API 遺失顯示欄位 | 保留 severity、verifiedStatus、reviewState，以及逐欄過濾的 sourceTrace；測試內部欄位不外洩 |
| 9 Preview 網域拒絕正常網址 | 修正單層 Vercel 主機驗證，保留 HTTPS、origin 與正式環境隔離檢查；測試正常與偽冒網域 |
| 10 API 台／臺篩選不一致 | city、q 使用一致文字正規化，搜尋也包含來源名稱 |
| 11 缺失座標變成零 | 空白、null、undefined、布林與超出地理範圍座標不進入 bounds；合法 0,0 仍可使用 |

另外完成公開回報的原子限流、重複回報防護、正式事件存在檢查與 AI 逾時；health 改讀正式事件；npm test 自動包含全部離線測試；補齊手動抓取工作流程環境變數，更新 function 清單與 Bearer 授權部署說明。

本機測試隔離資料庫與網路模擬，沒有發送 Discord 通知或進行實際付款。`PAYMENT_BASE_URL` 必須設定為部署的公開 HTTPS 網域。現有付款 SDK 的簽章函式會記錄包含金鑰的原文，因此改用不記錄金鑰的 SHA256 計算，依據[綠界檢查碼規格](https://developers.ecpay.com.tw/2902/)並通過官方測試範例。

## 驗證範圍與結果

| 檢查 | 結果與限制 |
| --- | --- |
| JavaScript / ES module 語法 | 修正後 140 個追蹤及新增檔案通過 `node --check` |
| 離線回歸測試 | 修正後 51／51 組測試通過，包含 Playwright；`npm test` 自動執行全部離線測試，正式 Supabase 測試保留獨立命令 |
| 自訂重現 | 12 個隔離情境，整理成下列 11 項問題；使用暫存 SQLite、假資料與模擬上游回應 |
| HTML 靜態引用 | 檢查 9 個 HTML；唯一沒有本機檔案的引用是 Vercel 注入的 `/_vercel/insights/script.js`，不列為缺檔 bug |
| API / 後台授權 | 檢查管理員 Bearer token、cron secret、公開 payload、投稿發布流程 |
| 排程 / 部署 | 檢查 GitHub Actions、Vercel rewrites、函式數量、部署文件與 CI 測試集合 |
| SQL | 檢查發布交易、snapshot 替換、RLS 與 service_role 權限；未連接正式資料庫 |
| 線上服務 | Supabase 整合測試先前連線失敗；正式 Vercel、Redis、GitHub Actions 執行紀錄與實際金流交易未驗證 |

## 已重現的問題

P1：優先修正，可能影響資料完整性、審核或資料存取。P2：功能或部署缺陷。P3：邊界情境。

### 1. P1 — 投稿退回、隱藏或過期後，公開事件沒有同步撤下

- 位置：`submission-store.js:110`，`event-store.js:462`，`api/events.js:46`。
- 重現：建立投稿 → 核准 → 退回。投稿清單已是 `rejected`，`getPublicMapSubmissionEvents()` 回傳 0 筆，但正式事件集合與 `/api/events` 仍包含該投稿。
- 原因：`updateSubmission()` 只在核准時發布，其他狀態沒有撤下正式事件；投稿自動到期也只更新投稿清單。
- 影響：管理員的審核狀態不等於公開發布狀態。既有來源時間有效時，事件仍可能顯示；分享頁與直接 API 也仍可取得。
- 修正方向：以 `submissionId` 維持唯一發布關係；核准、撤回、檢舉隱藏與到期都要更新同一正式事件，並在失敗時保持狀態一致。

### 2. P1 — 核准投稿遺失活動排程、到期與發布時間

- 位置：`submission-store.js:120`。
- 重現：帶 `eventStartTime`、`eventEndTime`、`expirationTime` 的活動投稿核准後，正式事件的 `startsAt`、`endsAt`、`expiresAt`、`publishedAt` 全部未設定。
- 另一次重現：交通投稿核准後，正式事件缺少發布／發生時間，經正常化後不符合前端預設 24 小時篩選。
- 影響：可造成「後台已核准，前台看不到」，或活動失去未來、進行中、結束與到期判斷。不能用抓取時間補造來源發布時間。
- 修正方向：發布時完整映射投稿排程、核准發布時間及到期時間，清楚區分來源時間與本站發布時間。

### 3. P1 — 並行投稿會互相覆寫

- 位置：`submission-store.js:12`、`:17`；`report-store.js` 也使用相同讀取整份清單再覆寫的模式。
- 重現：`Promise.all([createSubmission(A), createSubmission(B)])` 回傳兩筆成功，最後只存下一筆。
- 原因：先讀後寫沒有交易、compare-and-set 或跨實例鎖。只增加單一程序內的鎖不足以保護 Vercel 多實例。
- 修正方向：改成每筆資料獨立儲存，以数据库交易或 Redis 原子操作保護修改；同時檢查審核日誌、檢舉與速率計數。

### 4. P1 — 儲存服務失敗仍回報投稿成功

- 位置：`submission-store.js:14`，`event-store.js:277`。
- 重現：production 模式中，模擬 Redis GET / SET 失敗。`createSubmission()` 仍回傳有效 ID，但讀取清單是空的。
- 原因：`setCachedValue()` 回傳 `false`，投稿儲存程式没有檢查結果。
- 影響：使用者收到成功訊息，資料實際未保存。讀取失敗被當成空清單，也可能讓恢復後的整份覆寫移除舊資料。
- 修正方向：區分不存在與讀取失敗；必要資料寫入失敗必須拋錯，API 應回覆可重試的服務錯誤。

### 5. P1 — Supabase 讀取未分頁，達到上限後可能截斷資料

- 位置：`supabase-event-repository.js:4`、`:6`，`supabase-pbs-repository.js` 的 active-events 查詢。
- 重現：模擬 1001 筆資料、每次回應上限 1000 筆，正式事件讀取只發出一次請求，沒有 range，回傳 1000 筆。
- 觸發條件：資料超過專案 API 的 Max Rows。Supabase 官方文件說明預設上限為 1000 筆，應以 range 分頁；正式專案實際設定尚未讀取。[Supabase 文件](https://supabase.com/docs/reference/python/select)
- 額外風險：refresh 以這份不完整資料建立 snapshot；SQL 會刪除不在 snapshot 的 refresh-owned rows。這是依程式碼與 SQL 推導的資料刪除風險，沒有在正式資料庫執行驗證。
- 修正方向：使用穩定排序與分頁讀完整集合，或把合併／替換移到資料庫；截斷資料不可直接當完整 snapshot。

### 6. P1 — 本機伺服器可下載工作目錄內的資料檔

- 位置：`server.js:41`、`:47`。
- 重現：建立不含真實資料的 `.sqlite` 測試檔，透過 HTTP 取得 200 與完整檔案內容。實際監聽位址是 `::`，未限制 loopback。
- 觸發條件：使用 `node server.js`，且伺服器可被其他裝置或反向代理存取。預設 SQLite 位於工作目錄的 `data/` 下，也在靜態檔案服務範圍內。
- 限制：這是本機 Express 伺服器問題；不能據此斷言 Vercel 也暴露 SQLite，因為 `.vercelignore` 已排除 SQLite 檔案。
- 修正方向：靜態檔案使用公開資產白名單，阻擋資料／後端／工具目錄；本機預設綁定 `127.0.0.1`。

### 7. P2 — 金流設定的付款通知 callback 沒有實作

- 位置：`api/create-payment.js:52`，`server.js`，`vercel.json`。
- 重現：POST `/api/payment-callback`，本機回傳 200 HTML 首頁，沒有處理付款結果。
- 原因：建立付款表單時指定該 ReturnURL，但專案沒有對應 handler、驗章與交易落庫流程。
- 影響：本站無法可靠接收及確認付款結果。綠界要求收到通知並驗證後回覆 `1|OK`。[綠界文件](https://developers.ecpay.com.tw/2858/)
- 修正方向：實作獨立 callback、CheckMacValue 驗證、訂單持久化與冪等處理；不能只回覆成功字串。

### 8. P2 — 公開 API 移除了前端需要的來源與覆核資訊

- 位置：`api/events.js:7`。
- 重現：輸入含 `sourceTrace`、`verifiedStatus`、`reviewState`、`severity` 的事件，`publicEvent()` 全部移除這些欄位。
- 影響：多來源報導與覆核顯示無法反映資料；部分前端測試直接回傳完整 fixture，沒有經過正式公開 API，因而未發現契約落差。
- 修正方向：定義前後端共用的公開欄位契約；來源明細另做安全投影，不可直接公開 internal/raw payload。

### 9. P2 — Preview 煙霧測試拒絕正常 Vercel 網址

- 位置：`.github/workflows/preview-smoke-test.yml:73`。
- 重現：`project-abc-team.vercel.app` 驗證結果為 false；`project.team.vercel.app` 為 true。
- 原因：regex 在 `.vercel.app` 前額外要求至少一段帶點的 host label。
- 影響：一般 Preview origin 會在開始驗證時被拒絕，煙霧測試無法執行。
- 修正方向：允許單一合法 preview label，同時保留 HTTPS、origin、正式環境比對及隔離確認。

### 10. P2 — API 與前端的縣市篩選規則不一致

- 位置：`event-query.js:24`。
- 重現：資料為 `臺北市`，API query `city=台北` 回傳 0 筆。前一輪修正的前端已能匹配。
- 影響：同一資料在 API 與前端得到不同結果；目前首頁先載入全部資料，所以前端修正不代表 API 也已修正。
- 修正方向：共用縣市與文字正規化規則，再測試正式 API 回應。

### 11. P3 — 缺少座標被當成零座標

- 位置：`assets/index/modules/map-bounds-filter.mjs:12`。
- 重現：`{lat:null,lng:null}` 在涵蓋原點的 bounds 中被判定為區域內事件。
- 原因：`Number(null)` 和 `Number('')` 是 0，有限數字檢查無法辨識缺失值。
- 影響：世界地圖區域篩選等涵蓋原點的情境會錯誤納入無定位事件；台灣附近 bounds 通常不會觸發。
- 修正方向：轉換數字前先拒絕 null、空字串與缺少欄位，再驗證座標範圍。

## 額外程式碼與設定缺口

以下是程式碼檢查發現，未以正式服務或壓測驗證，與上述隔離重現區分。

1. **公開回報缺少伺服器端速率限制。** `api/report.js:294` 每次有效 POST 都可能呼叫 AI、寫入資料並發送 Discord 通知。未做流量攻擊、未發送真實通知；建議加入原子速率限制、事件存在驗證與重複回報保護。
2. **健康頁讀取兼容 cache，不是 canonical events。** `admin-handlers/health.js:54` 使用 `getCachedEvents()`，正式事件 API 使用 `getOfficialEvents()`；Supabase 發布或修改只更新正式集合時，後台健康統計可能與公開 API 不一致。
3. **預設 CI 漏掉 8 個可離線執行的測試檔案。** 46 個測試中，預設 `npm test` 涵蓋 37 個；另外 1 個 staging Supabase 測試應維持獨立。漏掉的離線測試包括 official security、TDX quota guard、production cron regressions、candidate publish、collector status、location picker、homepage focus、mobile stats。
4. **手動 scraper workflow 與部署文件過時。** `news.yml` / `traffic.yml` 只注入部分 Azure 參數，沒有 endpoint、API version；程式要求四項設定，因此 CI runner 上 AI 會被跳過。部署清單仍引用已移除的 `api/admin-events.js`、`api/health.js`，並推薦目前不支援的 query-token 授權方式。README 的 API inventory 列 9 個，但實際是 11 個入口。

## 建議修正順序

1. 修正投稿發布／撤回／到期同步，補齊公開事件的時間欄位。
2. 修正資料保存失敗處理與並行寫入，加入真正的原子操作。
3. 修正 Supabase 分頁與 snapshot 完整性，避免把截斷資料當完整集合。
4. 限制本機靜態檔案範圍與監聽介面。
5. 修正公開 API 契約、Preview 驗證、API 縣市篩選與 CI 覆蓋。
6. 以金流測試環境補齊付款確認；在隔離 staging 驗證 Supabase、Redis、排程及健康頁一致性。

## 重現工具

隔離工具：`test-artifacts/project-diagnostics/probe.cjs`。

```powershell
node test-artifacts/project-diagnostics/probe.cjs
```

輸出：同目錄的 `results.json`；語法檢查結果：`syntax.json`。此目錄受 `.gitignore` 排除。工具會短暫啟動本機 HTTP 伺服器、使用暫存資料庫與假 SQLite 檔案，測試完關閉伺服器並移除假檔案。未對正式資料進行寫入，也未觸發正式抓取、AI 或付款。
