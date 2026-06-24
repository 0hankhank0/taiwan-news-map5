const reportsHandler = require("../reports");

module.exports = async (req, res) => {
  req.query = {
    ...(req.query || {}),
    reportId: req.query?.reportId || req.query?.reportId || req.url?.split("/").pop()?.split("?")[0],
  };
  return reportsHandler(req, res);
};
