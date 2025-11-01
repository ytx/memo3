let currentZoom = 1.0;

// マークダウンを簡易的にHTMLに変換
function markdownToHtml(markdown) {
  if (!markdown) return '<p>プレビュー表示待機中...</p>';

  let html = markdown;

  // コードブロックを一時的に保護
  const codeBlocks = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const trimmedCode = code.replace(/^\n+|\n+$/g, '');
    const placeholder = `@@@CODEBLOCK${codeBlocks.length}@@@`;
    codeBlocks.push(`<pre><code>${escapeHtml(trimmedCode)}</code></pre>`);
    return placeholder;
  });

  // インラインコード（`）を一時的に保護
  const inlineCodes = [];
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    const placeholder = `@@@INLINECODE${inlineCodes.length}@@@`;
    inlineCodes.push(`<code>${code}</code>`);
    return placeholder;
  });

  // ヘッダー
  html = html.replace(/^######\s+(.*)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.*)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');

  // 取消線
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

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

  // 水平線（リストの前に処理）
  html = html.replace(/^---+$/gm, '<hr>');
  html = html.replace(/^\*\*\*+$/gm, '<hr>');

  // 表の処理
  function processTable(lines, startIndex) {
    const tableLines = [];
    let i = startIndex;

    // テーブル行を収集
    while (i < lines.length && lines[i].trim().startsWith('|')) {
      tableLines.push(lines[i]);
      i++;
    }

    if (tableLines.length < 2) {
      return { html: '', nextIndex: startIndex };
    }

    // ヘッダー行
    const headerCells = tableLines[0].split('|').map(cell => cell.trim()).filter(cell => cell);
    const headerRow = '<tr>' + headerCells.map(cell => `<th>${cell}</th>`).join('') + '</tr>';

    // 区切り行をスキップ（2行目）

    // データ行
    const dataRows = tableLines.slice(2).map(line => {
      const cells = line.split('|').map(cell => cell.trim()).filter(cell => cell);
      return '<tr>' + cells.map(cell => `<td>${cell}</td>`).join('') + '</tr>';
    }).join('');

    const tableHtml = `<table><thead>${headerRow}</thead><tbody>${dataRows}</tbody></table>`;

    return { html: tableHtml, nextIndex: i };
  }

  // 引用の処理（連続する引用をまとめる）
  function processBlockquote(lines, startIndex) {
    const quoteLines = [];
    let i = startIndex;

    while (i < lines.length && lines[i].trim().startsWith('>')) {
      const content = lines[i].replace(/^>\s*/, '');
      quoteLines.push(content);
      i++;
    }

    const quoteHtml = '<blockquote>' + quoteLines.join('<br>') + '</blockquote>';
    return { html: quoteHtml, nextIndex: i };
  }

  // リスト処理（ネストを含む）
  function buildList(lines, startIndex) {
    const items = [];
    let i = startIndex;
    const firstMatch = lines[i].match(/^(\s*)[-*]\s+(.*)$/);
    if (!firstMatch) return { html: '', nextIndex: startIndex };

    const baseIndent = firstMatch[1].length;

    while (i < lines.length) {
      const line = lines[i];
      const match = line.match(/^(\s*)[-*]\s+(.*)$/);

      if (!match) break;

      const indent = match[1].length;
      const content = match[2];

      if (indent < baseIndent) {
        break;
      } else if (indent === baseIndent) {
        items.push(`<li>${content}</li>`);
        i++;
      } else {
        // ネストされたリスト
        const nested = buildList(lines, i);
        if (items.length > 0) {
          items[items.length - 1] = items[items.length - 1].replace('</li>', nested.html + '</li>');
        }
        i = nested.nextIndex;
      }
    }

    return { html: `<ul>${items.join('')}</ul>`, nextIndex: i };
  }

  function buildOrderedList(lines, startIndex) {
    const items = [];
    let i = startIndex;
    const firstMatch = lines[i].match(/^(\s*)\d+\.\s+(.*)$/);
    if (!firstMatch) return { html: '', nextIndex: startIndex };

    const baseIndent = firstMatch[1].length;

    while (i < lines.length) {
      const line = lines[i];
      const match = line.match(/^(\s*)\d+\.\s+(.*)$/);

      if (!match) break;

      const indent = match[1].length;
      const content = match[2];

      if (indent < baseIndent) {
        break;
      } else if (indent === baseIndent) {
        items.push(`<li>${content}</li>`);
        i++;
      } else {
        // ネストされたリスト
        const nested = buildOrderedList(lines, i);
        if (items.length > 0) {
          items[items.length - 1] = items[items.length - 1].replace('</li>', nested.html + '</li>');
        }
        i = nested.nextIndex;
      }
    }

    return { html: `<ol>${items.join('')}</ol>`, nextIndex: i };
  }

  const lines = html.split('\n');
  const processedLines = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 表の検出
    if (line.trim().startsWith('|')) {
      const result = processTable(lines, i);
      if (result.html) {
        processedLines.push(result.html);
        i = result.nextIndex;
        continue;
      }
    }

    // 引用の検出
    if (line.trim().startsWith('>')) {
      const result = processBlockquote(lines, i);
      processedLines.push(result.html);
      i = result.nextIndex;
      continue;
    }

    // 順序なしリストの検出
    if (line.match(/^(\s*)[-*]\s+(.*)$/)) {
      const result = buildList(lines, i);
      processedLines.push(result.html);
      i = result.nextIndex;
      continue;
    }

    // 順序ありリストの検出
    if (line.match(/^(\s*)\d+\.\s+(.*)$/)) {
      const result = buildOrderedList(lines, i);
      processedLines.push(result.html);
      i = result.nextIndex;
      continue;
    }

    processedLines.push(line);
    i++;
  }

  html = processedLines.join('\n');

  // 段落
  const paragraphLines = html.split('\n');
  const processed = [];
  let inParagraph = false;

  for (let line of paragraphLines) {
    const trimmed = line.trim();

    // プレースホルダーはそのまま
    if (trimmed.match(/^@@@CODEBLOCK\d+@@@$/) || trimmed.match(/^@@@INLINECODE\d+@@@$/)) {
      if (inParagraph) {
        processed.push('</p>');
        inParagraph = false;
      }
      processed.push(line);
    }
    // 既にタグがある行はそのまま
    else if (trimmed.match(/^<(h[1-6]|ul|ol|li|blockquote|pre|hr|code|table|del)/)) {
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

  html = processed.join('\n');

  // プレースホルダーを実際のコードに戻す
  codeBlocks.forEach((code, index) => {
    const placeholder = `@@@CODEBLOCK${index}@@@`;
    html = html.split(placeholder).join(code);
  });

  inlineCodes.forEach((code, index) => {
    const placeholder = `@@@INLINECODE${index}@@@`;
    html = html.split(placeholder).join(code);
  });

  return html;
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

// 再読み込み機能
document.getElementById('reload-btn').addEventListener('click', () => {
  window.api.requestPreviewReload();
});

// 初期化
updateZoom();
