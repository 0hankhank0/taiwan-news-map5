(function loadIslandPulseApp() {
    import("/assets/index/main.mjs?v=video-demo-2").catch((error) => {
        console.error("[island-pulse] failed to load main module", error);
        const status = document.getElementById("status-text");
        if (status) status.textContent = "前端模組載入失敗，請重新整理。";
    });
})();
