// Netlify Function: api/chat.js
// SambaNova API を複数キーでローテーション管理

const SAMBANOVA_KEYS = [
  process.env.SAMBANOVA_API_KEY_1,
  process.env.SAMBANOVA_API_KEY_2,
  process.env.SAMBANOVA_API_KEY_3,
  process.env.SAMBANOVA_API_KEY_4,
].filter(Boolean);

const PRO_SECRET = process.env.PRO_SECRET_KEY; // SKProBruで認証

const SAMBANOVA_BASE = "https://api.sambanova.ai/v1";
// const MODEL = "DeepSeek-R1"; // ← これをコメントアウト
const MODEL = "Llama-3.1-8B-Instruct"; // ← テスト用にこちらに変更

// レート制限ストア（Netlify Functionはステートレスなので簡易実装）
// 本番ではKV/Redisを推奨。ここではヘッダーベースで処理
const DAILY_LIMIT_FREE = 250;
const DAILY_LIMIT_PRO = 35000;
const INTERVAL_FREE_MS = 5 * 60 * 1000; // 5分
const INTERVAL_PRO_MS = (60 / 90) * 1000; // 90回/分

let keyIndex = 0;

function getNextKey() {
  if (SAMBANOVA_KEYS.length === 0) return null;
  const key = SAMBANOVA_KEYS[keyIndex % SAMBANOVA_KEYS.length];
  keyIndex++;
  return key;
}

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Pro-Key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { messages, systemPrompt, proKey } = body;
  const isPro = proKey && proKey === PRO_SECRET;

  if (!messages || !Array.isArray(messages)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "messages required" }) };
  }

  const apiKey = getNextKey();
  if (!apiKey) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ error: "APIキーが設定されていません。Netlifyの環境変数を確認してください。" }),
    };
  }

  const requestMessages = [];
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
        max_tokens: 8192,
        temperature: 0.7,
        stream: false,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      // キーが制限に達した場合は次のキーで再試行
      if (response.status === 429 || response.status === 403) {
        const nextKey = getNextKey();
        if (nextKey && nextKey !== apiKey) {
          const retry = await fetch(`${SAMBANOVA_BASE}/chat/completions`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${nextKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: MODEL,
              messages: requestMessages,
              max_tokens: 8192,
              temperature: 0.7,
              stream: false,
            }),
          });
          const retryData = await retry.json();
          if (retry.ok) {
            return {
              statusCode: 200,
              headers: { ...headers, "X-Is-Pro": String(isPro) },
              body: JSON.stringify({
                reply: retryData.choices?.[0]?.message?.content ?? "",
                model: retryData.model,
                isPro,
              }),
            };
          }
        }
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({ error: "全APIキーが制限中です。しばらく待ってください。" }),
        };
      }
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: data.error?.message ?? "API Error" }),
      };
    }

    return {
      statusCode: 200,
      headers: { ...headers, "X-Is-Pro": String(isPro) },
      body: JSON.stringify({
        reply: data.choices?.[0]?.message?.content ?? "",
        model: data.model,
        isPro,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: `サーバーエラー: ${err.message}` }),
    };
  }
};
