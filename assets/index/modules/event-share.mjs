import { buildEventUrl } from "./event-permalink.mjs";

export async function shareEvent(event, { onCopied = () => {} } = {}) {
    const url = buildEventUrl(event);
    const data = { title: String(event?.title || "台灣新聞事件"), text: String(event?.summary || event?.content || ""), url };
    if (navigator.share) {
        try { await navigator.share(data); return "shared"; } catch (error) { if (error?.name === "AbortError") return "cancelled"; }
    }
    try {
        await navigator.clipboard.writeText(url);
    } catch {
        const textarea = document.createElement("textarea");
        textarea.value = url; textarea.setAttribute("readonly", ""); textarea.style.position = "fixed"; textarea.style.opacity = "0";
        document.body.appendChild(textarea); textarea.select(); document.execCommand("copy"); textarea.remove();
    }
    onCopied("事件網址已複製");
    return "copied";
}
