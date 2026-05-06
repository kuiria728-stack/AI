// api/chat.js — Vercel Serverless Function
// SambaNova API rotation (4 keys) + Rate limiting + Pro plan support

const SAMBANOVA_KEYS = [
  process.env.SAMBA_KEY_1,
  process.env.SAMBA_KEY_2,
  process.env.SAMBA_KEY_3,
  process.env.SAMBA_KEY_4,
].filter(Boolean);

const PRO_SECRET = process.env.PRO_SECRET_KEY; // プロプラン判定キー

// SambaNovaで利用可能なDeepSeek-R1系モデル（優先順）
const DEEPSEEK_MODELS = [
  "DeepSeek-R1",
  "DeepSeek-R1-Distill-Llama-70B",
  "DeepSeek-R1-Distill-Qwen-32B",
  "DeepSeek-R1-Distill-Llama-8B",
];

const SAMBANOVA_BASE_URL = "https://api.sambanova.ai/v1";

// --- In-memory rate limit store (Vercel Edge では揮発性なのでKV推奨だが手軽実装) ---
// IPベースで管理。サーバー再起動でリセットされる点に注意。
const rateLimitStore = {};

function getRateLimitKey(ip, isPro) {
  return `${isPro ? "pro" : "free"}:${ip}`;
}

function checkRateLimit(ip, isPro) {
  const now = Date.now();
  const key = getRateLimitKey(ip, isPro);

  const dailyLimit = isPro ? 1000 : 250;
  const intervalMs = isPro ? 60 * 1000 : 5 * 60 * 1000; // pro: 1分, free: 5分
  const intervalLimit = isPro ? 5 : 1;

  if (!rateLimitStore[key]) {
    rateLimitStore[key] = { daily: [], interval: [] };
  }

  const store = rateLimitStore[key];
  const dayAgo = now - 24 * 60 * 60 * 1000;
  store.daily = store.daily.filter((t) => t > dayAgo);
  store.interval = store.interval.filter((t) => t > now - intervalMs);

  if (store.daily.length >= dailyLimit) {
    const resetIn = Math.ceil((store.daily[0] + 24 * 60 * 60 * 1000 - now) / 1000 / 60);
    return {
      allowed: false,
      reason: `1日の上限（${dailyLimit}回）に達しました。約${resetIn}分後にリセットされます。`,
      dailyRemaining: 0,
      intervalRemaining: 0,
    };
  }

  if (store.interval.length >= intervalLimit) {
    const waitSec = Math.ceil((store.interval[0] + intervalMs - now) / 1000);
    return {
      allowed: false,
      reason: isPro
        ? `1分間に${intervalLimit}回まで。あと${waitSec}秒お待ちください。`
        : `5分間に1回まで。あと${waitSec}秒お待ちください。`,
      dailyRemaining: dailyLimit - store.daily.length,
      intervalRemaining: 0,
    };
  }

  store.daily.push(now);
  store.interval.push(now);

  return {
    allowed: true,
    dailyRemaining: dailyLimit - store.daily.length,
    intervalRemaining: intervalLimit - store.interval.length,
  };
}

// APIキーローテーション（失敗したら次のキーへ）
let keyIndex = 0;
function getNextKey() {
  const key = SAMBANOVA_KEYS[keyIndex % SAMBANOVA_KEYS.length];
  keyIndex++;
  return key;
}

async function callSambaNova(messages, systemPrompt, retryCount = 0) {
  if (SAMBANOVA_KEYS.length === 0) {
    throw new Error("APIキーが設定されていません。");
  }

  const modelIndex = Math.floor(retryCount / SAMBANOVA_KEYS.length);
  const model = DEEPSEEK_MODELS[modelIndex] || DEEPSEEK_MODELS[DEEPSEEK_MODELS.length - 1];
  const apiKey = getNextKey();

  const body = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...messages,
    ],
    max_tokens: 8192,
    temperature: 0.6,
    stream: false,
  };

  const resp = await fetch(`${SAMBANOVA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    // 429 (rate limit) or 5xx → 別のキーでリトライ
    const maxRetries = SAMBANOVA_KEYS.length * DEEPSEEK_MODELS.length;
    if ((resp.status === 429 || resp.status >= 500) && retryCount < maxRetries - 1) {
      console.warn(`Key/model failed (${resp.status}), retrying... [${retryCount + 1}/${maxRetries}]`);
      await new Promise((r) => setTimeout(r, 500));
      return callSambaNova(messages, systemPrompt, retryCount + 1);
    }
    throw new Error(`SambaNova API エラー (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  return {
    content: data.choices?.[0]?.message?.content || "",
    model,
    usage: data.usage,
  };
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Pro-Key");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages, systemPrompt, proKey } = req.body || {};

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages が必要です。" });
    }

    // プロプラン判定
    const isPro = PRO_SECRET && proKey && proKey === PRO_SECRET;

    // IPアドレス取得
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.headers["x-real-ip"] ||
      req.socket?.remoteAddress ||
      "unknown";

    // レート制限チェック
    const rateCheck = checkRateLimit(ip, isPro);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: rateCheck.reason,
        dailyRemaining: rateCheck.dailyRemaining,
        intervalRemaining: rateCheck.intervalRemaining,
        isPro,
      });
    }

    // AI呼び出し
    const result = await callSambaNova(messages, systemPrompt);

    return res.status(200).json({
      content: result.content,
      model: result.model,
      usage: result.usage,
      dailyRemaining: rateCheck.dailyRemaining,
      intervalRemaining: rateCheck.intervalRemaining,
      isPro,
    });
  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({ error: err.message || "サーバーエラーが発生しました。" });
  }
}
