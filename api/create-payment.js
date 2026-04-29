const ecpay_aio_nodejs = require('ecpay_aio_nodejs');

module.exports = async function (req, res) {
  // 只接受 POST 請求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { ECPAY_MERCHANT_ID, ECPAY_HASH_KEY, ECPAY_HASH_IV } = process.env;

    // 檢查是否有讀到環境變數
    if (!ECPAY_MERCHANT_ID || !ECPAY_HASH_KEY || !ECPAY_HASH_IV) {
      throw new Error('伺服器遺失綠界金流的環境變數 (請檢查 Vercel Settings)');
    }

    const { amount, itemName } = req.body;
    if (!amount) throw new Error('沒有收到贊助金額');

    // 🌟 修正重點：把三把鑰匙包裝進 MercProfile 物件中
    const options = {
      OperationMode: 'Production', // 你的帳號已經審核過，用正式環境
      MercProfile: {
        MerchantID: ECPAY_MERCHANT_ID,
        HashKey: ECPAY_HASH_KEY,
        HashIV: ECPAY_HASH_IV,
      },
      IgnorePayment: [], // 不隱藏任何付款方式
      IsProjectContractor: false,
    };

    const create = new ecpay_aio_nodejs(options);

    // 產生精準的 YYYY/MM/DD HH:mm:ss 台北時間 (防 Vercel 時區錯亂)
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const twTime = new Date(utc + (3600000 * 8)); // 轉台灣時間 UTC+8
    
    const pad = (n) => (n < 10 ? '0' + n : n);
    const tradeDate = `${twTime.getFullYear()}/${pad(twTime.getMonth() + 1)}/${pad(twTime.getDate())} ${pad(twTime.getHours())}:${pad(twTime.getMinutes())}:${pad(twTime.getSeconds())}`;

    // 設定訂單參數
    const MerchantTradeNo = 'MAP' + Date.now(); 
    const host = req.headers.host || 'taiwan-map.bobaboba.me';
    
    const base_param = {
      MerchantTradeNo: MerchantTradeNo,
      MerchantTradeDate: tradeDate,
      TotalAmount: amount.toString(),
      TradeDesc: '支持台灣新聞事件地圖專案',
      ItemName: itemName || '專案贊助',
      ReturnURL: `https://${host}/api/payment-callback`,
      OrderResultURL: `https://${host}/`, 
      ChoosePayment: 'ALL',
      EncryptType: '1',
    };

    // 產生自動提交的 HTML 表單
    const html = create.payment_client.aio_check_out_all(base_param);
    res.status(200).send(html);

  } catch (error) {
    // 發生錯誤時，把真實原因印在 Vercel 後台，並傳回給前端
    console.error("❌ 金流產生失敗詳細原因:", error.message);
    res.status(500).json({ error: error.message });
  }
}
