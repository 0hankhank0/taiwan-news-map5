const crypto = require("crypto");
const { mutateDurableValue } = require("../event-store");
const { getRequestQuery } = require("../request-query");

// ECPay SHA256 CheckMacValue (.NET URL encoding), without logging HashKey/IV.
function checkMacValue(parameters, key, iv) {
  const pairs = Object.keys(parameters).filter(name => name !== "CheckMacValue").sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const raw = `HashKey=${key}&${pairs.map(name => `${name}=${parameters[name]}`).join("&")}&HashIV=${iv}`;
  const encoded = encodeURIComponent(raw).replace(/%20/g, "+").replace(/'/g, "%27").replace(/~/g, "%7E").toLowerCase();
  return crypto.createHash("sha256").update(encoded).digest("hex").toUpperCase();
}
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
module.exports = async (req, res) => {
  const callback = String(req.url || "").split("?")[0] === "/api/payment-callback" || getRequestQuery(req).paymentCallback === "1";
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { ECPAY_MERCHANT_ID: merchantId, ECPAY_HASH_KEY: key, ECPAY_HASH_IV: iv } = process.env;
    if (!merchantId || !key || !iv) throw new Error("Payment configuration missing");
    const body = typeof req.body === "string" ? Object.fromEntries(new URLSearchParams(req.body)) : req.body || {};
    if (callback) {
      if (Object.values(body).some(value => typeof value !== "string")) return res.status(400).send("0|Invalid parameters");
      const received = String(body.CheckMacValue || "");
      const expected = checkMacValue(body, key, iv);
      if (!/^[A-F0-9]{64}$/.test(received) || !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected)) || body.MerchantID !== merchantId) return res.status(400).send("0|Invalid signature");
      const tradeNo = String(body.MerchantTradeNo || "");
      if (!/^MAP[a-f0-9]{16}$/.test(tradeNo)) return res.status(400).send("0|Invalid order");
      await mutateDurableValue(`payments:${tradeNo}`, order => {
        if (!order || Number(body.TradeAmt) !== order.amount || body.SimulatePaid !== "0") throw Object.assign(new Error("Payment does not match order"), { code: "INVALID_PAYMENT" });
        if (order.status === "paid") {
          if (order.providerTradeNo !== body.TradeNo) throw Object.assign(new Error("Conflicting payment"), { code: "INVALID_PAYMENT" });
          return order;
        }
        return { ...order, status: body.RtnCode === "1" ? "paid" : "failed", providerTradeNo: body.TradeNo, resultCode: body.RtnCode, paidAt: body.RtnCode === "1" ? new Date().toISOString() : null };
      });
      return res.status(200).send("1|OK");
    }
    const amount = Number(body.amount);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) return res.status(400).json({ error: "Invalid amount" });
    const origin = new URL(process.env.PAYMENT_BASE_URL || "https://taiwan-map.bobaboba.me");
    if (origin.protocol !== "https:" || origin.username || origin.password) throw new Error("Invalid payment origin");
    const tradeNo = `MAP${crypto.randomBytes(8).toString("hex")}`;
    const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19).replace(/-/g, "/").replace("T", " ");
    const params = { MerchantID: merchantId, MerchantTradeNo: tradeNo, MerchantTradeDate: date, PaymentType: "aio", TotalAmount: String(amount), TradeDesc: "支持台灣新聞事件地圖專案", ItemName: String(body.itemName || "地圖維護與伺服器營運贊助").slice(0, 200), ReturnURL: `${origin.origin}/api/payment-callback`, OrderResultURL: `${origin.origin}/`, ChoosePayment: "ALL", EncryptType: "1" };
    params.CheckMacValue = checkMacValue(params, key, iv);
    await mutateDurableValue(`payments:${tradeNo}`, () => ({ tradeNo, amount, status: "pending", createdAt: new Date().toISOString() }));
    const endpoint = process.env.ECPAY_OPERATION_MODE === "Test" ? "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5" : "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5";
    return res.status(200).send(`<form id="ecpay" method="post" action="${endpoint}">${Object.entries(params).map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`).join("")}</form><script>document.getElementById("ecpay").submit()</script>`);
  } catch (error) {
    console.error("[payment] failed:", error.code || error.name);
    if (callback) return res.status(error.code === "INVALID_PAYMENT" ? 400 : 503).send("0|Payment processing failed");
    return res.status(503).json({ error: "Payment service unavailable" });
  }
};
module.exports.checkMacValue = checkMacValue;
