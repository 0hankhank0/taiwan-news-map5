const { parseStringPromise, processors } = require("xml2js");

const NCDR_ORIGIN = "https://alerts.ncdr.nat.gov.tw";
const REFRESH_MS = 60_000;
let snapshot;
let pending;

function ncdrUrl(value, base = NCDR_ORIGIN) {
    try {
        const url = new URL(value, base);
        return value && url.origin === NCDR_ORIGIN ? url : null;
    } catch {
        return null;
    }
}

async function fetchXml(url, fetchImpl) {
    const response = await fetchImpl(url, {
        redirect: "error",
        signal: AbortSignal.timeout(4500)
    });
    if (!response.ok) throw new Error("NCDR request failed");
    return parseStringPromise(await response.text(), { tagNameProcessors: [processors.stripPrefix] });
}

function first(node, key) {
    return node[key]?.[0]?.trim?.() || "";
}

function coordinates(value) {
    const parts = value.split(",");
    if (parts.length !== 2 || parts.some(part => !part.trim())) return null;
    const [lat, lng] = parts.map(Number);
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return null;
    return [lng, lat];
}

function areaGeometry(area) {
    const geometries = [];
    for (const polygon of area.polygon || []) {
        const ring = polygon.trim().split(/\s+/).map(coordinates);
        if (ring.length < 3 || ring.some(point => !point)) continue;
        if (ring[0].join(",") !== ring.at(-1).join(",")) ring.push(ring[0]);
        if (ring.length >= 4) geometries.push({ type: "Polygon", coordinates: [ring] });
    }
    for (const circle of area.circle || []) {
        const [center, radius] = circle.trim().split(/\s+/);
        const point = coordinates(center);
        if (!point || !radius || !(Number(radius) >= 0) || !Number.isFinite(Number(radius))) continue;
        if (Number(radius) === 0) {
            geometries.push({ type: "Point", coordinates: point });
            continue;
        }
        const rad = Math.PI / 180;
        const [lng, lat] = point.map(value => value * rad);
        const distance = Number(radius) / 6371;
        const ring = Array.from({ length: 48 }, (_, index) => {
            const bearing = index * 2 * Math.PI / 48;
            const y = Math.asin(Math.sin(lat) * Math.cos(distance) + Math.cos(lat) * Math.sin(distance) * Math.cos(bearing));
            const x = lng + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat), Math.cos(distance) - Math.sin(lat) * Math.sin(y));
            return [x / rad, y / rad];
        });
        ring.push(ring[0]);
        geometries.push({ type: "Polygon", coordinates: [ring] });
    }
    return geometries;
}

function currentAlerts(documents, now) {
    const superseded = new Set();
    const alerts = new Map();
    for (const { cap, url, author } of documents) {
        if (first(cap, "status") !== "Actual" || first(cap, "scope") !== "Public") continue;
        const type = first(cap, "msgType");
        if (!["Alert", "Update", "Cancel"].includes(type)) continue;
        if (type !== "Alert") {
            for (const reference of first(cap, "references").split(/\s+/)) {
                const [sender, id] = reference.split(",");
                if (sender && id) superseded.add(sender + "," + id);
            }
        }
        const sent = first(cap, "sent");
        const issued = Date.parse(sent);
        const sender = first(cap, "sender");
        const identifier = first(cap, "identifier");
        if (type === "Cancel" || !sender || !identifier || !Number.isFinite(issued) || issued > now) continue;

        const activeInfo = (cap.info || []).map(info => ({
            info,
            start: Date.parse(first(info, "onset") || first(info, "effective") || sent),
            end: Date.parse(first(info, "expires"))
        })).filter(({ start, end }) => start <= now && end > now);
        const localInfo = activeInfo.filter(({ info }) => !first(info, "language") || /^zh\b/i.test(first(info, "language")));
        const selected = localInfo.length ? localInfo : activeInfo;
        if (!selected.length) continue;
        const { info } = selected[0];
        const id = sender + "," + identifier;
        const areas = selected.flatMap(({ info: item, end }) => (item.area || []).map(area => ({
            name: first(area, "areaDesc"),
            expiresAt: new Date(end).toISOString(),
            geometries: areaGeometry(area)
        })));
        alerts.set(id, {
            id,
            title: first(info, "headline") || first(info, "event"),
            category: first(info, "event"),
            description: first(info, "description"),
            publisher: first(info, "senderName") || author || sender,
            publishedAt: new Date(issued).toISOString(),
            expiresAt: new Date(Math.max(...selected.map(item => item.end))).toISOString(),
            areas,
            url
        });
    }
    return [...alerts.values()].filter(alert => !superseded.has(alert.id)).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

async function loadAlerts(fetchImpl, apiKey, now) {
    const feedUrl = new URL(apiKey ? "/webapi/RssAtomFeed.ashx" : "/RssAtomFeed.ashx", NCDR_ORIGIN);
    if (apiKey) feedUrl.searchParams.set("apikey", apiKey);
    const { feed } = await fetchXml(feedUrl, fetchImpl);
    if (!feed) throw new Error("Invalid NCDR feed");

    const links = new Map();
    for (const entry of feed.entry || []) {
        const link = (entry.link || []).find(item => !item.$?.rel || item.$.rel === "alternate");
        const url = ncdrUrl(link?.$?.href, feedUrl);
        if (!url) continue;
        if (apiKey) url.searchParams.delete("apikey");
        links.set(url.href, first(entry.author?.[0] || {}, "name"));
    }
    const entries = [...links];
    const documents = [];
    for (let offset = 0; offset < entries.length; offset += 12) {
        const batch = await Promise.all(entries.slice(offset, offset + 12).map(async ([url, author]) => {
            const { alert } = await fetchXml(url, fetchImpl);
            if (!alert) throw new Error("Invalid NCDR alert");
            return { cap: alert, url, author };
        }));
        documents.push(...batch);
    }
    return currentAlerts(documents, now);
}

async function getNcdrAlerts() {
    if (snapshot && snapshot.refreshAt > Date.now()) return snapshot.alerts;
    if (!pending) {
        pending = loadAlerts(global.fetch, process.env.NCDR_API_KEY, Date.now())
            .then(alerts => {
                snapshot = { alerts, refreshAt: Date.now() + REFRESH_MS };
                return alerts;
            }).finally(() => { pending = null; });
    }
    return pending;
}

module.exports = { getNcdrAlerts, loadAlerts };
