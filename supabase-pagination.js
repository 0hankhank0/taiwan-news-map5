// Exact counts detect capped or changing snapshots instead of silently deleting
// records that were omitted from a refresh read.
async function readAllPages(makeQuery) {
  const rows = [];
  let expected = null;
  while (true) {
    const { data, error, count } = await makeQuery().range(rows.length, rows.length + 499);
    if (error) throw new Error(error.message || "Supabase read failed");
    if (!Array.isArray(data) || !Number.isInteger(count) || count < 0) throw new Error("Incomplete Supabase snapshot");
    if (expected === null) expected = count;
    if (count !== expected) throw new Error("Supabase snapshot changed during pagination; retry required");
    rows.push(...data);
    if (rows.length === expected) return rows;
    if (!data.length || rows.length > expected) throw new Error("Incomplete Supabase snapshot");
  }
}
module.exports = { readAllPages };
