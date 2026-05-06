// ==========================================
// 自分でツクール - アプリケーションロジック
// ==========================================

const API_BASE = window.location.hostname === 'localhost' 
  ? 'http://localhost:8888/.netlify/functions'
  : '/.netlify/functions';

// ========== 状態管理 ==========
const state = {
  messages: [],       // 会話履歴
  mode: 'chat',       // 'chat' | 'html'
  proKey: '',         // プロプランキー
  isPro: false,
  isLoading: false,
  lastHtml: '',       // 最後に生成されたHTML
  remaining: null,
  dailyLimit: 250,
};

// ========== DOM要素 ==========
const $ = id => document.getElementById(id);
const els = {
  messages:       $('messages'),
  systemPrompt:   $('systemPrompt'),
  userInput:      $('userInput'),
  sendBtn:        $('sendBtn'),
  statusMsg:      $('statusMsg'),
  clearBtn:       $('clearBtn'),
  usageCount:     $('usageCount'),
  usageLimit:     $('usageLimit'),
  previewActions: $('previewActions'),
  previewBody:    $('previewBody'),
  openTabBtn:     $('openTabBtn'),
  downloadBtn:    $('downloadBtn'),
  copyHtmlBtn:    $('copyHtmlBtn'),
  proBtn:         $('proBtn'),
  proModal:       $('proModal'),
  proKeyInput:    $('proKeyInput'),
  proConfirmBtn:  $('proConfirmBtn'),
  proCloseBtn:    $('proCloseBtn'),
};

// ========== 初期化 ==========
function init() {
  // 保存済み設定を復元
  const savedPro = sessionStorage.getItem('proKey');
  if (savedPro) {
    state.proKey = savedPro;
    state.isPro = true;
    els.proBtn.classList.add('active');
    state.dailyLimit = 1000;
    updateUsageBadge();
  }

  bindEvents();
  els.userInput.focus();
}

function bindEvents() {
  // 送信ボタン
  els.sendBtn.addEventListener('click', handleSend);

  // Enterキー（Shift+Enterで改行）
  els.userInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // テキストエリア自動リサイズ
  els.userInput.addEventListener('input', () => {
    els.userInput.style.height = 'auto';
    els.userInput.style.height = Math.min(els.userInput.scrollHeight, 120) + 'px';
  });

  // モードタブ
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.mode = tab.dataset.mode;
      
      if (state.mode === 'html') {
        els.userInput.placeholder = '例：青と白のシンプルな自己紹介ページを作って';
      } else {
        els.userInput.placeholder = 'メッセージを入力...';
      }
    });
  });

  // リセットボタン
  els.clearBtn.addEventListener('click', () => {
    if (confirm('会話履歴をリセットしますか？')) {
      state.messages = [];
      state.lastHtml = '';
      els.messages.innerHTML = `
        <div class="welcome-msg">
          <div class="welcome-icon">✨</div>
          <p>システムプロンプトで<br>ボットに指示を出して、<br>会話を始めよう！</p>
        </div>`;
      els.previewActions.style.display = 'none';
      els.previewBody.innerHTML = `
        <div class="preview-empty">
          <div class="empty-icon">🎨</div>
          <p>HTMLモードで生成すると<br>ここにプレビューが表示されます</p>
        </div>`;
    }
  });

  // プレビューアクション
  els.openTabBtn.addEventListener('click', openInNewTab);
  els.downloadBtn.addEventListener('click', downloadHtml);
  els.copyHtmlBtn.addEventListener('click', copyHtml);

  // プロプランモーダル
  els.proBtn.addEventListener('click', () => els.proModal.classList.add('open'));
  els.proCloseBtn.addEventListener('click', () => els.proModal.classList.remove('open'));
  els.proConfirmBtn.addEventListener('click', handleProKeySubmit);
  els.proKeyInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleProKeySubmit();
  });
  els.proModal.addEventListener('click', e => {
    if (e.target === els.proModal) els.proModal.classList.remove('open');
  });
}

// ========== メッセージ送信 ==========
async function handleSend() {
  const text = els.userInput.value.trim();
  if (!text || state.isLoading) return;

  // ユーザーメッセージをUIに追加
  addMessage('user', text);
  state.messages.push({ role: 'user', content: text });
  els.userInput.value = '';
  els.userInput.style.height = 'auto';

  // ローディング表示
  const loadingEl = addLoadingMessage();
  state.isLoading = true;
  els.sendBtn.disabled = true;
  setStatus('');

  try {
    // システムプロンプトを構築
    let systemPrompt = els.systemPrompt.value.trim();
    
    if (state.mode === 'html') {
      const htmlInstruction = '\n\nユーザーの要求に対して、完全なHTMLファイルを生成してください。必ずコードブロックなしで生のHTMLのみを返し、<!DOCTYPE html>から始めてください。スタイルはインラインかstyleタグ内に記述してください。';
      systemPrompt = systemPrompt ? systemPrompt + htmlInstruction : 'あなたは優秀なWebデザイナーです。' + htmlInstruction;
    } else if (!systemPrompt) {
      systemPrompt = 'あなたは親切で知識豊富なアシスタントです。日本語で回答してください。';
    }

    const res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(state.proKey ? { 'X-Pro-Key': state.proKey } : {}),
      },
      body: JSON.stringify({
        messages: state.messages,
        systemPrompt,
      }),
    });

    const data = await res.json();

    // ローディングを削除
    loadingEl.remove();

    if (!res.ok) {
      setStatus(data.error || 'エラーが発生しました');
      // エラーメッセージを会話に追加
      addMessage('assistant', `⚠️ ${data.error || 'エラーが発生しました'}`);
      state.messages.pop(); // ユーザーメッセージを取り消す
      return;
    }

    const reply = data.content;
    state.messages.push({ role: 'assistant', content: reply });

    // 使用量を更新
    if (data.remaining !== undefined) {
      state.remaining = data.remaining;
      state.dailyLimit = data.dailyLimit;
      updateUsageBadge();
    }

    // HTMLモードの場合はプレビュー表示
    if (state.mode === 'html') {
      const html = extractHtml(reply);
      if (html) {
        state.lastHtml = html;
        renderPreview(html);
        addMessage('assistant', '✅ HTMLを生成しました！右のプレビューで確認できます。');
      } else {
        addMessage('assistant', reply);
      }
    } else {
      addMessage('assistant', reply);
    }

  } catch (e) {
    loadingEl.remove();
    setStatus('通信エラーが発生しました');
    addMessage('assistant', '⚠️ 通信エラーが発生しました。もう一度試してみてください。');
    state.messages.pop();
  } finally {
    state.isLoading = false;
    els.sendBtn.disabled = false;
    els.userInput.focus();
  }
}

