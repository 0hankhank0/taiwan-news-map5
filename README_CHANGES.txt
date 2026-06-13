Island Pulse frontend fixed package

變更重點：
1. index.html 已套用截圖中的前端視覺版本。
2. app.js 的事件圖釘改為「0x0 座標外層 + 內層圖釘 visual translate(-50%, -100%)」。
3. Mapbox marker 使用 anchor:center + offset [0,0]，讓座標點鎖在圖釘尖端。
4. Leaflet fallback 也改成 iconSize [0,0] / iconAnchor [0,0]，避免縮放或 fallback 時圖釘漂移。
5. styles.css 最後追加穩定錨點覆蓋，外部 CSS 版本也會吃到同樣修正。

部署：
- 把整包內容放到 repo 根目錄。
- GitHub Actions 檔案已放在 .github/workflows/。

2026-06-13 update:
- 精簡一般模式分類篩選列，只保留：全部事件、交通、災害。
- 意外與活動事件仍會出現在「全部事件」中，事件卡片與圖釘分類保留，但不再佔用篩選列空間。

- 分類篩選改為參考截圖的五顆膠囊按鈕：全部事件、交通、災害、意外、活動；並使用群組分類讓意外/活動/災害能正確篩選。
