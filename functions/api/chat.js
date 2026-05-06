// functions/api/chat.js
// Cloudflare Pages Functions 用チャットAPI

export async function onRequest(context) {
  // Cloudflareでは context.env から環境変数を取得します
  const { request, env } = context;

  // CORSヘッダーの設定
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Pro-Key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  // OPTIONSリクエスト（ブラウザの事前確認）への対応
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // POST以外のリクエストは弾く
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // リクエストボディの解析
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "フロントからのリクエストが正しいJSONではありません" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { messages, systemPrompt, proKey } = body;
  const PRO_SECRET = env.PRO_SECRET_KEY; // 有料/Pro認証用
  const isPro = proKey && proKey === PRO_SECRET;

  if (!messages || !Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: "messages required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ★ご指定の環境変数名に変更しました
  const SAMBANOVA_KEYS =[
    env.SAMBANOVA_API_KEY_1,
    env.SAMBANOVA_API_KEY_2,
    env.SAMBANOVA_API_KEY_3,
    env.SAMBANOVA_API_KEY_4,
  ].filter(Boolean);

  if (SAMBANOVA_KEYS.length === 0) {
    return new Response(JSON.stringify({ error: "APIキーが設定されていません。Cloudflareの環境変数を確認してください。" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Cloudflareはリクエストごとにコンテナが変わるため、ランダムでキーを選択します
  const apiKey = SAMBANOVA_KEYS[Math.floor(Math.random() * SAMBANOVA_KEYS.length)];

  // ★念願のDeepSeek-R1に設定！
  const SAMBANOVA_BASE = "https://api.sambanova.ai/v1";
  const MODEL = "DeepSeek-R1";

  const requestMessages =[];
  if (systemPrompt) {
    requestMessages.push({ role: "system", content: systemPrompt });
  }
  requestMessages.push(...messages);

  try {
    const response = await fetch(`${SAMBANOVA_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: requestMessages,
        max_tokens: 4000,
        temperature: 0.7,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(JSON.stringify({ error: `SambaNova APIエラー (${response.status})`, details: errorText }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();

    return new Response(JSON.stringify({
      reply: data.choices?.[0]?.message?.content ?? "",
      model: data.model,
      isPro,
    }), {
      status: 200,
      headers: { 
        ...corsHeaders, 
        "Content-Type": "application/json",
        "X-Is-Pro": String(isPro) 
      },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `サーバー処理中にエラーが発生しました: ${err.message}` }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
