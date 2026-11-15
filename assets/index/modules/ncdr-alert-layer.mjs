const SOURCE = "ncdr-alerts";
const COLOR = "#f59e0b";
const REFRESH_MS = 60_000;
const taipeiTime = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short"
});

export function initNcdrAlertLayer(map) {
    const toggle = document.getElementById("ncdr-alert-toggle");
    const panel = document.getElementById("ncdr-alert-panel");
    const status = document.getElementById("ncdr-alert-status");
    const list = document.getElementById("ncdr-alert-list");
    if (!toggle || !panel || !status || !list) return () => {};

    let alerts = [];
    let failure = false;
    let request;
    let refreshTimer;
    let expiryTimer;
    let fallbackMap;
    let leafletLayer;
    let mapRemoved = false;
    const featuresFor = alert => alert.areas.flatMap(area => area.geometries.map(geometry => ({
        type: "Feature", geometry, properties: {}
    })));

    function draw(features) {
        const data = { type: "FeatureCollection", features };
        if (fallbackMap) {
            leafletLayer ??= window.L.geoJSON(null, {
                style: { color: COLOR, weight: 2, fillOpacity: 0.2, interactive: false },
                pointToLayer: (_feature, latlng) => window.L.circleMarker(latlng, {
                    radius: 7, color: COLOR, fillOpacity: 0.9, interactive: false
                })
            }).addTo(fallbackMap);
            leafletLayer.clearLayers().addData(data);
            return;
        }
        if (mapRemoved) return;
        const source = map.getSource(SOURCE);
        if (source) {
            source.setData(data);
            return;
        }
        if (!features.length || !map.isStyleLoaded()) return;
        map.addSource(SOURCE, { type: "geojson", data });
        map.addLayer({ id: SOURCE + "-fill", source: SOURCE, type: "fill", paint: { "fill-color": COLOR, "fill-opacity": 0.22 } });
        map.addLayer({ id: SOURCE + "-line", source: SOURCE, type: "line", paint: { "line-color": COLOR, "line-width": 2 } });
        map.addLayer({ id: SOURCE + "-point", source: SOURCE, type: "circle", filter: ["==", "$type", "Point"], paint: {
            "circle-color": COLOR, "circle-radius": 7, "circle-stroke-color": "#392509", "circle-stroke-width": 2
        } });
    }

    function zoomTo(features) {
        const points = features.flatMap(({ geometry }) => geometry.type === "Point" ? [geometry.coordinates] : geometry.coordinates.flat());
        if (!points.length) return;
        if (fallbackMap) {
            fallbackMap.fitBounds(points.map(([lng, lat]) => [lat, lng]), { maxZoom: 13, padding: [32, 32] });
        } else if (!mapRemoved) {
            const bounds = points.reduce((result, point) => result.extend(point), new mapboxgl.LngLatBounds());
            map.fitBounds(bounds, { maxZoom: 13, padding: 48 });
        }
    }

    function render() {
        clearTimeout(expiryTimer);
        if (panel.hidden) {
            draw([]);
            return;
        }
        const now = Date.now();
        const current = alerts.filter(alert => Date.parse(alert.expiresAt) > now).map(alert => ({
            ...alert,
            areas: alert.areas.filter(area => Date.parse(area.expiresAt) > now)
        }));
        draw(current.flatMap(featuresFor));
        if (failure) status.textContent = "暫時無法更新官方示警，稍後將自動重試。";
        else if (current.length) status.textContent = "目前 " + current.length + " 則生效中的示警";
        else status.textContent = request ? "正在載入示警…" : "目前沒有生效中的示警。";
        list.replaceChildren(...current.map(alert => {
            const item = document.createElement("li");
            const title = document.createElement("strong");
            title.textContent = alert.title;
            const details = document.createElement("p");
            details.textContent = [...new Set([alert.category, alert.publisher, ...alert.areas.map(area => area.name)].filter(Boolean))].join(" · ");
            const time = document.createElement("p");
            time.textContent = taipeiTime.format(new Date(alert.publishedAt)) + " 發布 · " + taipeiTime.format(new Date(alert.expiresAt)) + " 到期";
            const link = document.createElement("a");
            link.href = alert.url;
            link.target = "_blank";
            link.rel = "noopener";
            link.textContent = "原始公告";
            item.append(title, details, time);
            if (alert.description) {
                const description = document.createElement("p");
                description.textContent = alert.description;
                item.append(description);
            }
            item.append(link);
            const features = featuresFor(alert);
            if (features.length) {
                const locate = document.createElement("button");
                locate.type = "button";
                locate.textContent = "在地圖上查看";
                locate.addEventListener("click", () => zoomTo(features));
                item.append(locate);
            }
            return item;
        }));
        const nextExpiry = Math.min(...current.flatMap(alert => [alert.expiresAt, ...alert.areas.map(area => area.expiresAt)]).map(Date.parse));
        if (Number.isFinite(nextExpiry)) expiryTimer = setTimeout(render, Math.min(nextExpiry - now, REFRESH_MS));
    }

    function refresh() {
        if (request) return;
        request = fetch("/api/events?ncdrAlerts=1", { signal: AbortSignal.timeout(15000) })
            .then(response => {
                if (!response.ok) throw new Error("NCDR request failed");
                return response.json();
            })
            .then(data => {
                if (!Array.isArray(data.alerts)) throw new Error("Invalid NCDR response");
                alerts = data.alerts;
                failure = false;
            })
            .catch(() => { failure = true; })
            .finally(() => {
                request = null;
                render();
            });
        render();
    }

    toggle.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
        toggle.setAttribute("aria-expanded", String(!panel.hidden));
        if (panel.hidden) {
            clearInterval(refreshTimer);
            render();
        } else {
            refresh();
            refreshTimer = setInterval(refresh, REFRESH_MS);
        }
    });


    map.on("style.load", render);
    map.on("idle", () => {
        if (!panel.hidden && !mapRemoved && !map.getSource(SOURCE)) render();
    });
    map.on("remove", () => { mapRemoved = true; });
    return nextMap => {
        fallbackMap = nextMap;
        render();
    };
}
