const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const SAMBANOVA_BASE = "https://api.sambanova.ai/v1";
const MODEL = "DeepSeek-R1"; // 重いモデルでもRenderなら大丈夫！

app.post('/api/chat', async (req, res) => {
  const { messages, systemPrompt, proKey } = req.body;
  
  // 環境変数からキーを取得
  const SAMBANOVA_KEYS = [
    process.env.SAMBANOVA_API_KEY_1,
    process.env.SAMBANOVA_API_KEY_2,
    process.env.SAMBANOVA_API_KEY_3,
    process.env.SAMBANOVA_API_KEY_4
  ].filter(Boolean);

  if (SAMBANOVA_KEYS.length === 0) {
    return res.status(503).json({ error: "APIキーが設定されていません。" });
  }

  // ランダムでキーを選択
  const apiKey = SAMBANOVA_KEYS[Math.floor(Math.random() * SAMBANOVA_KEYS.length)];

  const requestMessages = [];
  if (systemPrompt) {
    requestMessages.push({ role: "system", content: systemPrompt });
  }
  requestMessages.push(...messages);

  try {
    console.log(`Sending request to SambaNova using model: ${MODEL}`);
    
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

    const data = await response.json();

    if (!response.ok) {
      console.error("SambaNova Error:", data);
      return res.status(response.status).json({ error: data.error?.message || "API Error" });
    }

    res.json({
      reply: data.choices?.[0]?.message?.content ?? "",
      model: data.model
    });

  } catch (err) {
    console.error("Server Error:", err);
    res.status(500).json({ error: "サーバーエラーが発生しました。" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
