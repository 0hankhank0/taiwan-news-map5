export function countBy(items, getter) {
    return (items || []).reduce((acc, item) => {
        const key = String(getter(item) || "未知").trim() || "未知";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}
