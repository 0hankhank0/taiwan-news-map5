const assert = require("node:assert/strict");
const path = require("node:path"), os = require("node:os");
process.env.EVENT_DB_PATH = path.join(os.tmpdir(), `payment-test-${process.pid}.sqlite`);
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
Object.assign(process.env, { ECPAY_MERCHANT_ID: "3002607", ECPAY_HASH_KEY: "pwFHCqoQZGmho4w6", ECPAY_HASH_IV: "EkRm7iFT261dpevs", ECPAY_OPERATION_MODE: "Test", PAYMENT_BASE_URL: "https://example.test" });
const payment = require("../api/create-payment");
const store = require("../event-store");
async function call(url, body) { const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } }; await payment({ method: "POST", url, headers: { host: "attacker.test" }, body }, res); return res; }
(async () => {
  // Published ECPay documentation test vector; no network or actual charge.
  const example = { TradeDesc: "促銷方案", PaymentType: "aio", MerchantTradeDate: "2023/03/12 15:30:23", MerchantTradeNo: "ecpay20230312153023", MerchantID: "3002607", ReturnURL: "https://www.ecpay.com.tw/receive.php", ItemName: "Apple iphone 15", TotalAmount: "30000", ChoosePayment: "ALL", EncryptType: "1" };
  assert.equal(payment.checkMacValue(example, process.env.ECPAY_HASH_KEY, process.env.ECPAY_HASH_IV), "6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840");
  assert.equal((await call("/api/create-payment", { amount: -1 })).statusCode, 400);
  const form = await call("/api/create-payment", { amount: 100, itemName: '\"><script>evil()</script>' });
  assert.equal(form.statusCode, 200); assert.ok(form.body.includes("https://example.test/api/payment-callback")); assert.ok(!form.body.includes("attacker.test")); assert.ok(!form.body.includes("<script>evil"));
  const tradeNo = form.body.match(/name="MerchantTradeNo" value="([^"]+)"/)[1];
  const body = { MerchantID: "3002607", MerchantTradeNo: tradeNo, TradeNo: "provider123", TradeAmt: "100", RtnCode: "1", SimulatePaid: "0" };
  body.CheckMacValue = payment.checkMacValue(body, process.env.ECPAY_HASH_KEY, process.env.ECPAY_HASH_IV);
  assert.equal((await call("/api/payment-callback", { ...body, TradeAmt: "999" })).statusCode, 400);
  assert.equal((await call("/api/payment-callback", body)).body, "1|OK");
  const paid = await store.getDurableValue(`payments:${tradeNo}`);
  assert.equal(paid.status, "paid");
  assert.equal((await call("/api/payment-callback", body)).body, "1|OK");
  assert.equal((await store.getDurableValue(`payments:${tradeNo}`)).paidAt, paid.paidAt);
  console.log("payment callback tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
