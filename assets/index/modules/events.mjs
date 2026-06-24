export function compareEventsByFreshness(a, b) {
    const at = Date.parse(a?.updatedAt || a?.publishedAt || a?.createdAt || "") || 0;
    const bt = Date.parse(b?.updatedAt || b?.publishedAt || b?.createdAt || "") || 0;
    return bt - at;
}
