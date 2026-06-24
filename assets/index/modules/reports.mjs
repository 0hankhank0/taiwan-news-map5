export function readReportPayload(target) {
    return {
        identifier: decodeURIComponent(target.dataset.report || ""),
        title: decodeURIComponent(target.dataset.reportTitle || "")
    };
}
