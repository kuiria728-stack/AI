// Netlify Function: api/chat.js
// SambaNova API を複数キーでローテーション管理＋タイムアウト対策版

const SAMBANOVA_KEYS =[
  process.env.SAMBANOVA_API_KEY_1,
  process.env.SAMBANOVA_API_KEY_2,
  process.env.SAMBANOVA_API_KEY_3,
  process.env.SAMBANOVA_API_KEY_4,
].filter(Boolean);

const PRO_SECRET = process.env.PRO_SECRET_KEY; // SKProBruで認証
const SAMBANOVA_BASE = "https://api.sambanova.ai/v1";

// ★重いDeepSeek-R1だとNetlifyの10秒制限に引っかかるため、軽量モデルに一時変更
const MODEL = "Meta-Llama-3.1-8B-Instruct"; 
// const MODEL = "DeepSeek-R1"; // 動くことが確認できたら、後で戻してテストしてみてください

let keyIndex = 0;

function getNextKey() {
  if (SAMBANOVA_KEYS.length === 0) return null;
  const key = SAMBANOVA_KEYS[keyIndex % SAMBANOVA_KEYS.length];
  keyIndex++;
  return key;
}

// ★Netlifyの10秒制限の前に、自ら8.5秒で通信を打ち切るための関数
async function fetchWithTimeout(url, options, timeoutMs = 8500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error; // タイムアウト時はここでAbortErrorが飛ぶ
  }
}

exports.handler = async (event, context) => {
  // CORSヘッダー
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
    return { statusCode: 400, headers, body: JSON.stringify({ error: "フロントからのリクエストが正しいJSONではありません" }) };
  }

  const { messages, systemPrompt, proKey } = body;
  const isPro = proKey && proKey === PRO_SECRET;

  if (!messages || !Array.isArray(messages)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "messages required" }) };
  }

  const apiKey = getNextKey();
  if (!apiKey) {
    console.error("エラー: Netlifyの環境変数にSAMBANOVA_KEYが設定されていません。");
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ error: "APIキーが設定されていません。Netlifyの環境変数を確認してください。" }),
    };
  }

  const requestMessages =[];
  if (systemPrompt) {
    requestMessages.push({ role: "system", content: systemPrompt });
  }
  requestMessages.push(...messages);

  const fetchOptions = {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: requestMessages,
      max_tokens: 2000, // 処理を早めるために少し減らしています
      temperature: 0.7,
      stream: false,
    }),
  };

  try {
    // ログを出力（デバッグ用）
    console.log(`通信開始: Model=${MODEL}, Key=...${apiKey.slice(-4)}`);

    let response;
    try {
      // 8.5秒で強制タイムアウトさせる
      response = await fetchWithTimeout(`${SAMBANOVA_BASE}/chat/completions`, fetchOptions, 8500);
    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        console.error("タイムアウト: 8.5秒以内にSambaNovaから返答がありませんでした。");
        return {
          statusCode: 504, // Gateway Timeout
          headers,
          body: JSON.stringify({ error: "AIの返答が遅いためタイムアウトしました。DeepSeekのような重いモデルを使っているか、文章が長すぎます。" }),
        };
      }
      throw fetchError;
    }

    console.log("SambaNovaステータス:", response.status);

    // ★いきなり .json() せず、一度テキストで受け取る（SambaNovaのエラーがHTMLだった場合への対策）
    const textData = await response.text();
    let data;
    try {
      data = JSON.parse(textData);
    } catch (parseError) {
      console.error("SambaNovaからの応答がJSONではありません:", textData.substring(0, 100));
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "SambaNovaから不正な応答がありました。", details: textData.substring(0, 100) }),
      };
    }

    // エラーレスポンスの場合の処理
    if (!response.ok) {
      console.error("SambaNova APIエラー詳細:", data);

      // キーが制限に達した場合は次のキーで再試行 (429 = Too Many Requests, 403 = Forbidden)
      if (response.status === 429 || response.status === 403) {
        console.log("制限到達。次のAPIキーを試します。");
        const nextKey = getNextKey();
        if (nextKey && nextKey !== apiKey) {
          fetchOptions.headers["Authorization"] = `Bearer ${nextKey}`;
          try {
            const retryResponse = await fetchWithTimeout(`${SAMBANOVA_BASE}/chat/completions`, fetchOptions, 8500);
            const retryText = await retryResponse.text();
            const retryData = JSON.parse(retryText);
            
            if (retryResponse.ok) {
              console.log("リトライ成功！");
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
          } catch (retryErr) {
             console.error("リトライも失敗しました:", retryErr.message);
          }
        }
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({ error: "全APIキーが利用制限中です。しばらく待ってください。" }),
        };
      }
      
      // その他のエラー
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: data.error?.message ?? "API Error" }),
      };
    }

    // 成功した場合
    console.log("通信成功。フロントへ結果を返します。");
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
    console.error("予期せぬサーバーエラー:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: `サーバー処理中にエラーが発生しました: ${err.message}` }),
    };
  }
};
