/**
 * Cloudflare Worker 範例：安全代送 AI。
 * 不要把 AI API Key 放在前端。
 *
 * 需要在 Worker Secrets 設定：
 * GEMINI_API_KEY
 */
export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    };
    if (request.method === "OPTIONS") return new Response(null, {headers:cors});
    if (request.method !== "POST") return new Response("Method Not Allowed", {status:405, headers:cors});

    try {
      const { text } = await request.json();
      if (!text || typeof text !== "string") return new Response("缺少 text", {status:400, headers:cors});

      const prompt = `你是大專校院資源教室教師的行政文字協助工具。
請將下列「服務紀錄內容摘述」改寫為客觀、專業、簡潔且適合正式紀錄的繁體中文。
不得虛構未提供的事實，不得加入診斷，不得使用姓名或學號。
保留原意，使用第三人稱客觀紀錄方式，內容宜包含學生反映事項、教師處理情形及後續追蹤方向；若原文未提及某項內容，不得自行補充。以一至兩個完整段落呈現，約 80 至 220 字。

原文：
${text}`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`;
      const response = await fetch(url, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})
      });

      if(!response.ok) return new Response(await response.text(), {status:response.status, headers:cors});
      const data = await response.json();
      const polished = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return new Response(JSON.stringify({polished}), {
        headers:{...cors,"Content-Type":"application/json"}
      });
    } catch (err) {
      return new Response(String(err.message || err), {status:500, headers:cors});
    }
  }
};
