// preview.js
// チャットボットが生成したHTMLを新タブでプレビュー・ダウンロードするユーティリティ

window.PreviewManager = (() => {
  let previewCounter = 0;

  /**
   * HTMLコードを新タブで開く（blob URL使用）
   */
  function openInNewTab(htmlCode, title = "プレビュー") {
    const blob = new Blob([htmlCode], { type: "text/html; charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const tab = window.open(url, "_blank");
    if (!tab) {
      alert("ポップアップがブロックされました。ブラウザの設定を確認してください。");
    }
    // メモリ解放（少し待ってから）
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return url;
  }

  /**
   * HTMLをファイルとしてダウンロード
   */
  function downloadHTML(htmlCode, filename) {
    previewCounter++;
    const name = filename || `generated-${previewCounter}.html`;
    const blob = new Blob([htmlCode], { type: "text/html; charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /**
   * メッセージ内のコードブロックを抽出
   */
  function extractCodeBlocks(text) {
    const blocks = [];
    // ```html ... ``` または ``` ... ```
    const regex = /```(?:html|HTML)?\s*([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const code = match[1].trim();
      if (code.length > 20) {
        blocks.push({
          code,
          isHTML: /<!DOCTYPE|<html|<head|<body|<div|<script|<style/i.test(code),
        });
      }
    }
    return blocks;
  }

  /**
   * コードブロックのアクションボタンUIを生成
   */
  function createCodeActions(code, isHTML, index) {
    const wrapper = document.createElement("div");
    wrapper.className = "code-actions";

    const label = document.createElement("span");
    label.className = "code-label";
    label.textContent = isHTML ? "🌐 HTML" : "📄 コード";
    wrapper.appendChild(label);

    if (isHTML) {
      const previewBtn = document.createElement("button");
      previewBtn.className = "action-btn preview-btn";
      previewBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> 新タブで開く';
      previewBtn.addEventListener("click", () => openInNewTab(code));
      wrapper.appendChild(previewBtn);
    }

    const downloadBtn = document.createElement("button");
    downloadBtn.className = "action-btn download-btn";
    downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ダウンロード';
    downloadBtn.addEventListener("click", () => downloadHTML(code, `code-${index + 1}.html`));
    wrapper.appendChild(downloadBtn);

    const copyBtn = document.createElement("button");
    copyBtn.className = "action-btn copy-btn";
    copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> コピー';
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.textContent = "✓ コピー完了";
        setTimeout(() => {
          copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> コピー';
        }, 2000);
      });
    });
    wrapper.appendChild(copyBtn);

    return wrapper;
  }

  return { openInNewTab, downloadHTML, extractCodeBlocks, createCodeActions };
})();
