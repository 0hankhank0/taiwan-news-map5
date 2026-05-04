export default function handler(req, res) {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  const token = process.env.MAPBOX_PUBLIC_TOKEN || "";

  res.status(200).send(`
    window.MAPBOX_TOKEN = "${token}";
  `);
}
