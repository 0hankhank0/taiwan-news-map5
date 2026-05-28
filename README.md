# Island Pulse split frontend

已從單一 `index.html` 分割成：

- `index.html`：頁面結構、SEO、外部 CDN、JSON-LD
- `css/styles.css`：原本 `<style>` 內的全部樣式
- `js/app.js`：原本一般 inline `<script>` 內的全部前端邏輯
- `assets/og-image.png`：分享圖素材

部署到 Vercel 時保持整個資料夾結構即可。
