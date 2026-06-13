const { Redis } = require("@upstash/redis"); 
const kv = new Redis({ 
  url: process.env.KV_REST_API_URL, 
  token: process.env.KV_REST_API_TOKEN, 
}); 

module.exports = async (req, res) => { 
  res.setHeader("Access-Control-Allow-Origin", "*"); 
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS"); 
  
  if (req.method === "OPTIONS") return res.status(204).end(); 

  try { 
    const keys = await kv.keys("reaction:*"); 
    let muyu = 0, candle = 0; 
    
    for (const key of keys) { 
      const val = parseInt(await kv.get(key) || 0); 
      if (key.endsWith(":muyu")) muyu += val; 
      if (key.endsWith(":candle")) candle += val; 
    } 
    
    return res.status(200).json({ muyu, candle }); 
  } catch (e) { 
    return res.status(500).json({ muyu: 0, candle: 0 }); 
  } 
}; 
