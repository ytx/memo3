let currentZoom = 1.0;

// マークダウンを簡易的にHTMLに変換
function markdownToHtml(markdown) {
  if (!markdown) return '<p>プレビュー表示待機中...</p>';

  let html = markdown;

  // コードブロック（```）を処理
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre><code>${escapeHtml(code.trim())}</code></pre>`;
  });

  // インラインコード（`）を処理
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // ヘッダー
  html = html.replace(/^######\s+(.*)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.*)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');

  // 太字
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // イタリック
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // リンク
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // 画像
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

  // 水平線
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^\*\*\*$/gm, '<hr>');

  // 引用
  html = html.replace(/^>\s+(.*)$/gm, '<blockquote>$1</blockquote>');

  // リスト（順序なし）
  html = html.replace(/^\*\s+(.*)$/gm, '<li>$1</li>');
  html = html.replace(/^-\s+(.*)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // リスト（順序あり）
  html = html.replace(/^\d+\.\s+(.*)$/gm, '<li>$1</li>');

  // 段落
  const lines = html.split('\n');
  const processed = [];
  let inParagraph = false;

  for (let line of lines) {
    const trimmed = line.trim();

    // 既にタグがある行はそのまま
    if (trimmed.match(/^<(h[1-6]|ul|ol|li|blockquote|pre|hr|code)/)) {
      if (inParagraph) {
        processed.push('</p>');
        inParagraph = false;
      }
      processed.push(line);
    }
    // 空行
    else if (!trimmed) {
      if (inParagraph) {
        processed.push('</p>');
        inParagraph = false;
      }
    }
    // 通常のテキスト
    else {
      if (!inParagraph) {
        processed.push('<p>');
        inParagraph = true;
      }
      processed.push(line);
    }
  }

  if (inParagraph) {
    processed.push('</p>');
  }

  return processed.join('\n');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// プレビュー内容を更新
window.api.onPreviewUpdate((_, content) => {
  const previewContent = document.getElementById('preview-content');
  const html = markdownToHtml(content);
  previewContent.innerHTML = html;
});

// テーマ切り替え機能
let isDarkMode = false;

document.getElementById('theme-toggle').addEventListener('click', () => {
  isDarkMode = !isDarkMode;
  document.body.classList.toggle('dark-mode', isDarkMode);
});

// ズーム機能
function updateZoom() {
  const previewContent = document.getElementById('preview-content');

  previewContent.style.transform = `scale(${currentZoom})`;
  previewContent.style.transformOrigin = 'top left';
  previewContent.style.width = `${100 / currentZoom}%`;
}

document.getElementById('zoom-in').addEventListener('click', () => {
  if (currentZoom < 2.0) {
    currentZoom += 0.1;
    updateZoom();
  }
});

document.getElementById('zoom-out').addEventListener('click', () => {
  if (currentZoom > 0.5) {
    currentZoom -= 0.1;
    updateZoom();
  }
});

document.getElementById('zoom-reset').addEventListener('click', () => {
  currentZoom = 1.0;
  updateZoom();
});

// 印刷機能
document.getElementById('print-btn').addEventListener('click', () => {
  window.print();
});

// 初期化
updateZoom();
