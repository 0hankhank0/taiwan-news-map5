async function main() {
  try {
    console.log("🚀 啟動全台新聞同步系統 (終極隨機平衡版)...");
    const token = await getTDXToken();
    
    let rawCache = await kv.get("taiwan_traffic_cache");
    let cacheMap = new Map();
    if (rawCache) {
      const parsed = typeof rawCache === "string" ? JSON.parse(rawCache) : rawCache;
      parsed.forEach(item => { if (item.expiresAt > Date.now()) cacheMap.set(item.id, item); });
    }

    let candidatesMap = new Map(); 
    let cityStats = {};

    // 🏆 精簡並定義每個目標要抓的類型，避開 404
    let targets = [
      { path: "Freeway", name: "國道", types: ["LiveEvent"] },
      { path: "Highway", name: "省道", types: ["LiveEvent"] },
      { path: "City/Taipei", name: "台北市", types: ["Event", "LiveEvent"] },
      { path: "City/NewTaipei", name: "新北市", types: ["Event", "LiveEvent"] },
      { path: "City/Taichung", name: "台中市", types: ["Event", "LiveEvent"] },
      { path: "City/Kaohsiung", name: "高雄市", types: ["Event", "LiveEvent"] },
      { path: "City/Tainan", name: "台南市", types: ["Event", "LiveEvent"] },
      { path: "City/Taoyuan", name: "桃園市", types: ["Event", "LiveEvent"] },
      { path: "City/Keelung", name: "基隆市", types: ["Event", "LiveEvent"] },
      { path: "City/YilanCounty", name: "宜蘭縣", types: ["Event", "LiveEvent"] }
    ];

    // 🔀 關鍵：洗牌演算法，確保各縣市受領配額的機會均等
    targets = targets.sort(() => Math.random() - 0.5);
    console.log(`📡 本次抓取順序：${targets.map(t => t.name).join(' -> ')}`);

    for (const target of targets) {
      for (const evType of target.types) {
        const url = `https://tdx.transportdata.tw/api/basic/v1/Traffic/RoadEvent/${evType}/${target.path}?$format=JSON`;
        const data = await fetchTDX(url, token, `${target.name}-${evType}`);
        if (!data) continue;

        const eventsList = data.Events || data.LiveEvents || data.value || (Array.isArray(data) ? data : []);
        
        eventsList.forEach(event => {
          const summary = event.EventTitle || event.EventSummary || event.Description || "";
          const eventId = event.EventID || event.RoadEventID;
          let lat, lng;

          if (event.Positions?.includes("POINT")) {
            const match = event.Positions.match(/POINT\(([^ ]+) ([^)]+)\)/);
            if (match) { lng = parseFloat(match[1]); lat = parseFloat(match[2]); }
          } else {
            lat = event.PositionLat || event.EventPosition?.PositionLat;
            lng = event.PositionLon || event.EventPosition?.PositionLon;
          }
          
          if (eventId && summary && lat && lng) {
            if (summary.includes("宣導") || event.EventTypeName === "交通管制") return;
            
            candidatesMap.set(eventId, {
              id: eventId,
              text: `【${event.EventTypeName || '路況'}】${summary}`,
              lat, lng, city: target.name
            });
            cityStats[target.name] = (cityStats[target.name] || 0) + 1;
          }
        });
      }
      // 🛌 每個地區抓完強制休息 10 秒，徹底冷卻 API 計數器
      console.log(`💤 ${target.name} 完畢，冷卻中...`);
      await delay(10000); 
    }

    console.log("\n--- 📊 本次成功抓取統計 ---");
    targets.forEach(t => console.log(`${t.name}: ${cityStats[t.name] || 0} 筆`));
    console.log("---------------------------\n");

    const candidates = Array.from(candidatesMap.values());
    if (candidates.length === 0) {
      console.log("⚠️ 沒抓到任何新資料，可能是全部被 429 了。");
      return;
    }

    let itemsForAI = [];
    let newCacheList = [];
    let finalEvents = [];

    for (const item of candidates) {
      const cached = cacheMap.get(item.id);
      if (cached && cached.text === item.text) {
        newCacheList.push(cached); 
        if (cached.isReal) finalEvents.push(cached);
      } else {
        itemsForAI.push(item);
      }
    }

    console.log(`🛡️ 篩選完成：沿用 ${candidates.length - itemsForAI.length} 筆，AI 審核 ${itemsForAI.length} 筆。`);

    // AI 分批處理 (維持不變)
    for (let i = 0; i < itemsForAI.length; i += 20) {
      const batch = itemsForAI.slice(i, i + 20);
      const aiResults = await aiFilterEvents(batch);
      batch.forEach(item => {
        const ai = aiResults.find(r => r.id === item.id);
        if (ai) {
          const processedItem = {
            ...item,
            title: ai.title || item.text, 
            category: ai.category || "accident",
            isReal: ai.isReal,
            expiresAt: Date.now() + (ai.ttl_hours || 4) * 60 * 60 * 1000
          };
          newCacheList.push(processedItem);
          if (ai.isReal) finalEvents.push(processedItem); 
        }
      });
    }

    cacheMap.forEach(cached => {
      if (!newCacheList.find(n => n.id === cached.id)) {
        newCacheList.push(cached);
        if (cached.isReal) finalEvents.push(cached);
      }
    });

    await kv.set("taiwan_traffic_cache", JSON.stringify(newCacheList));
    await kv.set("taiwan_traffic_events", JSON.stringify(finalEvents));
    console.log(`💾 全部完工！產出 ${finalEvents.length} 筆全台地圖事件。`);

  } catch (error) { console.error("💥 錯誤:", error); }
}
main();
