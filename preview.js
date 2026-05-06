// netlify/functions/preview.js
// 生成されたHTMLを一時保存してプレビューURLを返す

// メモリキャッシュ（実用的にはNetlify Blobsを推奨）
const previewStore = {};

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // HTMLを保存してIDを返す
  if (event.httpMethod === "POST") {
    try {
      const { html } = JSON.parse(event.body);
      const id = Math.random().toString(36).substring(2, 10);
      previewStore[id] = { html, createdAt: Date.now() };
      
      // 古いプレビューを削除（1時間以上古いもの）
      const now = Date.now();
      Object.keys(previewStore).forEach(k => {
        if (now - previewStore[k].createdAt > 3600000) delete previewStore[k];
      });
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ id }),
      };
    } catch (e) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request" }) };
    }
  }

  // IDからHTMLを取得
  if (event.httpMethod === "GET") {
    const id = event.queryStringParameters?.id;
    const preview = previewStore[id];
    
    if (!preview) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "text/html" },
        body: "<h1>プレビューが見つかりません</h1><p>有効期限が切れたか、IDが間違っています。</p>",
      };
    }
    
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: preview.html,
    };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
};
