## Project structure

- `index.html`：主頁 HTML 結構、SEO meta、外部 CDN 引入。
- `styles.css`：所有前端樣式，包含桌機版、手機版、地圖 marker、popup、事件卡片。
- `app.js`：所有前端互動邏輯，包含 Mapbox 初始化、事件渲染、圖釘、篩選、搜尋、互動按鈕。
- `frontend-shared.js`：前後端共用資料處理或格式化邏輯。
- `api/`：Vercel serverless API。
- `scraper.js`：新聞與交通資料爬取、AI 篩選、快取更新。
- `.github/workflows/`：GitHub Actions 定時爬蟲。
- `styles.css` 和 `app.js` 是目前正式前端檔案，不要新增重複的 `main.css`、`css/styles.css`、`js/app.js`，除非同步修改 `index.html` 引用路徑。