// HTMLをレスポンスから抽出
function extractHtml(text) {
  // ```html ... ``` を探す
  const codeBlock = text.match(/```(?:html)?\n?([\s\S]*?)```/i);
  if (codeBlock) return codeBlock[1].trim();
  
  // <!DOCTYPE または <html タグで始まるか探す
  const doctypeMatch = text.match(/(<!DOCTYPE[\s\S]*)/i);
  if (doctypeMatch) return doctypeMatch[1].trim();
  
  const htmlMatch = text.match(/(<html[\s\S]*<\/html>)/i);
  if (htmlMatch) return htmlMatch[1].trim();
  
  return null;
}

// ========== UI ヘルパー ==========
function addMessage(role, content) {
  // ウェルカムメッセージを消す
  const welcome = els.messages.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `msg ${role}`;
  
  const label = role === 'user' ? 'あなた' : 'AI';
  div.innerHTML = `
    <span class="msg-label">${label}</span>
    <div class="msg-bubble">${escapeHtml(content)}</div>
  `;

  els.messages.appendChild(div);
  els.messages.scrollTop = els.messages.scrollHeight;
  return div;
}

function addLoadingMessage() {
  const div = document.createElement('div');
  div.className = 'msg assistant msg-loading';
  div.innerHTML = `
    <span class="msg-label">AI</span>
    <div class="msg-bubble">
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
  els.messages.appendChild(div);
  els.messages.scrollTop = els.messages.scrollHeight;
  return div;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

function setStatus(msg, type = 'error') {
  els.statusMsg.textContent = msg;
  els.statusMsg.className = `status-msg ${type === 'success' ? 'success' : ''}`;
}

function updateUsageBadge() {
  const used = state.dailyLimit - (state.remaining ?? state.dailyLimit);
  els.usageCount.textContent = used > 0 ? used : '0';
  els.usageLimit.textContent = state.dailyLimit;
}

// ========== プレビュー機能 ==========
function renderPreview(html) {
  els.previewBody.innerHTML = '<iframe id="previewFrame" sandbox="allow-scripts allow-same-origin" title="プレビュー"></iframe>';
  const frame = document.getElementById('previewFrame');
  frame.srcdoc = html;
  els.previewActions.style.display = 'flex';
}

async function openInNewTab() {
  if (!state.lastHtml) return;
  
  try {
    // Netlify Functionsで一時保存してURLを取得
    const res = await fetch(`${API_BASE}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: state.lastHtml }),
    });
    const data = await res.json();
    if (data.id) {
      window.open(`${API_BASE}/preview?id=${data.id}`, '_blank');
    }
  } catch (e) {
    // フォールバック：data URLで開く
    const blob = new Blob([state.lastHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function downloadHtml() {
  if (!state.lastHtml) return;
  const blob = new Blob([state.lastHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `generated-${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus('ダウンロードしました！', 'success');
  setTimeout(() => setStatus(''), 2000);
}

async function copyHtml() {
  if (!state.lastHtml) return;
  try {
    await navigator.clipboard.writeText(state.lastHtml);
    setStatus('コピーしました！', 'success');
    setTimeout(() => setStatus(''), 2000);
  } catch (e) {
    setStatus('コピーに失敗しました');
  }
}

// ========== プロプラン ==========
function handleProKeySubmit() {
  const key = els.proKeyInput.value.trim();
  if (!key) {
    // キーをクリアしてフリープランに戻す
    state.proKey = '';
    state.isPro = false;
    state.dailyLimit = 250;
    els.proBtn.classList.remove('active');
    sessionStorage.removeItem('proKey');
    els.proModal.classList.remove('open');
    return;
  }
  
  // キーを保存（検証はサーバーサイドで行う）
  state.proKey = key;
  state.isPro = true;
  state.dailyLimit = 1000;
  sessionStorage.setItem('proKey', key);
  els.proBtn.classList.add('active');
  els.proModal.classList.remove('open');
  els.proKeyInput.value = '';
  updateUsageBadge();
  setStatus('プロプランが有効になりました！', 'success');
  setTimeout(() => setStatus(''), 3000);
}

// ========== 起動 ==========
init();
