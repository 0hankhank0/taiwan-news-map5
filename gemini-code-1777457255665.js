const ecpay_aio_nodejs = require('ecpay_aio_nodejs');
const { ECPAY_MERCHANT_ID, ECPAY_HASH_KEY, ECPAY_HASH_IV } = process.env;

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { amount, itemName } = req.body;

  // 1. 初始化綠界 SDK
  const options = {
    OperationMode: 'Production', // ⚠️ 注意：正式環境請用 Production
    MerchantID: ECPAY_MERCHANT_ID,
    HashKey: ECPAY_HASH_KEY,
    HashIV: ECPAY_HASH_IV,
    IsProjectContractor: false,
  };

  const create = new ecpay_aio_nodejs(options);

  // 2. 設定訂單參數
  const MerchantTradeNo = 'MAP' + Date.now(); // 產生不重複訂單號
  const base_param = {
    MerchantTradeNo: MerchantTradeNo,
    MerchantTradeDate: new Date().toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' }).replace(/\//g, '/'),
    TotalAmount: amount.toString(), // 贊助金額
    TradeDesc: '支持台灣新聞事件地圖專案',
    ItemName: itemName || '專案贊助',
    ReturnURL: 'https://你的域名.vercel.app/api/payment-callback', // 綠界通知伺服器收款成功的網址
    OrderResultURL: 'https://你的域名.vercel.app/', // 網友付完款後跳轉回來的網址
    ChoosePayment: 'ALL',
    EncryptType: '1',
  };

  // 3. 產生自動提交的 HTML 表單
  const html = create.payment_client.aio_check_out_all(base_param);
  
  res.status(200).send(html);
}