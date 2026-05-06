// netlify/functions/chat.js
// SambaNova API プロキシ - DeepSeek-R1 対応
// APIキーはNetlify環境変数で管理

const MODELS = [
  "deepseek-r1",
  "deepseek-r1-distill-llama-70b",
  "Meta-Llama-3.3-70B-Instruct", // fallback
];

// 複数APIキーをローテーション
function getApiKeys() {
  const keys = [];
  for (let i = 1; i <= 4; i++) {
    const key = process.env[`SAMBANOVA_API_KEY_${i}`];
    if (key) keys.push(key);
  }
  return keys;
}

// レート制限ストア（メモリ内 - Netlify Functionsはステートレスなので簡易実装）
// 本番環境ではKV storeやRedisを推奨
const rateLimitStore = {};

function checkRateLimit(ip, isPro) {
  const now = Date.now();
  const key = `${ip}_${isPro ? "pro" : "free"}`;
  
  if (!rateLimitStore[key]) {
    rateLimitStore[key] = { daily: 0, lastReset: now, lastRequest: 0, minute: 0, minuteReset: now };
  }
  
  const store = rateLimitStore[key];
  
  // 日次リセット（24時間）
  if (now - store.lastReset > 86400000) {
    store.daily = 0;
    store.lastReset = now;
  }
  
  // 分次リセット（1分）
  if (now - store.minuteReset > 60000) {
    store.minute = 0;
    store.minuteReset = now;
  }
  
  const dailyLimit = isPro ? 1000 : 250;
  const minuteLimit = isPro ? 5 : 1;
  const intervalMs = isPro ? 12000 : 300000; // Pro: 12秒, Free: 5分
  
  if (store.daily >= dailyLimit) {
    return { allowed: false, reason: `1日の上限（${dailyLimit}回）に達しました。明日また来てね！` };
  }
  
  if (store.minute >= minuteLimit) {
    return { allowed: false, reason: `少し待ってね。${isPro ? "1分に5回" : "5分に1回"}の制限があるよ。` };
  }
  
  if (now - store.lastRequest < intervalMs) {
    const wait = Math.ceil((intervalMs - (now - store.lastRequest)) / 1000);
    return { allowed: false, reason: `あと${wait}秒待ってね！` };
  }
  
  store.daily++;
  store.minute++;
  store.lastRequest = now;
  
  return { 
    allowed: true, 
    remaining: dailyLimit - store.daily,
    dailyLimit
  };
}

async function callSambaNova(apiKey, messages, systemPrompt) {
  const allMessages = [];
  
  if (systemPrompt) {
    allMessages.push({ role: "system", content: systemPrompt });
  }
  allMessages.push(...messages);

  // DeepSeek-R1を試し、失敗したら次のモデルへ
  for (const model of MODELS) {
    try {
      const response = await fetch("https://api.sambanova.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: allMessages,
          max_tokens: 8192,
          temperature: 0.7,
          stream: false,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return { 
          success: true, 
          content: data.choices[0].message.content,
          model,
          usage: data.usage
        };
      }
      
      // レート制限エラーの場合は次のキーへ
      if (response.status === 429) {
        return { success: false, status: 429, model };
      }
      
    } catch (e) {
      console.error(`Model ${model} failed:`, e.message);
    }
  }
  
  return { success: false, error: "全モデルで失敗しました" };
}

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Pro-Key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { messages, systemPrompt } = body;
    
    // プロプランチェック
    const proKey = event.headers["x-pro-key"] || body.proKey;
    const isPro = proKey && proKey === process.env.PRO_SECRET_KEY;
    
    // IPアドレス取得
    const ip = event.headers["x-forwarded-for"]?.split(",")[0] || "unknown";
    
    // レート制限チェック
    const rateCheck = checkRateLimit(ip, isPro);
    if (!rateCheck.allowed) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ error: rateCheck.reason }),
      };
    }

    // APIキーをローテーション
    const apiKeys = getApiKeys();
    if (apiKeys.length === 0) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "APIキーが設定されていません" }),
      };
    }

    // キーをランダムに選択し、失敗したら次へ
    let result = null;
    const shuffled = [...apiKeys].sort(() => Math.random() - 0.5);
    
    for (const key of shuffled) {
      result = await callSambaNova(key, messages, systemPrompt);
      if (result.success) break;
      if (result.status !== 429) break; // レート制限以外のエラーはリトライしない
    }

    if (!result || !result.success) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({ error: "AIサービスが一時的に利用できません。少し待ってから試してね！" }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        content: result.content,
        model: result.model,
        remaining: rateCheck.remaining,
        dailyLimit: rateCheck.dailyLimit,
        isPro,
      }),
    };

  } catch (e) {
    console.error("Chat function error:", e);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "サーバーエラーが発生しました" }),
    };
  }
};
