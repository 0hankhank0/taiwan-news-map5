(function loadIslandPulseApp() {
    import("/assets/index/main.mjs?v=location-fix-1").catch((error) => {
        console.error("[island-pulse] failed to load main module", error);
        const status = document.getElementById("status-text");
        if (status) status.textContent = "地圖載入失敗，請重新整理頁面。";
    });
})();
