function getRequestQuery(req = {}) {
  const ownQuery = Object.getOwnPropertyDescriptor(req, "query")?.value;
  const query = ownQuery && typeof ownQuery === "object" && !Array.isArray(ownQuery)
    ? { ...ownQuery }
    : {};
  try {
    const host = req.headers?.host || "localhost";
    const parsed = new URL(req.url || "/", "https://" + host);
    for (const [key, value] of parsed.searchParams) {
      if (query[key] === undefined) query[key] = value;
    }
  } catch {}
  return query;
}

module.exports = { getRequestQuery };
