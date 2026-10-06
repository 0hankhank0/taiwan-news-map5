export function normalizeFilterText(value) {
    return String(value || "").trim().toLowerCase().replace(/臺/g, "台");
}
