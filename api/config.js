module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  const publicToken = process.env.MAPBOX_PUBLIC_TOKEN || "";
  const payload = JSON.stringify(publicToken);

  return res.status(200).send(`window.MAPBOX_ACCESS_TOKEN = ${payload};`);
};
