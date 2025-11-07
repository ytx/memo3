let editors = {}; // エディタインスタンスを管理
let tabs = []; // タブ管理
let activeTabId = null;
let files = [];
let rootFolder = null;
let autoSaveTimers = {}; // 自動保存タイマー管理
let lastOpenedFromFileList = null; // ファイル一覧から最後に開いたタブ
let editorInteractions = {}; // エディタとのユーザーインタラクション追跡
let imeComposing = {}; // IME変換中フラグ（タブIDごと）

// タグ管理
let tags = []; // 全タグリスト
let fileTags = []; // ファイルとタグの関連リスト
let tagFilterStatus = {}; // タグフィルターの状態 { tagId: 'show' | 'hide' | 'none' }
let isTagFilterVisible = false; // タグフィルターの表示状態

// タグカラーパレット（16色）
const TAG_COLOR_PALETTE = [
  '#e53935', // 赤
  '#d81b60', // ピンク
  '#8e24aa', // 紫
  '#5e35b1', // 深紫
  '#3949ab', // 藍
  '#1e88e5', // 青
  '#039be5', // 水色
  '#00acc1', // シアン
  '#00897b', // ティール
  '#43a047', // 緑
  '#7cb342', // ライムグリーン
  '#c0ca33', // ライム
  '#fdd835', // 黄
  '#ffb300', // アンバー
  '#fb8c00', // オレンジ
  '#6d4c41'  // 茶
];
let settings = {
  keybinding: '',
  theme: 'ace/theme/monokai',
  themePreset2: 'ace/theme/github',
  fontSize: 14,
  lineHeight: 1.5,
  wordWrap: true,
  showLineNumbers: true,
  showInvisibles: false,
  themeIndex: 0
};

// 現在のテーマ（切り替え用）
let currentTheme = '';

// ファイルの最初の非空白行をタイトルとして取得
function getFileTitle(file, content = '') {
  if (!content) return file ? file.name : 'Untitled';
  
  const lines = content.split('\n');
  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      // マークダウンのヘッダー記号を除去
      let title = trimmed.replace(/^#+\s*/, '').substring(0, 30);
      return title || (file ? file.name : 'Untitled');
    }
  }
  
  return file ? file.name : 'Untitled';
}

// タブ管理クラス
class TabManager {
  constructor() {
    this.tabs = [];
    this.activeTabId = null;
    this.tabCounter = 0;
  }

  createTab(file, skipEditorCreation = false) {
    const tabId = `tab-${this.tabCounter++}`;
    const tab = {
      id: tabId,
      file: file,
      isModified: false,
      title: file ? file.name : 'Untitled'
    };
    
    this.tabs.push(tab);
    
    // エディタを作成（復元時はスキップ可能）
    if (!skipEditorCreation) {
      const workspace = document.getElementById('editor-workspace');
      const editorContainer = document.createElement('div');
      editorContainer.id = `editor-${tabId}`;
      editorContainer.className = 'ace-editor';
      
      // 初期状態でフルサイズを設定
      editorContainer.style.flex = '1';
      editorContainer.style.width = '100%';
      editorContainer.style.height = '100%';
      editorContainer.style.display = 'flex';
      editorContainer.style.position = 'relative';
      
      workspace.appendChild(editorContainer);
      
      initEditor(tabId, `editor-${tabId}`);
    }
    
    this.renderTabs();
    this.switchToTab(tabId);
    return tabId;
  }

  async closeTab(tabId, skipAutoSave = false) {
    const tabIndex = this.tabs.findIndex(tab => tab.id === tabId);
    if (tabIndex === -1) return;

    const tab = this.tabs[tabIndex];
    const wasActiveTab = this.activeTabId === tabId;
    
    // 変更がある場合は自動保存（スキップ指定時は除く）
    if (!skipAutoSave && tab.isModified && tab.file) {
      await saveFile(tabId);
    }
    
    // 自動保存タイマーをクリア
    if (autoSaveTimers[tabId]) {
      clearTimeout(autoSaveTimers[tabId]);
      delete autoSaveTimers[tabId];
    }

    // インタラクション記録をクリア
    delete editorInteractions[tabId];

    // IME変換フラグをクリア
    delete imeComposing[tabId];
    
    // 最後に開いたファイルがこのタブだった場合はクリア
    if (lastOpenedFromFileList === tabId) {
      lastOpenedFromFileList = null;
    }
    
    // エディタインスタンスを削除
    if (editors[tab.id]) {
      editors[tab.id].destroy();
      delete editors[tab.id];
    }
    
    // DOM要素も削除
    const editorElement = document.getElementById(`editor-${tab.id}`);
    if (editorElement) {
      editorElement.remove();
    }

    this.tabs.splice(tabIndex, 1);
    
    // アクティブタブが閉じられた場合のみアクティブタブを変更
    if (wasActiveTab && this.tabs.length > 0) {
      // 隣のタブをアクティブにする
      const newActiveIndex = Math.max(0, tabIndex - 1);
      this.switchToTab(this.tabs[newActiveIndex].id);
    } else if (this.tabs.length === 0) {
      this.activeTabId = null;
      updateCurrentFilePath();
    }
    
    this.renderTabs();
  }

  switchToTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    this.activeTabId = tabId;
    
    // エディタの表示を切り替え
    Object.keys(editors).forEach(id => {
      const editorElement = document.getElementById(`editor-${id}`);
      if (editorElement) {
        if (id === tabId) {
          editorElement.style.display = 'flex';
          editorElement.style.visibility = 'visible';
          editorElement.style.position = 'relative';
          editorElement.style.flex = '1';
          editorElement.style.width = '100%';
          editorElement.style.height = '100%';
        } else {
          editorElement.style.display = 'none';
          editorElement.style.visibility = 'hidden';
          editorElement.style.position = 'absolute';
          editorElement.style.width = '0';
          editorElement.style.height = '0';
        }
      }
    });

    // アクティブなエディタのサイズを調整
    if (editors[tabId]) {
      setTimeout(() => {
        editors[tabId].resize();
      }, 50);
    }

    updateCurrentFilePath();
    updateFileStatus();
    this.renderTabs();
  }

  getActiveTab() {
    return this.tabs.find(tab => tab.id === this.activeTabId);
  }

  switchToNextTab() {
    if (this.tabs.length <= 1) return;

    const currentIndex = this.tabs.findIndex(tab => tab.id === this.activeTabId);
    if (currentIndex === -1) return;

    const nextIndex = (currentIndex + 1) % this.tabs.length;
    this.switchToTab(this.tabs[nextIndex].id);
  }

  switchToPreviousTab() {
    if (this.tabs.length <= 1) return;

    const currentIndex = this.tabs.findIndex(tab => tab.id === this.activeTabId);
    if (currentIndex === -1) return;

    const previousIndex = (currentIndex - 1 + this.tabs.length) % this.tabs.length;
    this.switchToTab(this.tabs[previousIndex].id);
  }

  renderTabs() {
    const tabList = document.getElementById('tab-list');
    tabList.innerHTML = '';

    this.tabs.forEach((tab, index) => {
      const tabElement = document.createElement('div');
      tabElement.className = `tab ${tab.id === this.activeTabId ? 'active' : ''}`;
      tabElement.draggable = true;
      tabElement.dataset.tabId = tab.id;
      tabElement.dataset.tabIndex = index;
      
      const tabName = document.createElement('div');
      tabName.className = 'tab-name';
      tabName.textContent = tab.title || (tab.file ? tab.file.name : 'Untitled');
      
      const tabClose = document.createElement('button');
      tabClose.className = 'tab-close';
      tabClose.textContent = '×';
      tabClose.onclick = async (e) => {
        e.stopPropagation();
        await this.closeTab(tab.id);
      };
      
      tabElement.appendChild(tabName);
      tabElement.appendChild(tabClose);
      
      // ドラッグイベント
      tabElement.addEventListener('dragstart', this.handleDragStart.bind(this));
      tabElement.addEventListener('dragover', this.handleDragOver.bind(this));
      tabElement.addEventListener('drop', this.handleDrop.bind(this));
      tabElement.addEventListener('dragend', this.handleDragEnd.bind(this));
      
      // タブ右クリックイベント
      tabElement.addEventListener('contextmenu', (e) => showTabContextMenu(e, tab.id));
      
      tabElement.onclick = () => this.switchToTab(tab.id);
      tabList.appendChild(tabElement);
    });

    // スクロールボタンの状態を更新
    setTimeout(updateScrollButtons, 0);

    // 空状態の表示/非表示を更新
    updateEmptyState();

    // セッションを保存
    this.saveSession();
  }

  handleDragStart(e) {
    this.draggedTabId = e.target.dataset.tabId;
    e.target.style.opacity = '0.5';
  }

  handleDragOver(e) {
    e.preventDefault();
    e.target.closest('.tab').style.backgroundColor = '#4e4e52';
  }

  handleDragEnd(e) {
    e.target.style.opacity = '1';
    // ドラッグ中のスタイルをリセット
    document.querySelectorAll('.tab').forEach(tab => {
      tab.style.backgroundColor = '';
    });
  }

  handleDrop(e) {
    e.preventDefault();
    e.target.style.backgroundColor = '';
    
    const targetTabId = e.target.closest('.tab').dataset.tabId;
    
    if (this.draggedTabId && targetTabId && this.draggedTabId !== targetTabId) {
      this.reorderTabs(this.draggedTabId, targetTabId);
    }
    
    this.draggedTabId = null;
  }

  reorderTabs(draggedTabId, targetTabId) {
    const draggedIndex = this.tabs.findIndex(tab => tab.id === draggedTabId);
    const targetIndex = this.tabs.findIndex(tab => tab.id === targetTabId);
    
    if (draggedIndex === -1 || targetIndex === -1) return;
    
    // タブを移動
    const draggedTab = this.tabs.splice(draggedIndex, 1)[0];
    this.tabs.splice(targetIndex, 0, draggedTab);
    
    this.renderTabs();
  }

  updateTabTitle(tabId, content) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab && tab.file) {
      const newTitle = getFileTitle(tab.file, content);
      if (tab.title !== newTitle) {
        tab.title = newTitle;
        this.renderTabs();
      }
    }
  }

  async saveSession() {
    const session = {
      openTabs: this.tabs.map(tab => ({
        id: tab.id,
        filePath: tab.file ? tab.file.path : null,
        isModified: tab.isModified
      })),
      activeTabId: this.activeTabId
    };
    
    try {
      await window.api.saveSession(session);
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  }

  async restoreSession() {
    try {
      const session = await window.api.getSession();

      if (!session.openTabs || session.openTabs.length === 0) {
        return; // セッションがない場合は何もしない
      }

      // タブを復元（存在するファイルのみ）
      const restoredTabs = [];
      for (const tabData of session.openTabs) {
        if (tabData.filePath) {
          // ファイルの存在を確認（files配列で確認）
          const file = files.find(f => f.path === tabData.filePath);
          if (file) {
            // ファイル読み込みで実際に存在を確認
            const result = await window.api.loadFile(file.path);
            if (result.success) {
              const tabId = this.createTab(file);
              if (editors[tabId]) {
                editors[tabId].setValue(result.content, -1);
                // 初期タイトルを設定
                tabManager.updateTabTitle(tabId, result.content || '');
                restoredTabs.push({ tabId, filePath: file.path, originalId: tabData.id });
              }
            }
          }
        }
      }

      // アクティブタブを復元
      if (session.activeTabId) {
        const activeTabInfo = restoredTabs.find(t => t.originalId === session.activeTabId);
        if (activeTabInfo) {
          const activeTab = this.tabs.find(t => t.id === activeTabInfo.tabId);
          if (activeTab) {
            this.switchToTab(activeTab.id);
          }
        } else if (restoredTabs.length > 0) {
          // 元のアクティブタブが存在しない場合は最初のタブをアクティブに
          this.switchToTab(restoredTabs[0].tabId);
        }
      }

    } catch (error) {
      console.error('Failed to restore session:', error);
    }
  }
}


const tabManager = new TabManager();

// ACEエディタの初期化
function initEditor(tabId, containerId) {
  const editor = ace.edit(containerId);
  
  // 基本設定
  editor.setTheme(currentTheme || settings.theme);
  editor.session.setMode("ace/mode/markdown");
  editor.setFontSize(settings.fontSize);
  editor.container.style.lineHeight = settings.lineHeight;
  editor.setOption("wrap", settings.wordWrap);
  editor.renderer.setShowGutter(settings.showLineNumbers);
  editor.setShowInvisibles(settings.showInvisibles);
  
  // キーバインドの設定
  if (settings.keybinding) {
    editor.setKeyboardHandler(settings.keybinding);

    // Emacsキーバインドの場合、Ctrl+Sのコマンドを再度追加
    if (settings.keybinding === 'ace/keyboard/emacs') {
      setTimeout(() => {
        editor.commands.addCommand({
          name: 'emacsSearchOverride',
          bindKey: {
            win: 'Ctrl-S',
            mac: 'Ctrl-S'
          },
          exec: function(editor) {
            console.log('Emacs Ctrl+S override triggered');
            editor.execCommand('find');
          }
        });
      }, 100);
    }
  }

  // 箇条書きのインデント制御（Tab）
  editor.commands.addCommand({
    name: 'bulletIndent',
    bindKey: { win: 'Tab', mac: 'Tab' },
    exec: function(editor) {
      const cursor = editor.getCursorPosition();
      const line = editor.session.getLine(cursor.row);

      // 箇条書き行かチェック（先頭空白の後に - や * や 1. などがある）
      const bulletPattern = /^(\s*)([-*]|\d+\.)\s/;
      const match = line.match(bulletPattern);

      if (match) {
        // 箇条書き行の場合、行の先頭に2スペースを追加
        editor.session.indentRows(cursor.row, cursor.row, '  ');
        return;
      }

      // 箇条書きでない場合は通常のタブ挿入
      editor.indent();
    }
  });

  // 箇条書きのアウトデント制御（Shift+Tab）
  editor.commands.addCommand({
    name: 'bulletOutdent',
    bindKey: { win: 'Shift-Tab', mac: 'Shift-Tab' },
    exec: function(editor) {
      const cursor = editor.getCursorPosition();
      const line = editor.session.getLine(cursor.row);

      // 箇条書き行かチェック
      const bulletPattern = /^(\s*)([-*]|\d+\.)\s/;
      const match = line.match(bulletPattern);

      if (match) {
        // 箇条書き行の場合、先頭のインデントを削除（2スペースまたは1タブ）
        const leadingSpaces = match[1];
        if (leadingSpaces.length >= 2) {
          // 2スペース削除
          const newLine = line.substring(2);
          editor.session.replace(
            new ace.Range(cursor.row, 0, cursor.row, line.length),
            newLine
          );
          return;
        } else if (leadingSpaces.length === 1) {
          // 1スペース削除
          const newLine = line.substring(1);
          editor.session.replace(
            new ace.Range(cursor.row, 0, cursor.row, line.length),
            newLine
          );
          return;
        }
      }

      // 箇条書きでない場合、または既にインデントがない場合は通常のアウトデント
      editor.blockOutdent();
    }
  });

  // 自動補完の有効化
  editor.setOptions({
    enableBasicAutocompletion: true,
    enableSnippets: true,
    enableLiveAutocompletion: false
  });
  
  // エディタの右クリックコンテキストメニューをカスタマイズ
  editor.container.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showEditorContextMenu(e, tabId);
  });
  
  // エディタのマウスイベントを処理する別の方法
  editor.on('mousedown', (e) => {
    if (e.domEvent.button === 2) { // 右クリック
      e.domEvent.preventDefault();
      showEditorContextMenu(e.domEvent, tabId);
    }
  });
  
  // エディタ固有のキーイベントリスナーを追加（Emacsキーバインド用）
  editor.container.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && settings.keybinding === 'ace/keyboard/emacs') {
      console.log('Editor-specific Ctrl+S for Emacs mode');
      e.preventDefault();
      e.stopPropagation();
      
      // 検索ボックスを直接制御
      setTimeout(() => {
        if (editor.searchBox) {
          console.log('Hiding existing searchBox');
          editor.searchBox.hide();
          editor.searchBox = null;
        }
        
        setTimeout(() => {
          editor.focus();
          editor.execCommand('find');
          console.log('Find command executed from editor-specific handler');
        }, 50);
      }, 10);
    }
  });
  
  // 検索ボックスが閉じられた時のイベントリスナーを追加
  editor.on('changeStatus', () => {
    // 検索ボックスが閉じられた場合、エディタにフォーカスを戻す
    setTimeout(() => {
      if (!editor.searchBox || (editor.searchBox && editor.searchBox.element && editor.searchBox.element.style.display === 'none')) {
        editor.focus();
      }
    }, 100);
  });
  
  // エディタ内検索のキーバインド
  editor.commands.addCommand({
    name: 'findInEditor',
    bindKey: {
      win: 'Ctrl-F',
      mac: 'Cmd-F'
    },
    exec: function(editor) {
      editor.execCommand('find');
    }
  });
  
  // 全キーバインド共通のシステムクリップボード連携
  
  // ACEエディタのコピー/カットイベントをインターセプト
  editor.on('copy', async function(text) {
    try {
      // 文字列であることを確認してからクリップボードに書き込み
      const textToWrite = typeof text === 'string' ? text : editor.getSelectedText();
      if (textToWrite && typeof textToWrite === 'string') {
        await navigator.clipboard.writeText(textToWrite);
      }
    } catch (error) {
      console.log('Clipboard write failed:', error);
    }
  });
  
  editor.on('cut', async function(text) {
    try {
      // 文字列であることを確認してからクリップボードに書き込み
      const textToWrite = typeof text === 'string' ? text : editor.getSelectedText();
      if (textToWrite && typeof textToWrite === 'string') {
        await navigator.clipboard.writeText(textToWrite);
      }
    } catch (error) {
      console.log('Clipboard write failed:', error);
    }
  });
  
  // エディタコンテナでのクリップボードイベント処理
  editor.container.addEventListener('copy', async function(e) {
    const selectedText = editor.getSelectedText();
    if (selectedText) {
      try {
        await navigator.clipboard.writeText(selectedText);
        e.clipboardData?.setData('text/plain', selectedText);
      } catch (error) {
        console.log('Container copy failed:', error);
      }
    }
  });
  
  editor.container.addEventListener('cut', async function(e) {
    const selectedText = editor.getSelectedText();
    if (selectedText) {
      try {
        await navigator.clipboard.writeText(selectedText);
        e.clipboardData?.setData('text/plain', selectedText);
        editor.execCommand('cut');
      } catch (error) {
        console.log('Container cut failed:', error);
      }
    }
  });
  
  editor.container.addEventListener('paste', async function(e) {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText) {
        e.preventDefault();
        editor.insert(clipboardText);
      }
    } catch (error) {
      // デフォルトの貼り付け動作を許可
      console.log('Container paste failed:', error);
    }
  });
  
  // 標準的なコピー（Ctrl+C / Cmd+C）
  editor.commands.addCommand({
    name: 'copyToSystemClipboard',
    bindKey: {
      win: 'Ctrl-C',
      mac: 'Cmd-C'
    },
    exec: async function(editor) {
      const selectedText = editor.getSelectedText();
      if (selectedText) {
        try {
          await navigator.clipboard.writeText(selectedText);
          // ACEエディタのデフォルト動作も実行
          editor.execCommand('copy');
        } catch (error) {
          // フォールバック: ACEエディタのデフォルト動作のみ
          editor.execCommand('copy');
        }
      }
    }
  });
  
  // 標準的な切り取り（Ctrl+X / Cmd+X）
  editor.commands.addCommand({
    name: 'cutToSystemClipboard',
    bindKey: {
      win: 'Ctrl-X',
      mac: 'Cmd-X'
    },
    exec: async function(editor) {
      const selectedText = editor.getSelectedText();
      if (selectedText) {
        try {
          await navigator.clipboard.writeText(selectedText);
          editor.execCommand('cut');
        } catch (error) {
          // フォールバック: ACEエディタのデフォルト動作
          editor.execCommand('cut');
        }
      }
    }
  });
  
  // 標準的な貼り付け（Ctrl+V / Cmd+V）
  editor.commands.addCommand({
    name: 'pasteFromSystemClipboard',
    bindKey: {
      win: 'Ctrl-V',
      mac: 'Cmd-V'
    },
    exec: async function(editor) {
      try {
        const clipboardText = await navigator.clipboard.readText();
        if (clipboardText) {
          editor.insert(clipboardText);
        }
      } catch (error) {
        // フォールバック: ACEエディタのデフォルト動作
        editor.execCommand('paste');
      }
    }
  });
  
  // Emacsキーバインド用の追加ショートカット
  
  // kill-region (^W)
  editor.commands.addCommand({
    name: 'killRegion',
    bindKey: {
      win: 'Ctrl-W',
      mac: 'Ctrl-W'
    },
    exec: async function(editor) {
      if (settings.keybinding === 'ace/keyboard/emacs') {
        const selectedText = editor.getSelectedText();
        if (selectedText && typeof selectedText === 'string') {
          try {
            await navigator.clipboard.writeText(selectedText);
            // 選択範囲を削除
            editor.session.replace(editor.getSelectionRange(), '');
          } catch (error) {
            editor.execCommand('cut');
          }
        }
      }
    }
  });
  
  // kill-ring-save (Alt+W)
  editor.commands.addCommand({
    name: 'killRingSave',
    bindKey: {
      win: 'Alt-W',
      mac: 'Alt-W'
    },
    exec: async function(editor) {
      if (settings.keybinding === 'ace/keyboard/emacs') {
        const selectedText = editor.getSelectedText();
        if (selectedText && typeof selectedText === 'string') {
          try {
            await navigator.clipboard.writeText(selectedText);
          } catch (error) {
            editor.execCommand('copy');
          }
        }
      }
    }
  });
  
  // yank (^Y)
  editor.commands.addCommand({
    name: 'yank',
    bindKey: {
      win: 'Ctrl-Y',
      mac: 'Ctrl-Y'
    },
    exec: async function(editor) {
      if (settings.keybinding === 'ace/keyboard/emacs') {
        try {
          const clipboardText = await navigator.clipboard.readText();
          if (clipboardText) {
            editor.insert(clipboardText);
          }
        } catch (error) {
          editor.execCommand('paste');
        }
      }
    }
  });
  
  
  // エディタの変更を監視
  editor.session.on('change', () => {
    updateWordCount();
    // タブの変更状態を更新
    const tab = tabManager.tabs.find(tab => tab.id === tabId);
    if (tab) {
      tab.isModified = true;
    }
    
    // タブタイトルを更新
    const content = editor.getValue();
    tabManager.updateTabTitle(tabId, content);
    
    // 自動保存タイマーを設定（5秒後）
    setupAutoSave(tabId);
  });

  editors[tabId] = editor;
  
  // エディタクリック時のインタラクション追跡
  editor.on('focus', () => {
    editorInteractions[tabId] = true;
  });

  editor.on('changeSelection', () => {
    editorInteractions[tabId] = true;
  });

  // IME変換状態の追跡
  const textInput = editor.textInput.getElement();
  textInput.addEventListener('compositionstart', () => {
    imeComposing[tabId] = true;
    console.log(`IME変換開始: tabId=${tabId}`);
  });

  textInput.addEventListener('compositionend', () => {
    imeComposing[tabId] = false;
    console.log(`IME変換終了: tabId=${tabId}`);
  });

  // エディタクリック時に確実にフォーカス
  editor.container.addEventListener('mousedown', () => {
    setTimeout(() => {
      editor.focus();
    }, 10);
  });
  
  // エディタのサイズ調整を強制実行
  setTimeout(() => {
    editor.resize();
  }, 100);
  
  return editor;
}

// 単語数とカウントの更新
function updateWordCount() {
  const activeTab = tabManager.getActiveTab();
  if (!activeTab || !editors[activeTab.id]) return;
  
  const content = editors[activeTab.id].getValue();
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const chars = content.length;
  
  document.getElementById('word-count').textContent = `Words: ${words}`;
  document.getElementById('char-count').textContent = `Chars: ${chars}`;
}

// ファイル状態の更新
function updateFileStatus() {
  // 保存ボタンは削除されたため、この関数は空にする
}

// ファイルリストの表示
async function displayFiles() {
  const fileList = document.getElementById('file-list');
  fileList.innerHTML = '';

  // タグフィルターを適用
  const filteredFiles = files.filter(file => fileMatchesTagFilter(file));
  
  filteredFiles.forEach(file => {
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    
    // ファイルタイプに応じてクラスを追加
    if (file.name.endsWith('.md')) {
      fileItem.classList.add('markdown');
    } else if (file.name.endsWith('.txt')) {
      fileItem.classList.add('text');
    }
    
    // タグの有無を先に判定
    const fileTagIds = fileTags.filter(ft => ft.filePath === file.name).map(ft => ft.tagId);

    // タグをorder順にソート
    const sortedTags = fileTagIds
      .map(tagId => tags.find(t => t.id === tagId))
      .filter(tag => tag !== undefined)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    const icon = document.createElement('span');
    icon.className = 'file-icon material-symbols-outlined';
    icon.textContent = fileTagIds.length > 0 ? 'docs' : 'draft';

    // タグがある場合は先頭のタグの色を適用
    if (sortedTags.length > 0) {
      icon.style.color = sortedTags[0].color;
    }

    const fileInfo = document.createElement('div');
    fileInfo.className = 'file-info';

    const title = document.createElement('div');
    title.className = 'file-title';
    title.textContent = file.title || file.name;

    const name = document.createElement('div');
    name.className = 'file-name';
    name.textContent = file.name;
    
    const modTime = document.createElement('div');
    modTime.className = 'file-mod-time';
    const date = new Date(file.modifiedTime);
    
    // 常に年月日と時刻を表示
    modTime.textContent = date.toLocaleString([], { 
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit', 
      minute: '2-digit'
    });
    
    fileInfo.appendChild(title);
    fileInfo.appendChild(name);
    fileInfo.appendChild(modTime);
    
    fileItem.appendChild(icon);
    fileItem.appendChild(fileInfo);
    
    fileItem.addEventListener('click', () => openFileInTab(file));
    fileItem.addEventListener('contextmenu', (e) => showContextMenu(e, file));
    fileList.appendChild(fileItem);
  });
  
  // フォルダが選択されていない場合のメッセージ
  if (files.length === 0 && !rootFolder) {
    const message = document.createElement('div');
    message.style.cssText = 'padding: 20px; text-align: center; color: #969696; font-size: 14px;';
    message.textContent = 'Ctrl+O でフォルダを選択してください';
    fileList.appendChild(message);
  }
}

// ファイルをタブで開く
async function openFileInTab(file) {
  // すでに開いているタブがあるかチェック
  const existingTab = tabManager.tabs.find(tab => tab.file && tab.file.path === file.path);
  if (existingTab) {
    tabManager.switchToTab(existingTab.id);
    lastOpenedFromFileList = existingTab.id;
    return;
  }
  
  // 直前にファイル一覧から開いたタブがあり、まだエディタをクリックしていない場合は閉じる
  // ただし、他にタブが存在する場合のみ（最後のタブは残す）
  const shouldCloseLastTab = lastOpenedFromFileList && 
                            !hasUserInteractedWithEditor(lastOpenedFromFileList) && 
                            tabManager.tabs.length > 0;
  
  let tabToClose = null;
  if (shouldCloseLastTab) {
    const lastTab = tabManager.tabs.find(t => t.id === lastOpenedFromFileList);
    if (lastTab) {
      tabToClose = lastOpenedFromFileList;
    }
  }
  
  try {
    const result = await window.api.loadFile(file.path);
    if (result.success) {
      // 新しいタブを作成
      const tabId = tabManager.createTab(file);
      
      // タブが正常に作成され、アクティブになったことを確認
      if (tabManager.activeTabId !== tabId) {
        console.warn('Created tab is not active, forcing activation');
        tabManager.switchToTab(tabId);
      }
      
      // エディタにファイル内容を設定
      if (editors[tabId]) {
        editors[tabId].setValue(result.content || '', -1);
        // 初期タイトルを設定
        tabManager.updateTabTitle(tabId, result.content || '');
      }
      
      // 新しいタブが正常に設定された後で古いタブを閉じる
      if (tabToClose) {
        await tabManager.closeTab(tabToClose);
        // 閉じた後も新しいタブをアクティブに保つ
        if (tabManager.activeTabId !== tabId) {
          tabManager.switchToTab(tabId);
        }
      }
      
      // ファイル一覧から開いたタブとして記録
      lastOpenedFromFileList = tabId;
      editorInteractions[tabId] = false; // インタラクション状態を初期化
      
      updateFileStatus();
      updateWordCount();
      showStatus('ファイルを読み込みました');
    } else {
      showStatus('ファイルの読み込みに失敗しました: ' + result.error);
    }
  } catch (error) {
    showStatus('エラー: ' + error.message);
  }
}

// 現在のファイルパス表示を更新
function updateCurrentFilePath() {
  const filePathElement = document.getElementById('current-file-path');
  const fileTagsDisplay = document.getElementById('file-tags-display');
  const editFileTagsBtn = document.getElementById('edit-file-tags-btn');
  const activeTab = tabManager.getActiveTab();

  if (activeTab && activeTab.file) {
    filePathElement.textContent = activeTab.file.relativePath || activeTab.file.name;

    // タグバッジを表示
    updateFileTagsDisplay(activeTab.file.name);

    // 編集ボタンを表示
    editFileTagsBtn.style.display = 'flex';
  } else {
    filePathElement.textContent = 'ファイルが選択されていません';
    fileTagsDisplay.innerHTML = '';
    editFileTagsBtn.style.display = 'none';
  }
}

// ファイル名の後ろのタグバッジを更新
function updateFileTagsDisplay(fileName) {
  const fileTagsDisplay = document.getElementById('file-tags-display');
  fileTagsDisplay.innerHTML = '';

  const fileTagIds = fileTags.filter(ft => ft.filePath === fileName).map(ft => ft.tagId);

  // タグをorder順にソート
  const fileTags_sorted = fileTagIds
    .map(tagId => tags.find(t => t.id === tagId))
    .filter(tag => tag !== undefined)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  fileTags_sorted.forEach(tag => {
    const badge = document.createElement('span');
    badge.className = 'file-tag-badge';
    badge.textContent = tag.name;
    badge.style.backgroundColor = tag.color;
    fileTagsDisplay.appendChild(badge);
  });
}

// ユニークなファイル名を生成
function generateUniqueFileName(baseName) {
  const extension = '.md';
  let fileName = baseName + extension;
  let counter = 2;
  
  // 同名のファイルが存在するかチェック
  while (files.find(file => file.name === fileName)) {
    fileName = `${baseName}(${counter})${extension}`;
    counter++;
  }
  
  return fileName;
}

// 新しいタブと新規ファイルを作成
async function createNewTabWithFile() {
  console.log('createNewTabWithFile called, rootFolder:', rootFolder);
  if (!rootFolder) {
    showStatus('フォルダが選択されていません');
    return;
  }
  
  // 新しいタブを作成（ファイルなしで）
  const tabId = tabManager.createTab(null);
  
  // エディタにプレースホルダーテキストを設定
  const placeholderText = 'タイトルを入力してください';
  if (editors[tabId]) {
    editors[tabId].setValue(placeholderText, -1);
    editors[tabId].selectAll();
    // エディタにフォーカスを移す
    setTimeout(() => {
      editors[tabId].focus();
    }, 100);
  }
  
  // エディタの内容が変更されたときにファイルを保存する特別なハンドラーを設定
  let hasCreatedFile = false;
  
  // 新規ファイル作成用の特別なchangeハンドラー
  const newFileChangeHandler = async () => {
    const content = editors[tabId].getValue();
    console.log('Content changed:', content.substring(0, 50) + '...');
    console.log('hasCreatedFile:', hasCreatedFile);
    console.log('content.trim():', content.trim().substring(0, 30));
    console.log('placeholderText.trim():', placeholderText.trim());
    console.log('condition check:', !hasCreatedFile && content.trim() && content.trim() !== placeholderText.trim());
    
    if (!hasCreatedFile && content.trim() && content.trim() !== placeholderText.trim()) {
      // 空白でない行をカウント
      const lines = content.split('\n');
      const nonEmptyLines = lines.filter(line => line.trim() !== '').length;
      
      console.log('Non-empty lines count:', nonEmptyLines);
      
      // 空白でない行が2行以上になったらファイルを作成
      if (nonEmptyLines >= 2) {
        // 最初の非空白行を取得してファイル名を生成
        let title = 'untitled';
        
        for (let line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            // マークダウンのヘッダー記号を除去し、最初の16文字を使用
            title = trimmed.replace(/^#+\s*/, '').substring(0, 16).replace(/[<>:"/\\|?*]/g, '') || 'untitled';
            break;
          }
        }
        
        const fileName = generateUniqueFileName(title);
        
        try {
          console.log('Creating file:', fileName, 'with content length:', content.length);
          const result = await window.api.createFile(fileName, content);
          console.log('File creation result:', result);
          
          if (result.success) {
            // ファイルが作成されたら、タブに関連付け
            const newFile = {
              name: fileName,
              path: result.filePath,
              title: title
            };
            
            const tab = tabManager.tabs.find(t => t.id === tabId);
            if (tab) {
              tab.file = newFile;
              tab.title = title;
              tabManager.renderTabs();
            }
            
            hasCreatedFile = true;
            
            // 新規ファイル用のハンドラーを削除し、通常のハンドラーを設定
            editors[tabId].session.off('change', newFileChangeHandler);
            
            // 通常のchangeハンドラーを設定
            editors[tabId].session.on('change', () => {
              updateWordCount();
              const tab = tabManager.tabs.find(tab => tab.id === tabId);
              if (tab) {
                tab.isModified = true;
              }
              tabManager.updateTabTitle(tabId, editors[tabId].getValue());
              setupAutoSave(tabId);
            });
            
            showStatus(`ファイル「${fileName}」を作成しました`);
            
            // ファイルリストを更新
            files = await window.api.getFiles();
            displayFiles();
          } else {
            console.error('File creation failed:', result.error);
            showStatus('ファイルの作成に失敗しました: ' + result.error);
          }
        } catch (error) {
          console.error('File creation error:', error);
          showStatus('エラー: ' + error.message);
        }
      }
    } else if (hasCreatedFile) {
      // ファイル作成後は通常の処理を行う（これは通常のハンドラーに移行済みなので不要）
    }
  };
  
  // 新規ファイル用のchangeハンドラーを設定
  editors[tabId].session.on('change', newFileChangeHandler);
}

// 新規ファイルの作成
async function createNewFile() {
  if (!rootFolder) {
    showStatus('フォルダが選択されていません');
    return;
  }
  
  const fileName = prompt('ファイル名を入力してください (.md または .txt):', 'untitled.md');
  if (!fileName) return;
  
  // ファイル名の検証
  if (!fileName.endsWith('.md') && !fileName.endsWith('.txt')) {
    showStatus('ファイル名は .md または .txt で終わる必要があります');
    return;
  }
  
  try {
    const result = await window.api.createFile(fileName, '');
    if (result.success) {
      showStatus('ファイルを作成しました');
      // ファイル監視により自動的にリストが更新される
    } else {
      showStatus('ファイルの作成に失敗しました: ' + result.error);
    }
  } catch (error) {
    showStatus('エラー: ' + error.message);
  }
}

// ファイルの保存
async function saveFile(tabId = null, options = {}) {
  const { isAutoSave = false } = options;
  const tab = tabId ? tabManager.tabs.find(t => t.id === tabId) : tabManager.getActiveTab();

  if (!tab || !tab.file) {
    if (!tabId) showStatus('ファイルが選択されていません');
    return false;
  }

  // 変更がない場合は保存をスキップ
  if (!tab.isModified) {
    if (!tabId) showStatus('変更がありません');
    return true;
  }

  try {
    const content = editors[tab.id].getValue();

    // 現在のファイル内容と比較して実際に変更があるかチェック
    const currentResult = await window.api.loadFile(tab.file.path);
    if (currentResult.success && currentResult.content === content) {
      tab.isModified = false;
      if (!tabId) showStatus('変更がありません');
      return true;
    }

    const result = await window.api.saveFile(tab.file.path, content);
    if (result.success) {
      tab.isModified = false;
      if (!tabId) {
        showStatus('保存しました'); // 手動保存時のみメッセージ表示
      } else if (isAutoSave) {
        console.log(`自動保存: ${tab.file.name}`); // 自動保存時のみログ出力
      }

      // ファイルが保存されたら、ファイル一覧を更新（順序を更新するため）
      // 注意: chokidarのchangeイベントでも自動更新されるが、即座の更新のために手動でも実行
      files = await window.api.getFiles();
      displayFiles();

      return true;
    } else {
      if (!tabId) showStatus('保存に失敗しました: ' + result.error);
      return false;
    }
  } catch (error) {
    if (!tabId) showStatus('エラー: ' + error.message);
    return false;
  }
}

// ユーザーがエディタと対話したかチェック
function hasUserInteractedWithEditor(tabId) {
  return editorInteractions[tabId] === true;
}

// 自動保存タイマーを設定
function setupAutoSave(tabId) {
  // 既存のタイマーをクリア
  if (autoSaveTimers[tabId]) {
    clearTimeout(autoSaveTimers[tabId]);
  }

  // 5秒後に自動保存
  autoSaveTimers[tabId] = setTimeout(async () => {
    const tab = tabManager.tabs.find(t => t.id === tabId);

    // IME変換中の場合は自動保存をスキップして再スケジュール
    if (imeComposing[tabId]) {
      console.log(`IME変換中のため自動保存をスキップ: ${tab?.file?.name}`);
      setupAutoSave(tabId); // 再度タイマーを設定
      return;
    }

    if (tab && tab.isModified && tab.file) {
      await saveFile(tabId, { isAutoSave: true });
    }
    delete autoSaveTimers[tabId];
  }, 5000);
}

// ファイル検索
async function searchFiles() {
  const searchQuery = document.getElementById('search-input').value.trim();
  const searchResults = document.getElementById('search-results');
  const fileList = document.getElementById('file-list');
  
  if (!searchQuery) {
    // 検索クエリが空の場合は検索結果を非表示にしてファイルリストを表示
    searchResults.style.display = 'none';
    fileList.style.display = 'block';
    displayFiles();
    return;
  }
  
  // 検索結果を表示してファイルリストを非表示
  searchResults.style.display = 'block';
  fileList.style.display = 'none';
  
  try {
    // ファイル名と内容を検索
    const results = await window.api.searchFilesContent(searchQuery);
    displaySearchResults(results);
  } catch (error) {
    console.error('Search error:', error);
    searchResults.innerHTML = '<div style="padding: 20px; color: #969696; text-align: center;">検索中にエラーが発生しました</div>';
  }
}

// 検索結果の表示
function displaySearchResults(results) {
  const searchResults = document.getElementById('search-results');
  searchResults.innerHTML = '';

  // タグフィルターを適用
  const filteredResults = results.filter(result => fileMatchesTagFilter(result.file));

  if (filteredResults.length === 0) {
    searchResults.innerHTML = '<div style="padding: 20px; color: #969696; text-align: center;">検索結果が見つかりませんでした</div>';
    return;
  }

  // 各検索結果を表示
  filteredResults.forEach(result => {
    const file = result.file;
    const matches = result.matches;

    const resultContainer = document.createElement('div');
    resultContainer.className = 'search-result-container';

    const fileItem = document.createElement('div');
    fileItem.className = 'file-item search-result-file';

    // ファイルタイプに応じてクラスを追加
    if (file.name.endsWith('.md')) {
      fileItem.classList.add('markdown');
    } else if (file.name.endsWith('.txt')) {
      fileItem.classList.add('text');
    }

    const icon = document.createElement('div');
    icon.className = 'file-icon';
    icon.textContent = file.name.endsWith('.md') ? '📄' : '📝';

    const fileInfo = document.createElement('div');
    fileInfo.className = 'file-info';

    const title = document.createElement('div');
    title.className = 'file-title';
    title.textContent = file.title || file.name;

    const name = document.createElement('div');
    name.className = 'file-name';
    name.textContent = file.name;

    const modTime = document.createElement('div');
    modTime.className = 'file-mod-time';
    const date = new Date(file.modifiedTime);

    // 常に年月日と時刻を表示
    modTime.textContent = date.toLocaleString([], {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    fileInfo.appendChild(title);
    fileInfo.appendChild(name);
    fileInfo.appendChild(modTime);

    fileItem.appendChild(icon);
    fileItem.appendChild(fileInfo);

    // クリックイベント
    fileItem.addEventListener('click', () => {
      openFileFromSearch(file);
    });

    resultContainer.appendChild(fileItem);

    // マッチした部分を表示
    const matchesContainer = document.createElement('div');
    matchesContainer.className = 'search-matches';

    matches.forEach(match => {
      const matchItem = document.createElement('div');
      matchItem.className = 'search-match-item';

      if (match.type === 'filename') {
        matchItem.classList.add('match-filename');
        matchItem.innerHTML = `<span class="match-type">ファイル名</span> ${escapeHtml(match.text)}`;
        // ファイル名マッチはファイルを開くだけ
        matchItem.addEventListener('click', () => {
          openFileFromSearch(file);
        });
      } else {
        matchItem.classList.add('match-content');
        matchItem.innerHTML = `<span class="match-line-number">行 ${match.line}</span> ${escapeHtml(match.text)}`;
        // コンテンツマッチは行番号を渡して開く
        matchItem.addEventListener('click', () => {
          openFileFromSearch(file, match.line);
        });
      }

      matchesContainer.appendChild(matchItem);
    });

    resultContainer.appendChild(matchesContainer);
    searchResults.appendChild(resultContainer);
  });
}

// HTMLエスケープ用ヘルパー関数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 検索結果からファイルを開く
async function openFileFromSearch(file, lineNumber = null) {
  // 検索結果はそのままにしてファイルを開く
  await openFileInTab(file);

  // 行番号が指定されている場合、その行にスクロール
  if (lineNumber !== null && tabManager.activeTabId) {
    const editor = editors[tabManager.activeTabId];
    if (editor) {
      // エディタが準備できるまで少し待つ
      setTimeout(() => {
        editor.gotoLine(lineNumber, 0, true); // 行番号、カラム、アニメーション有効
        editor.focus();
      }, 100);
    }
  }
}

// 検索をクリア
function clearSearch() {
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const fileList = document.getElementById('file-list');
  
  searchInput.value = '';
  searchResults.style.display = 'none';
  fileList.style.display = 'block';
  displayFiles();
}

// 空白文字表示の切り替え
// テーマの切り替え
async function toggleTheme() {
  const theme1 = settings.theme;
  const theme2 = settings.themePreset2;

  // テーマ1とテーマ2を切り替え
  if (currentTheme === theme2) {
    // 現在テーマ2なら、テーマ1に戻す
    currentTheme = theme1;
    settings.themeIndex = 0;
  } else {
    // 現在テーマ1なら、テーマ2に切り替え
    currentTheme = theme2;
    settings.themeIndex = 1;
  }

  // 全てのエディタに適用
  Object.values(editors).forEach(editor => {
    editor.setTheme(currentTheme);
  });

  // アプリのテーマも更新
  updateAppTheme(currentTheme);

  // themeIndexのみ保存（theme と themePreset2 は変更しない）
  await window.api.saveSettings(settings);

  const themeName = currentTheme.split('/').pop().replace('_', ' ');
  showStatus(`テーマを ${themeName} に変更`);
}

async function toggleWhitespace() {
  settings.showInvisibles = !settings.showInvisibles;

  // 全てのエディタに適用
  Object.values(editors).forEach(editor => {
    editor.setShowInvisibles(settings.showInvisibles);
  });

  // ボタンの表示を更新
  const button = document.getElementById('toggle-whitespace-btn');
  button.style.backgroundColor = settings.showInvisibles ? '#007acc' : 'transparent';

  // 設定を保存
  await window.api.saveSettings(settings);

  showStatus(settings.showInvisibles ? '空白文字を表示中' : '空白文字を非表示');
}

// フォントサイズの拡大
async function increaseFontSize() {
  if (settings.fontSize < 30) {
    settings.fontSize += 1;
    
    // 全てのエディタに適用
    Object.values(editors).forEach(editor => {
      editor.setFontSize(settings.fontSize);
    });
    
    // 設定を保存
    await window.api.saveSettings(settings);
    
    showStatus(`フォントサイズ: ${settings.fontSize}px`);
  }
}

// プレビューを開く
async function openPreview() {
  const result = await window.api.openPreview();
  if (result.success) {
    // 現在のアクティブタブの内容を送信
    const activeTab = tabManager.getActiveTab();
    if (activeTab) {
      const editor = editors[activeTab.id];
      if (editor) {
        const content = editor.getValue();
        await window.api.updatePreview(content);
      }
    }
    showStatus('プレビューウィンドウを開きました');
  }
}

// プレビューの再読み込みリクエストを受信
window.api.onReloadPreviewContent(() => {
  const activeTab = tabManager.getActiveTab();
  if (activeTab) {
    const editor = editors[activeTab.id];
    if (editor) {
      const content = editor.getValue();
      window.api.updatePreview(content);
    }
  }
});

// フォントサイズの縮小
async function decreaseFontSize() {
  if (settings.fontSize > 10) {
    settings.fontSize -= 1;

    // 全てのエディタに適用
    Object.values(editors).forEach(editor => {
      editor.setFontSize(settings.fontSize);
    });

    // 設定を保存
    await window.api.saveSettings(settings);

    showStatus(`フォントサイズ: ${settings.fontSize}px`);
  }
}

// タブを左にスクロール
function scrollTabsLeft() {
  const tabList = document.getElementById('tab-list');
  tabList.scrollBy({
    left: -200,
    behavior: 'smooth'
  });
  updateScrollButtons();
}

// タブを右にスクロール
function scrollTabsRight() {
  const tabList = document.getElementById('tab-list');
  tabList.scrollBy({
    left: 200,
    behavior: 'smooth'
  });
  updateScrollButtons();
}

// スクロールボタンの有効/無効を更新
function updateScrollButtons() {
  const tabList = document.getElementById('tab-list');
  const scrollLeftBtn = document.getElementById('tab-scroll-left');
  const scrollRightBtn = document.getElementById('tab-scroll-right');

  // 左端にいるか確認
  scrollLeftBtn.disabled = tabList.scrollLeft <= 0;

  // 右端にいるか確認
  const maxScroll = tabList.scrollWidth - tabList.clientWidth;
  scrollRightBtn.disabled = tabList.scrollLeft >= maxScroll;
}

// コンテキストメニューの表示
let currentContextFile = null;
let currentContextTabId = null;
function showContextMenu(event, file) {
  event.preventDefault();
  
  currentContextFile = file;
  const contextMenu = document.getElementById('context-menu');
  
  // まず表示してサイズを取得
  contextMenu.style.display = 'block';
  contextMenu.style.visibility = 'hidden';
  
  // コンテキストメニューのサイズを取得
  const menuRect = contextMenu.getBoundingClientRect();
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  
  // 初期位置
  let left = event.pageX;
  let top = event.pageY;
  
  // 右端からはみ出る場合は左に移動
  if (left + menuRect.width > windowWidth) {
    left = windowWidth - menuRect.width - 10; // 10pxのマージン
  }
  
  // 下端からはみ出る場合は上に移動
  if (top + menuRect.height > windowHeight) {
    top = event.pageY - menuRect.height;
  }
  
  // 左端や上端からはみ出ないように調整
  left = Math.max(10, left); // 最低10pxのマージン
  top = Math.max(10, top);
  
  // 位置を設定して表示
  contextMenu.style.left = left + 'px';
  contextMenu.style.top = top + 'px';
  contextMenu.style.visibility = 'visible';
}

// コンテキストメニューを非表示
function hideContextMenu() {
  const contextMenu = document.getElementById('context-menu');
  contextMenu.style.display = 'none';
  currentContextFile = null;
}

// ステータスバー用コンテキストメニューの表示
function showStatusContextMenu(event) {
  event.preventDefault();
  
  const statusContextMenu = document.getElementById('status-context-menu');
  
  // まず表示してサイズを取得
  statusContextMenu.style.display = 'block';
  statusContextMenu.style.visibility = 'hidden';
  
  // コンテキストメニューのサイズを取得
  const menuRect = statusContextMenu.getBoundingClientRect();
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  
  // 初期位置
  let left = event.pageX;
  let top = event.pageY;
  
  // 右端からはみ出る場合は左に移動
  if (left + menuRect.width > windowWidth) {
    left = windowWidth - menuRect.width - 10; // 10pxのマージン
  }
  
  // 下端からはみ出る場合は上に移動
  if (top + menuRect.height > windowHeight) {
    top = event.pageY - menuRect.height;
  }
  
  // 左端や上端からはみ出ないように調整
  left = Math.max(10, left); // 最低10pxのマージン
  top = Math.max(10, top);
  
  // 位置を設定して表示
  statusContextMenu.style.left = left + 'px';
  statusContextMenu.style.top = top + 'px';
  statusContextMenu.style.visibility = 'visible';
}

// ステータスバー用コンテキストメニューを非表示
function hideStatusContextMenu() {
  const statusContextMenu = document.getElementById('status-context-menu');
  statusContextMenu.style.display = 'none';
}

// 箇条書きを追加する関数
function addBulletPoints(editor, type) {
  console.log('addBulletPoints called with type:', type);

  if (!editor) {
    console.error('Editor is null');
    return;
  }

  const selection = editor.getSelectionRange();
  const startRow = selection.start.row;
  const endRow = selection.end.row;

  console.log('Processing rows:', startRow, 'to', endRow);

  // 全ての変更を1つの文字列として準備
  const newLines = [];
  for (let row = startRow; row <= endRow; row++) {
    const line = editor.session.getLine(row);

    // 先頭の空白文字を検出
    const leadingWhitespace = line.match(/^(\s*)/)[0];
    const textAfterWhitespace = line.substring(leadingWhitespace.length);

    let bulletMark;
    if (type === '-') {
      // 箇条書き(-)を追加：先頭空白の後に "- " を挿入
      bulletMark = '- ';
    } else if (type === '1') {
      // 箇条書き(1.)を追加：先頭空白の後に "1. " を挿入
      bulletMark = '1. ';
    }

    newLines.push(leadingWhitespace + bulletMark + textAfterWhitespace);
  }

  // 選択範囲全体を一度に置換（これで1回のUndoになる）
  const range = {
    start: { row: startRow, column: 0 },
    end: { row: endRow, column: editor.session.getLine(endRow).length }
  };

  editor.session.replace(range, newLines.join('\n'));

  console.log('Bullet points added successfully');

  // 選択範囲を更新
  editor.selection.setRange({
    start: { row: startRow, column: 0 },
    end: { row: startRow + newLines.length - 1, column: newLines[newLines.length - 1].length }
  });
}

// 箇条書きを削除する関数
function removeBulletPoints(editor) {
  console.log('removeBulletPoints called');

  if (!editor) {
    console.error('Editor is null');
    return;
  }

  const selection = editor.getSelectionRange();
  const startRow = selection.start.row;
  const endRow = selection.end.row;

  console.log('Processing rows:', startRow, 'to', endRow);

  // 全ての変更を1つの文字列として準備
  const newLines = [];
  for (let row = startRow; row <= endRow; row++) {
    const line = editor.session.getLine(row);

    // 先頭の空白を保持しつつ、箇条書きマークを削除
    const leadingWhitespace = line.match(/^(\s*)/)[0];
    const afterWhitespace = line.substring(leadingWhitespace.length);

    let newLine = afterWhitespace;
    // "- " または "* " を削除
    if (afterWhitespace.match(/^[-*]\s/)) {
      newLine = afterWhitespace.replace(/^[-*]\s/, '');
    }
    // "1. " などの数字付き箇条書きを削除
    else if (afterWhitespace.match(/^\d+\.\s/)) {
      newLine = afterWhitespace.replace(/^\d+\.\s/, '');
    }

    newLines.push(leadingWhitespace + newLine);
  }

  // 選択範囲全体を一度に置換（これで1回のUndoになる）
  const range = {
    start: { row: startRow, column: 0 },
    end: { row: endRow, column: editor.session.getLine(endRow).length }
  };

  editor.session.replace(range, newLines.join('\n'));

  console.log('Bullet points removed successfully');

  // 選択範囲を更新
  editor.selection.setRange({
    start: { row: startRow, column: 0 },
    end: { row: startRow + newLines.length - 1, column: newLines[newLines.length - 1].length }
  });
}

// エディタ用コンテキストメニューの表示
function showEditorContextMenu(event, tabId) {
  event.preventDefault();
  event.stopPropagation();
  
  const editor = editors[tabId];
  if (!editor) return;
  
  const selectedText = editor.getSelectedText();
  const cursorPosition = editor.getCursorPosition();
  const lineText = editor.session.getLine(cursorPosition.row);
  
  // URLを検出（簡単な正規表現）
  const urlRegex = /https?:\/\/[^\s]+/g;
  const urlMatches = lineText.match(urlRegex);
  let urlUnderCursor = null;
  
  if (urlMatches) {
    for (let url of urlMatches) {
      const urlStart = lineText.indexOf(url);
      const urlEnd = urlStart + url.length;
      if (cursorPosition.column >= urlStart && cursorPosition.column <= urlEnd) {
        urlUnderCursor = url;
        break;
      }
    }
  }
  
  // コンテキストメニューを作成
  const existingMenu = document.getElementById('editor-context-menu');
  if (existingMenu) {
    existingMenu.remove();
  }
  
  const contextMenu = document.createElement('div');
  contextMenu.id = 'editor-context-menu';
  contextMenu.className = 'context-menu';
  contextMenu.style.position = 'fixed';
  contextMenu.style.zIndex = '99999';
  contextMenu.style.backgroundColor = 'var(--sidebar-color)';
  contextMenu.style.border = '1px solid var(--border-color)';
  contextMenu.style.borderRadius = '4px';
  contextMenu.style.padding = '4px 0';
  contextMenu.style.minWidth = '180px';
  contextMenu.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
  contextMenu.style.display = 'block';
  contextMenu.style.visibility = 'visible';
  
  let menuItems = [];
  
  // URL関連メニュー
  if (urlUnderCursor) {
    menuItems.push({
      text: 'URLを開く',
      action: () => {
        window.api.openUrl(urlUnderCursor);
        hideEditorContextMenu();
      }
    });
  }
  
  // 選択テキスト関連メニュー
  if (selectedText && selectedText.trim()) {
    if (menuItems.length > 0) {
      menuItems.push({ separator: true });
    }
    
    menuItems.push({
      text: 'Googleで検索',
      action: () => {
        window.api.searchGoogle(selectedText.trim());
        hideEditorContextMenu();
      }
    });
  }
  
  // 標準メニュー
  if (menuItems.length > 0) {
    menuItems.push({ separator: true });
  }
  
  menuItems.push(
    {
      text: '切り取り',
      action: async () => {
        const selectedText = editor.getSelectedText();
        if (selectedText) {
          try {
            await navigator.clipboard.writeText(selectedText);
            editor.execCommand('cut');
          } catch (error) {
            // フォールバック: ACEエディタのコマンドのみ実行
            editor.execCommand('cut');
          }
        }
        hideEditorContextMenu();
      }
    },
    {
      text: 'コピー',
      action: async () => {
        const selectedText = editor.getSelectedText();
        if (selectedText) {
          try {
            await navigator.clipboard.writeText(selectedText);
          } catch (error) {
            // フォールバック: ACEエディタのコマンドのみ実行
            editor.execCommand('copy');
          }
        }
        hideEditorContextMenu();
      }
    },
    {
      text: '貼り付け',
      action: async () => {
        try {
          const clipboardText = await navigator.clipboard.readText();
          if (clipboardText) {
            editor.insert(clipboardText);
          }
        } catch (error) {
          // フォールバック: ACEエディタのコマンドのみ実行
          editor.execCommand('paste');
        }
        hideEditorContextMenu();
      }
    },
    { separator: true },
    {
      text: '検索',
      action: () => {
        editor.execCommand('find');
        hideEditorContextMenu();
      }
    },
    {
      text: '置換',
      action: () => {
        editor.execCommand('replace');
        hideEditorContextMenu();
      }
    },
    { separator: true },
    {
      text: '箇条書き(-)にする',
      action: () => {
        addBulletPoints(editor, '-');
        hideEditorContextMenu();
      }
    },
    {
      text: '箇条書き(1)にする',
      action: () => {
        addBulletPoints(editor, '1');
        hideEditorContextMenu();
      }
    },
    {
      text: '箇条書きをやめる',
      action: () => {
        removeBulletPoints(editor);
        hideEditorContextMenu();
      }
    }
  );

  // 表メニュー
  menuItems.push({ separator: true });

  // カーソル位置に表があるかチェック
  const tableAtCursor = detectTableAtCursor(editor);

  if (tableAtCursor) {
    menuItems.push({
      text: '表を編集',
      action: () => {
        openTableEditorForEdit(editor);
        hideEditorContextMenu();
      }
    });
  } else {
    menuItems.push({
      text: '表を追加',
      action: () => {
        openTableEditorForNew();
        hideEditorContextMenu();
      }
    });
  }

  // メニューアイテムを作成
  menuItems.forEach(item => {
    if (item.separator) {
      const separator = document.createElement('div');
      separator.style.height = '1px';
      separator.style.backgroundColor = 'var(--border-color)';
      separator.style.margin = '4px 0';
      contextMenu.appendChild(separator);
    } else {
      const menuItem = document.createElement('div');
      menuItem.className = 'context-menu-item';
      menuItem.textContent = item.text;
      menuItem.style.padding = '8px 16px';
      menuItem.style.cursor = 'pointer';
      menuItem.style.color = 'var(--text-color)';
      menuItem.style.fontSize = '14px';
      menuItem.style.whiteSpace = 'nowrap';
      
      menuItem.addEventListener('mouseover', () => {
        menuItem.style.backgroundColor = 'var(--button-color)';
        menuItem.style.color = '#fff';
      });
      
      menuItem.addEventListener('mouseout', () => {
        menuItem.style.backgroundColor = 'transparent';
        menuItem.style.color = 'var(--text-color)';
      });

      menuItem.addEventListener('click', (e) => {
        e.stopPropagation(); // イベント伝播を停止
        item.action();
      });
      contextMenu.appendChild(menuItem);
    }
  });
  
  document.body.appendChild(contextMenu);
  
  // 位置調整
  const menuRect = contextMenu.getBoundingClientRect();
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  
  let left = event.pageX;
  let top = event.pageY;
  
  if (left + menuRect.width > windowWidth) {
    left = windowWidth - menuRect.width - 10;
  }
  
  if (top + menuRect.height > windowHeight) {
    top = event.pageY - menuRect.height;
  }
  
  left = Math.max(10, left);
  top = Math.max(10, top);
  
  contextMenu.style.left = left + 'px';
  contextMenu.style.top = top + 'px';
}

// エディタ用コンテキストメニューを非表示
function hideEditorContextMenu() {
  const contextMenu = document.getElementById('editor-context-menu');
  if (contextMenu) {
    contextMenu.remove();
  }
}

// タブ用コンテキストメニューの表示
function showTabContextMenu(event, tabId) {
  event.preventDefault();
  event.stopPropagation();
  
  currentContextTabId = tabId;
  const tabContextMenu = document.getElementById('tab-context-menu');
  
  // まず表示してサイズを取得
  tabContextMenu.style.display = 'block';
  tabContextMenu.style.visibility = 'hidden';
  
  // コンテキストメニューのサイズを取得
  const menuRect = tabContextMenu.getBoundingClientRect();
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  
  // 初期位置
  let left = event.pageX;
  let top = event.pageY;
  
  // 右端からはみ出る場合は左に移動
  if (left + menuRect.width > windowWidth) {
    left = windowWidth - menuRect.width - 10; // 10pxのマージン
  }
  
  // 下端からはみ出る場合は上に移動
  if (top + menuRect.height > windowHeight) {
    top = event.pageY - menuRect.height;
  }
  
  // 左端や上端からはみ出ないように調整
  left = Math.max(10, left); // 最低10pxのマージン
  top = Math.max(10, top);
  
  // 位置を設定して表示
  tabContextMenu.style.left = left + 'px';
  tabContextMenu.style.top = top + 'px';
  tabContextMenu.style.visibility = 'visible';
}

// タブ用コンテキストメニューを非表示
function hideTabContextMenu() {
  const tabContextMenu = document.getElementById('tab-context-menu');
  tabContextMenu.style.display = 'none';
  currentContextTabId = null;
}

// すべてのタブを閉じる（右クリックから）
async function closeAllTabsFromContext() {
  // すべてのタブを順次閉じる
  const allTabIds = [...tabManager.tabs.map(tab => tab.id)];
  
  for (const tabId of allTabIds) {
    await tabManager.closeTab(tabId);
  }
  
  hideTabContextMenu();
}

// ファイル名更新（右クリックから）
async function renameFileFromContext() {
  console.log('renameFileFromContext called, currentContextFile:', currentContextFile);
  if (!currentContextFile) {
    console.error('currentContextFile is null');
    showStatus('ファイルが選択されていません');
    return;
  }
  
  try {
    // ファイル内容を読み込んでタイトルを生成
    const result = await window.api.loadFile(currentContextFile.path);
    if (result.success) {
      const lines = result.content.split('\n');
      let title = 'untitled';
      
      for (let line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          // マークダウンのヘッダー記号を除去し、最初の16文字を使用
          title = trimmed.replace(/^#+\s*/, '').substring(0, 16).replace(/[<>:"/\\|?*]/g, '') || 'untitled';
          break;
        }
      }
      
      const extension = currentContextFile.name.substring(currentContextFile.name.lastIndexOf('.'));
      const newFileName = title + extension;
      
      // 同名ファイルがある場合は連番をつける
      let finalFileName = newFileName;
      let counter = 2;
      while (files.find(file => file.name === finalFileName && file.path !== currentContextFile.path)) {
        const baseName = title;
        finalFileName = `${baseName}(${counter})${extension}`;
        counter++;
      }
      
      const newPath = currentContextFile.path.replace(currentContextFile.name, finalFileName);
      
      if (newPath !== currentContextFile.path) {
        const renameResult = await window.api.renameFile(currentContextFile.path, newPath);
        if (renameResult.success) {
          // タブのファイル情報を更新
          const existingTab = tabManager.tabs.find(tab => tab.file && tab.file.path === currentContextFile.path);
          if (existingTab) {
            existingTab.file.path = newPath;
            existingTab.file.name = finalFileName;
            existingTab.title = title;
            tabManager.renderTabs();
            updateCurrentFilePath();
          }

          // セッションを保存してファイルパスの変更を反映
          await saveSession();

          showStatus(`ファイル名を「${finalFileName}」に更新しました`);

          // ファイル一覧を更新
          files = await window.api.getFiles();
          displayFiles();
        } else {
          showStatus(`ファイル名更新エラー: ${renameResult.error}`);
        }
      } else {
        showStatus('ファイル名に変更はありませんでした');
      }
    } else {
      showStatus('ファイル読み込みエラー: ' + result.error);
    }
  } catch (error) {
    console.error('Rename error:', error);
    showStatus('ファイル名の更新に失敗しました');
  }
  
  hideContextMenu();
}

// 開発者ツール起動（ステータスバー右クリックから）
function openDevToolsFromStatusContext() {
  window.api.openDevTools();
  hideStatusContextMenu();
}

// ファイル削除（右クリックから）
async function deleteFileFromContext() {
  if (!currentContextFile) return;
  
  const confirmDelete = confirm(`「${currentContextFile.name}」を削除しますか？\nこの操作は元に戻せません。`);
  if (!confirmDelete) {
    hideContextMenu();
    return;
  }
  
  try {
    const result = await window.api.deleteFile(currentContextFile.path);
    if (result.success) {
      // 削除されたファイルのタブを閉じる（自動保存はスキップ）
      const existingTab = tabManager.tabs.find(tab => tab.file && tab.file.path === currentContextFile.path);
      if (existingTab) {
        await tabManager.closeTab(existingTab.id, true); // skipAutoSave = true
      }
      
      showStatus(`ファイル「${currentContextFile.name}」を削除しました`);
      // ファイル一覧は自動的に更新される（ファイルウォッチャーにより）
    } else {
      showStatus(`削除エラー: ${result.error}`);
    }
  } catch (error) {
    console.error('Delete error:', error);
    showStatus('ファイルの削除に失敗しました');
  }
  
  hideContextMenu();
}

// タグ編集（右クリックから）
async function editTagsFromContext() {
  if (!currentContextFile) {
    console.error('currentContextFile is null');
    showStatus('ファイルが選択されていません');
    return;
  }

  // hideContextMenu()の前にファイルを保存（hideContextMenuでcurrentContextFileがnullになるため）
  const file = currentContextFile;
  hideContextMenu();
  await openTagDialog(file);
}

// ステータス表示
function showStatus(message) {
  const statusText = document.getElementById('status-text');
  statusText.textContent = message;
  setTimeout(() => {
    statusText.textContent = 'Ready';
  }, 2000);
}

// 設定ダイアログの表示
async function showSettings() {
  const dialog = document.getElementById('settings-dialog');
  dialog.classList.remove('hidden');

  // 現在の設定を反映
  document.getElementById('keybinding-select').value = settings.keybinding || '';
  document.getElementById('theme-select').value = settings.theme;
  document.getElementById('theme-preset2').value = settings.themePreset2;
  document.getElementById('font-size').value = settings.fontSize;
  document.getElementById('line-height').value = settings.lineHeight;
  document.getElementById('word-wrap').checked = settings.wordWrap;
  document.getElementById('show-line-numbers').checked = settings.showLineNumbers;

  // タグタブの内容をロード
  await loadTagsForSettings();

  // バージョン情報を取得して表示
  const version = await window.api.getVersion();
  document.getElementById('about-version').textContent = version;
}

// 設定ダイアログを閉じる
function hideSettings() {
  const dialog = document.getElementById('settings-dialog');
  dialog.classList.add('hidden');

  // タグの並び順が変更された可能性があるため、表示を更新
  updateCurrentFilePath(); // ファイルヘッダーのタグバッジ
  renderTagList(); // タグフィルターのタグリスト
}

// 設定タブの切り替え
function switchSettingsTab(tabName) {
  // すべてのタブとペインから active を削除
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelectorAll('.settings-tab-pane').forEach(pane => {
    pane.classList.remove('active');
  });

  // 選択されたタブとペインに active を追加
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(`settings-tab-${tabName}`).classList.add('active');
}

// タグタブ用のタグ一覧を読み込み
async function loadTagsForSettings() {
  await loadTags();

  // 検索ボックスをクリア
  document.getElementById('settings-tag-search-input').value = '';
  settingsTagSearchQuery = '';

  renderSettingsTagList();
}

// タグ一覧を描画（設定画面内）
let settingsTagSearchQuery = '';

function renderSettingsTagList() {
  const tagList = document.getElementById('settings-tag-list');
  tagList.innerHTML = '';

  // 検索クエリでフィルタ
  const filteredTags = tags.filter(tag =>
    tag.name.toLowerCase().includes(settingsTagSearchQuery.toLowerCase())
  );

  if (filteredTags.length === 0) {
    tagList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary-color); font-size: 12px;">タグがありません</div>';
    return;
  }

  filteredTags.forEach((tag, index) => {
    const item = document.createElement('div');
    item.className = 'settings-tag-item';
    item.dataset.tagId = tag.id;
    item.dataset.index = index;
    item.draggable = true;

    // 左側：カラーボックスとタグ名
    const nameSection = document.createElement('div');
    nameSection.className = 'settings-tag-name';

    const colorBox = document.createElement('div');
    colorBox.className = 'settings-tag-color-box';
    colorBox.style.backgroundColor = tag.color;

    const nameText = document.createElement('span');
    nameText.className = 'settings-tag-text';
    nameText.textContent = tag.name;

    nameSection.appendChild(colorBox);
    nameSection.appendChild(nameText);

    // 右側：編集・削除ボタン
    const actions = document.createElement('div');
    actions.className = 'settings-tag-actions';

    const editBtn = document.createElement('button');
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => {
      openEditTagDialog(tag);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', () => {
      deleteTagFromSettings(tag);
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(nameSection);
    item.appendChild(actions);

    // ドラッグ&ドロップイベント
    item.addEventListener('dragstart', handleSettingsTagDragStart);
    item.addEventListener('dragover', handleSettingsTagDragOver);
    item.addEventListener('drop', handleSettingsTagDrop);
    item.addEventListener('dragend', handleSettingsTagDragEnd);

    tagList.appendChild(item);
  });
}

// ドラッグ&ドロップでタグの順序を変更（設定画面）
let draggedSettingsTagIndex = null;

function handleSettingsTagDragStart(e) {
  draggedSettingsTagIndex = parseInt(e.target.dataset.index);
  e.target.classList.add('dragging');
}

function handleSettingsTagDragOver(e) {
  e.preventDefault();
}

async function handleSettingsTagDrop(e) {
  e.preventDefault();
  const dropIndex = parseInt(e.currentTarget.dataset.index);

  if (draggedSettingsTagIndex !== null && draggedSettingsTagIndex !== dropIndex) {
    // 検索クエリでフィルタされているかチェック
    const filteredTags = tags.filter(tag =>
      tag.name.toLowerCase().includes(settingsTagSearchQuery.toLowerCase())
    );

    // フィルタされたリスト内での入れ替え
    const draggedTag = filteredTags[draggedSettingsTagIndex];
    const targetTag = filteredTags[dropIndex];

    // 元のtagsリスト内でのインデックスを取得
    const draggedOriginalIndex = tags.findIndex(t => t.id === draggedTag.id);
    const targetOriginalIndex = tags.findIndex(t => t.id === targetTag.id);

    // タグの順序を入れ替え
    tags.splice(draggedOriginalIndex, 1);
    const newTargetIndex = tags.findIndex(t => t.id === targetTag.id);
    tags.splice(newTargetIndex, 0, draggedTag);

    // 順序を更新してサーバーに保存
    for (let i = 0; i < tags.length; i++) {
      tags[i].order = i;
      await window.api.updateTag(tags[i].id, { order: i });
    }

    renderSettingsTagList();
    displayFiles(); // ファイルリストを更新してタグの順序を反映
  }
}

function handleSettingsTagDragEnd(e) {
  e.target.classList.remove('dragging');
  draggedSettingsTagIndex = null;
}

// 設定画面でタグを削除
async function deleteTagFromSettings(tag) {
  if (!confirm(`タグ「${tag.name}」を削除しますか？\nこのタグが割り当てられているすべてのファイルから削除されます。`)) {
    return;
  }

  const result = await window.api.deleteTag(tag.id);
  if (result.success) {
    await loadTagsForSettings();
    displayFiles(); // ファイルリストを更新
  }
}

// 設定画面でタグを新規作成
async function createTagFromSettings(name) {
  const trimmedName = name.trim();
  if (!trimmedName) return;

  // 既存のタグ名をチェック
  if (tags.find(t => t.name === trimmedName)) {
    alert(`タグ「${trimmedName}」は既に存在します。`);
    return;
  }

  const randomColor = TAG_COLOR_PALETTE[Math.floor(Math.random() * TAG_COLOR_PALETTE.length)];
  const result = await window.api.createTag({
    name: trimmedName,
    color: randomColor,
    order: tags.length
  });

  if (result.success) {
    await loadTagsForSettings();
    document.getElementById('settings-tag-search-input').value = '';
    settingsTagSearchQuery = '';
  }
}

// ACEエディタのテーマに基づいてアプリのテーマを更新
function updateAppTheme(aceTheme) {
  const themeMapping = {
    'ace/theme/monokai': {
      background: '#272822',
      sidebar: '#383830',
      text: '#f8f8f2',
      textSecondary: '#75715e',
      border: '#49483e',
      button: '#66d9ef',
      buttonHover: '#a6e22e'
    },
    'ace/theme/github': {
      background: '#ffffff',
      sidebar: '#f6f8fa',
      text: '#24292e',
      textSecondary: '#586069',
      border: '#e1e4e8',
      button: '#0366d6',
      buttonHover: '#0253cc'
    },
    'ace/theme/tomorrow': {
      background: '#ffffff',
      sidebar: '#f5f5f5',
      text: '#4d4d4c',
      textSecondary: '#8e908c',
      border: '#d6d6d6',
      button: '#4271ae',
      buttonHover: '#3e5f8a'
    },
    'ace/theme/twilight': {
      background: '#141414',
      sidebar: '#232323',
      text: '#f7f7f7',
      textSecondary: '#5f5a60',
      border: '#323232',
      button: '#cda869',
      buttonHover: '#f9ee98'
    },
    'ace/theme/solarized_dark': {
      background: '#002b36',
      sidebar: '#073642',
      text: '#839496',
      textSecondary: '#586e75',
      border: '#094858',
      button: '#268bd2',
      buttonHover: '#2aa198'
    },
    'ace/theme/solarized_light': {
      background: '#fdf6e3',
      sidebar: '#eee8d5',
      text: '#657b83',
      textSecondary: '#93a1a1',
      border: '#e3d7b7',
      button: '#268bd2',
      buttonHover: '#2aa198'
    },
    'ace/theme/dracula': {
      background: '#282a36',
      sidebar: '#44475a',
      text: '#f8f8f2',
      textSecondary: '#6272a4',
      border: '#6272a4',
      button: '#bd93f9',
      buttonHover: '#ff79c6'
    }
  };

  const theme = themeMapping[aceTheme] || themeMapping['ace/theme/monokai'];
  
  // CSS変数を更新
  document.documentElement.style.setProperty('--bg-color', theme.background);
  document.documentElement.style.setProperty('--sidebar-color', theme.sidebar);
  document.documentElement.style.setProperty('--text-color', theme.text);
  document.documentElement.style.setProperty('--text-secondary-color', theme.textSecondary);
  document.documentElement.style.setProperty('--border-color', theme.border);
  document.documentElement.style.setProperty('--button-color', theme.button);
  document.documentElement.style.setProperty('--button-hover-color', theme.buttonHover);
}

// 設定の保存
async function saveSettings() {
  settings.keybinding = document.getElementById('keybinding-select').value;
  settings.theme = document.getElementById('theme-select').value;
  settings.themePreset2 = document.getElementById('theme-preset2').value;
  settings.fontSize = parseInt(document.getElementById('font-size').value);
  settings.lineHeight = parseFloat(document.getElementById('line-height').value);
  settings.wordWrap = document.getElementById('word-wrap').checked;
  settings.showLineNumbers = document.getElementById('show-line-numbers').checked;

  // 現在のテーマを更新
  currentTheme = settings.themeIndex === 0 ? settings.theme : settings.themePreset2;

  // 全エディタに設定を適用
  Object.values(editors).forEach(editor => {
    editor.setTheme(currentTheme);
    editor.setFontSize(settings.fontSize);
    editor.container.style.lineHeight = settings.lineHeight;
    editor.setOption("wrap", settings.wordWrap);
    editor.renderer.setShowGutter(settings.showLineNumbers);
    editor.setShowInvisibles(settings.showInvisibles);
    
    if (settings.keybinding) {
      editor.setKeyboardHandler(settings.keybinding);
      
      // Emacsキーバインドの場合、Ctrl+Sのコマンドを再度追加
      if (settings.keybinding === 'ace/keyboard/emacs') {
        setTimeout(() => {
          editor.commands.addCommand({
            name: 'emacsSearchOverride',
            bindKey: {
              win: 'Ctrl-S',
              mac: 'Ctrl-S'
            },
            exec: function(editor) {
              console.log('Emacs Ctrl+S override triggered');
              editor.execCommand('find');
            }
          });
        }, 100);
      }
    } else {
      editor.setKeyboardHandler(null);
    }
  });
  
  // アプリ全体のテーマを更新
  updateAppTheme(currentTheme);
  
  // 設定を保存
  await window.api.saveSettings(settings);
  hideSettings();
  showStatus('設定を保存しました');
}

// ルートフォルダパスの更新
function updateRootFolderPath() {
  const pathElement = document.getElementById('root-folder-path');
  if (rootFolder) {
    pathElement.textContent = rootFolder;
  } else {
    pathElement.textContent = 'フォルダを選択してください';
  }
}

// 外部で変更されたファイルを再読み込み
async function reloadModifiedOpenFiles() {
  if (!tabManager || !tabManager.tabs) return;

  for (const tab of tabManager.tabs) {
    if (!tab.file || !tab.file.path) continue;

    try {
      // ファイルの現在の内容を読み込む
      const result = await window.api.loadFile(tab.file.path);
      if (!result.success) continue;

      const newContent = result.content;
      const editor = editors[tab.id];
      if (!editor) continue;

      const currentContent = editor.getValue();

      // 内容が変更されている場合のみ再読み込み
      if (newContent !== currentContent) {
        // カーソル位置とスクロール位置を保存
        const cursorPosition = editor.getCursorPosition();
        const scrollTop = editor.session.getScrollTop();
        const scrollLeft = editor.session.getScrollLeft();

        // 内容を更新
        editor.setValue(newContent, -1); // -1 = カーソルを先頭に移動しない

        // カーソル位置を復元
        editor.moveCursorToPosition(cursorPosition);

        // スクロール位置を復元
        editor.session.setScrollTop(scrollTop);
        editor.session.setScrollLeft(scrollLeft);

        // タブのタイトルを更新
        tabManager.updateTabTitle(tab.id, newContent);

        // 変更フラグをクリア（外部変更なので未保存としない）
        tab.isModified = false;
        tabManager.renderTabs();

        console.log(`Reloaded externally modified file: ${tab.file.name}`);
      }
    } catch (error) {
      console.error(`Failed to reload file ${tab.file.path}:`, error);
    }
  }
}

// 空状態の表示/非表示を更新
function updateEmptyState() {
  const emptyState = document.getElementById('editor-empty-state');
  if (emptyState) {
    if (tabManager.tabs.length === 0) {
      emptyState.classList.remove('hidden');
    } else {
      emptyState.classList.add('hidden');
    }
  }
}

// バージョンチェック
async function checkForUpdates() {
  try {
    const result = await window.api.checkUpdate();
    if (result.hasUpdate) {
      // 更新アイコンを表示
      const updateBtn = document.getElementById('update-btn');
      updateBtn.style.display = 'block';
      console.log(`新しいバージョンが利用可能です: ${result.latestVersion} (現在: ${result.currentVersion})`);
    }
  } catch (error) {
    console.error('バージョンチェックに失敗しました:', error);
  }
}

function startVersionCheck() {
  // 起動時にチェック
  checkForUpdates();

  // 24時間ごとにチェック
  setInterval(checkForUpdates, 24 * 60 * 60 * 1000);
}

// 初期化
async function init() {
  // 設定の読み込み
  settings = await window.api.getSettings();

  // themePreset2を初期化（既存設定に無い場合）
  if (!settings.themePreset2) {
    settings.themePreset2 = 'ace/theme/github';
  }

  // themeIndexを初期化（既存設定に無い場合）
  if (settings.themeIndex === undefined) {
    settings.themeIndex = 0;
  }

  // lineHeightを初期化（既存設定に無い場合）
  if (!settings.lineHeight) {
    settings.lineHeight = 1.5;
  }

  // 現在のテーマを設定
  currentTheme = settings.themeIndex === 0 ? settings.theme : settings.themePreset2;

  // アプリ全体のテーマを適用
  updateAppTheme(currentTheme);

  // 空白文字表示ボタンの初期状態を設定
  const whitespaceButton = document.getElementById('toggle-whitespace-btn');
  whitespaceButton.style.backgroundColor = settings.showInvisibles ? '#007acc' : 'transparent';

  // ワークスペースセレクターを初期化
  await initWorkspaceSelector();

  // ファイルとルートフォルダの読み込み
  files = await window.api.getFiles();
  rootFolder = await window.api.getRootFolder();

  // タグデータを読み込み（ファイル表示前に必要）
  await loadTags();

  updateRootFolderPath();
  displayFiles();
  updateFileStatus();
  updateCurrentFilePath();

  // セッションを復元
  await tabManager.restoreSession();

  // タグフィルター状態を復元
  await restoreTagFilterFromSession();

  // 空状態を更新
  updateEmptyState();

  // バージョンチェックを開始
  startVersionCheck();
}

// イベントリスナーの設定
document.addEventListener('DOMContentLoaded', () => {
  init();
  
  // ボタンのイベント
  // document.getElementById('new-file-btn').addEventListener('click', createNewFile); // 削除済み
  document.getElementById('preview-btn').addEventListener('click', openPreview);
  document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);
  document.getElementById('toggle-whitespace-btn').addEventListener('click', toggleWhitespace);
  document.getElementById('font-increase-btn').addEventListener('click', increaseFontSize);
  document.getElementById('font-decrease-btn').addEventListener('click', decreaseFontSize);
  document.getElementById('new-tab-btn').addEventListener('click', () => {
    // 新しいタブを作成して新規ファイルとする
    createNewTabWithFile();
  });

  // 空状態の新規作成ボタン
  document.getElementById('empty-state-new-btn').addEventListener('click', () => {
    createNewTabWithFile();
  });

  // タブスクロールボタン
  document.getElementById('tab-scroll-left').addEventListener('click', scrollTabsLeft);
  document.getElementById('tab-scroll-right').addEventListener('click', scrollTabsRight);

  // タブリストのスクロールイベントを監視
  const tabList = document.getElementById('tab-list');
  tabList.addEventListener('scroll', updateScrollButtons);

  document.getElementById('settings-btn').addEventListener('click', showSettings);
  document.getElementById('update-btn').addEventListener('click', () => {
    window.api.openUrl('https://xpenguin.biz/memo3/');
  });
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  document.getElementById('cancel-settings-btn').addEventListener('click', hideSettings);

  // 設定タブの切り替え
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const tabName = e.target.dataset.tab;
      switchSettingsTab(tabName);
    });
  });

  // 設定画面のタグ検索
  document.getElementById('settings-tag-search-input').addEventListener('input', (e) => {
    settingsTagSearchQuery = e.target.value;
    renderSettingsTagList();
  });

  document.getElementById('settings-tag-search-clear-btn').addEventListener('click', () => {
    document.getElementById('settings-tag-search-input').value = '';
    settingsTagSearchQuery = '';
    renderSettingsTagList();
  });

  // 設定画面のタグ検索でEnterキーで新規作成
  document.getElementById('settings-tag-search-input').addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      await createTagFromSettings(settingsTagSearchQuery);
    }
  });

  // Aboutタブのリンク
  document.getElementById('about-github-link').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openUrl('https://github.com/ytx/memo3');
  });

  document.getElementById('about-download-link').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openUrl('https://xpenguin.biz/memo3/');
  });

  document.getElementById('about-coffee-link').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openUrl('https://buymeacoffee.com/xpenguin');
  });

  // 検索ボックス
  document.getElementById('search-input').addEventListener('input', searchFiles);
  document.getElementById('clear-search-btn').addEventListener('click', clearSearch);

  // タグフィルター
  document.getElementById('toggle-tags-btn').addEventListener('click', toggleTagFilter);
  document.getElementById('clear-tag-filter-btn').addEventListener('click', clearAllTagFilters);

  // コンテキストメニュー
  document.getElementById('context-rename').addEventListener('click', renameFileFromContext);
  document.getElementById('context-delete').addEventListener('click', deleteFileFromContext);
  document.getElementById('context-edit-tags').addEventListener('click', editTagsFromContext);

  // タグダイアログ
  document.getElementById('tag-dialog-close-btn').addEventListener('click', closeTagDialog);

  // 表編集ダイアログ
  document.getElementById('table-add-row-above').addEventListener('click', addRowAbove);
  document.getElementById('table-add-row-below').addEventListener('click', addRowBelow);
  document.getElementById('table-delete-row').addEventListener('click', deleteRow);
  document.getElementById('table-add-col-left').addEventListener('click', addColumnLeft);
  document.getElementById('table-add-col-right').addEventListener('click', addColumnRight);
  document.getElementById('table-delete-col').addEventListener('click', deleteColumn);
  document.getElementById('table-editor-save-btn').addEventListener('click', saveTable);
  document.getElementById('table-editor-cancel-btn').addEventListener('click', closeTableEditor);

  // タグ検索ボックス
  document.getElementById('tag-search-input').addEventListener('input', (e) => {
    tagSearchQuery = e.target.value;
    renderTagFlowArea();
  });

  document.getElementById('tag-search-clear-btn').addEventListener('click', () => {
    document.getElementById('tag-search-input').value = '';
    tagSearchQuery = '';
    renderTagFlowArea();
  });

  // タグ検索ボックスでEnterキーで新規作成
  document.getElementById('tag-search-input').addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      const name = tagSearchQuery.trim();
      if (name && !tags.find(t => t.name === name)) {
        await createTagFromSearch(name);
      }
    }
  });

  // タグ編集ダイアログ
  document.getElementById('edit-tag-save-btn').addEventListener('click', saveEditTag);
  document.getElementById('edit-tag-cancel-btn').addEventListener('click', closeEditTagDialog);
  document.getElementById('edit-tag-name-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') saveEditTag();
  });

  // ファイルタグ編集ボタン（画面上部）
  document.getElementById('edit-file-tags-btn').addEventListener('click', async () => {
    const activeTab = tabManager.getActiveTab();
    if (activeTab && activeTab.file) {
      await openTagDialog(activeTab.file);
    }
  });

  // ステータスバー用コンテキストメニュー
  document.getElementById('status-devtools').addEventListener('click', openDevToolsFromStatusContext);

  // タブ用コンテキストメニュー
  document.getElementById('tab-close-all').addEventListener('click', closeAllTabsFromContext);

  // ステータスバーの右クリック
  document.querySelector('.status-bar').addEventListener('contextmenu', showStatusContextMenu);
  
  // コンテキストメニューを閉じる（ただし、コンテキストメニュー内のクリックは除外）
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#context-menu')) {
      hideContextMenu();
    }
    if (!e.target.closest('#status-context-menu')) {
      hideStatusContextMenu();
    }
    if (!e.target.closest('#tab-context-menu')) {
      hideTabContextMenu();
    }
    if (!e.target.closest('#editor-context-menu')) {
      hideEditorContextMenu();
    }
  });
  document.addEventListener('contextmenu', (e) => {
    // ファイル項目、ステータスバー、タブ、エディタ以外での右クリックでは標準メニューを無効化
    if (!e.target.closest('.file-item') && 
        !e.target.closest('.status-bar') && 
        !e.target.closest('.tab') &&
        !e.target.closest('.ace-editor') &&
        !e.target.closest('.ace_editor')) {
      e.preventDefault();
    }
  });
  
  // キーボードショートカット
  document.addEventListener('keydown', (e) => {
    // キャプチャフェーズでEmacs検索キーを処理
    if (settings.keybinding === 'ace/keyboard/emacs') {
      const isAceTextInput = e.target.tagName === 'TEXTAREA' && e.target.className.includes('ace_text-input');
      const isSearchField = e.target.classList && e.target.classList.contains('ace_search_field');
      
      if (isAceTextInput || isSearchField) {
        const activeTab = tabManager.getActiveTab();
        if (activeTab && editors[activeTab.id]) {
          const editor = editors[activeTab.id];
          const searchBoxOpen = editor.searchBox && editor.searchBox.element && editor.searchBox.element.style.display !== 'none';
          
          // ^S: 検索ボックスが閉じている時は開く、開いている時は次候補
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            e.stopPropagation();
            
            if (searchBoxOpen) {
              // 検索フィールドからの^Sの場合、エディタにフォーカスを戻してから次候補
              if (isSearchField) {
                editor.focus();
                setTimeout(() => {
                  editor.execCommand('findnext');
                }, 10);
              } else {
                // エディタからの^Sの場合、次の候補
                editor.execCommand('findnext');
              }
            } else {
              // 検索ボックスが閉じている場合は開く
              setTimeout(() => {
                if (editor.searchBox) {
                  editor.searchBox.hide();
                  editor.searchBox = null;
                }
                
                setTimeout(() => {
                  editor.execCommand('find');
                }, 50);
              }, 10);
            }
            return;
          }
          
          // ^R: 前の候補
          if ((e.ctrlKey || e.metaKey) && e.key === 'r' && searchBoxOpen) {
            e.preventDefault();
            e.stopPropagation();
            if (isSearchField) {
              editor.focus();
              setTimeout(() => {
                editor.execCommand('findprevious');
              }, 10);
            } else {
              editor.execCommand('findprevious');
            }
            return;
          }
          
          // ^G: 検索ボックスを閉じる
          if ((e.ctrlKey || e.metaKey) && e.key === 'g' && searchBoxOpen) {
            e.preventDefault();
            e.stopPropagation();
            editor.searchBox.hide();
            editor.focus();
            return;
          }
        }
      }
    }
  }, true); // キャプチャフェーズで処理
  
  // 通常のキーボードショートカット（バブルフェーズ）
  document.addEventListener('keydown', (e) => {
    // Cmd+N (macOSのみ): 新しいタブを作成
    if (e.metaKey && !e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      createNewTabWithFile();
      return;
    }

    // Ctrl+Tab: 次のタブに切り替え
    if (e.ctrlKey && e.key === 'Tab' && !e.shiftKey && !e.metaKey) {
      e.preventDefault();
      tabManager.switchToNextTab();
      return;
    }

    // Ctrl+Shift+Tab: 前のタブに切り替え
    if (e.ctrlKey && e.shiftKey && e.key === 'Tab' && !e.metaKey) {
      e.preventDefault();
      tabManager.switchToPreviousTab();
      return;
    }

    // Cmd+S / Ctrl+S: 保存
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      // Emacsキーバインド以外の場合のみ保存
      if (settings.keybinding !== 'ace/keyboard/emacs') {
        e.preventDefault();
        saveFile();
      }
    }
  });
  
  // ウィンドウリサイズ時にエディタサイズを調整
  window.addEventListener('resize', () => {
    setTimeout(() => {
      Object.values(editors).forEach(editor => {
        editor.resize();
      });
    }, 100);
  });
});

// IPCイベントの処理
window.api.onNewMemo(() => createNewTabWithFile());
window.api.onSaveMemo(() => saveFile());
window.api.onOpenSettings(() => showSettings());

// ファイル更新イベントの処理
window.api.onFilesUpdated(async (_, updatedFiles) => {
  files = updatedFiles;
  displayFiles();

  // 開いているタブのファイルが外部で変更されていないかチェック
  await reloadModifiedOpenFiles();

  showStatus('ファイルリストを更新しました');
});

// ===== ワークスペース管理 =====
async function initWorkspaceSelector() {
  await loadWorkspaces();

  // イベントリスナー設定
  document.getElementById('workspace-current-btn').addEventListener('click', toggleWorkspaceMenu);

  // メニューの外をクリックしたら閉じる
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('workspace-dropdown');
    const menu = document.getElementById('workspace-menu');
    if (!dropdown.contains(e.target) && menu.style.display !== 'none') {
      menu.style.display = 'none';
    }
  });
}

async function saveAllModifiedTabs() {
  // 変更されたタブを確認
  const modifiedTabs = tabManager.tabs.filter(tab => tab.isModified);

  if (modifiedTabs.length > 0) {
    // すべての変更を保存
    for (const tab of modifiedTabs) {
      if (tab.file) {
        await saveFile(tab.id);
      }
    }
  }
}

async function checkUnsavedNewTabs() {
  // 新規タブ（ファイル未保存）で内容があるものを確認
  const unsavedNewTabs = [];

  for (const tab of tabManager.tabs) {
    if (!tab.file && editors[tab.id]) {
      const content = editors[tab.id].getValue();
      const lines = content.split('\n').filter(line => line.trim());

      // 内容がある場合（非空白行が1行以上）
      if (lines.length > 0) {
        unsavedNewTabs.push({
          tab: tab,
          content: content,
          lineCount: lines.length,
          preview: lines[0].substring(0, 30) + (lines[0].length > 30 ? '...' : '')
        });
      }
    }
  }

  if (unsavedNewTabs.length === 0) {
    return true; // 問題なし
  }

  // 未保存の新規タブがある場合、確認
  const tabInfo = unsavedNewTabs.map(item =>
    `  - ${item.preview} (${item.lineCount}行)`
  ).join('\n');

  const message = `未保存の新規タブがあります：\n${tabInfo}\n\nどうしますか？`;
  const choice = confirm(message + '\n\n[OK] 保存して切り替え\n[キャンセル] 切り替えをキャンセル');

  if (!choice) {
    return false; // キャンセル
  }

  // 保存して切り替え
  for (const item of unsavedNewTabs) {
    // ファイルを作成して保存
    const lines = item.content.split('\n');
    let fileName = 'Untitled';

    // 最初の非空白行をファイル名に使用
    for (let line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        fileName = trimmed.replace(/^#+\s*/, '').substring(0, 16);
        break;
      }
    }

    // ファイル名に使えない文字を削除
    fileName = fileName.replace(/[\/\\:*?"<>|]/g, '');
    if (!fileName) fileName = 'Untitled';

    // .md 拡張子を追加
    if (!fileName.endsWith('.md')) {
      fileName += '.md';
    }

    // ファイルを作成
    const result = await window.api.createFile(fileName, item.content);
    if (result.success) {
      // タブのファイル情報を更新
      files = await window.api.getFiles();
      const newFile = files.find(f => f.path === result.filePath);
      if (newFile) {
        item.tab.file = newFile;
        item.tab.title = newFile.title || newFile.name;
        item.tab.isModified = false;
      }
    }
  }

  return true; // 保存完了
}

async function loadWorkspaces() {
  try {
    const data = await window.api.getWorkspaces();
    const { workspaces, activeWorkspace } = data;

    // 現在のワークスペース名を表示
    if (activeWorkspace && workspaces.length > 0) {
      const active = workspaces.find(w => w.path === activeWorkspace);
      if (active) {
        document.getElementById('workspace-current-name').textContent = active.name;
      }
    }

    // ワークスペースメニューを描画
    renderWorkspaceMenu(workspaces, activeWorkspace);
  } catch (error) {
    console.error('Failed to load workspaces:', error);
  }
}

function renderWorkspaceMenu(workspaces, activeWorkspace) {
  const menu = document.getElementById('workspace-menu');
  menu.innerHTML = '';

  workspaces.forEach(workspace => {
    const item = document.createElement('div');
    item.className = 'workspace-item';
    if (workspace.path === activeWorkspace) {
      item.classList.add('active');
    }

    const name = document.createElement('span');
    name.className = 'workspace-name';
    name.textContent = workspace.name;
    name.title = workspace.path; // ツールチップでフルパス表示

    const removeBtn = document.createElement('button');
    removeBtn.className = 'workspace-remove-btn';
    removeBtn.textContent = '解除';
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      removeWorkspace(workspace.path);
    };

    item.appendChild(name);
    item.appendChild(removeBtn);

    // ワークスペース名クリックで切り替え
    name.onclick = (e) => {
      e.stopPropagation();
      if (workspace.path !== activeWorkspace) {
        switchWorkspace(workspace.path);
      }
    };

    menu.appendChild(item);
  });

  // 区切り線を追加
  if (workspaces.length > 0) {
    const separator = document.createElement('div');
    separator.className = 'workspace-separator';
    menu.appendChild(separator);
  }

  // 「追加する」オプションを追加
  const addItem = document.createElement('div');
  addItem.className = 'workspace-item workspace-add-item';
  addItem.textContent = '追加する';
  addItem.onclick = async () => {
    await addWorkspace();
  };

  menu.appendChild(addItem);
}

function toggleWorkspaceMenu() {
  const menu = document.getElementById('workspace-menu');
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

async function addWorkspace() {
  try {
    // 未保存の変更を自動保存
    await saveAllModifiedTabs();

    // 未保存の新規タブを確認
    const canProceed = await checkUnsavedNewTabs();
    if (!canProceed) {
      return; // キャンセル
    }

    // 現在のセッションを保存
    await tabManager.saveSession();

    const result = await window.api.addWorkspace();
    if (result.success) {
      // ワークスペースが追加され、自動的に切り替わる
      await loadWorkspaces();

      // すべてのタブを閉じる（セッション保存済み）
      const tabIds = [...tabManager.tabs.map(t => t.id)];
      for (const tabId of tabIds) {
        await tabManager.closeTab(tabId, true); // skipAutoSave = true
      }

      // ファイルリストとタブを更新
      files = await window.api.getFiles();
      rootFolder = await window.api.getRootFolder();
      updateRootFolderPath();
      displayFiles();

      // 新しいワークスペースのセッションを復元
      await tabManager.restoreSession();

      showStatus(`ワークスペース「${result.workspace.name}」を追加しました`);
    }
  } catch (error) {
    console.error('Failed to add workspace:', error);
    showStatus('ワークスペースの追加に失敗しました');
  }
}

async function switchWorkspace(workspacePath) {
  try {
    // 未保存の変更を自動保存
    await saveAllModifiedTabs();

    // 未保存の新規タブを確認
    const canProceed = await checkUnsavedNewTabs();
    if (!canProceed) {
      return; // キャンセル
    }

    // 現在のセッションを保存
    await tabManager.saveSession();

    // ワークスペースを切り替え
    const result = await window.api.switchWorkspace(workspacePath);

    if (result.success) {
      // メニューを閉じる
      document.getElementById('workspace-menu').style.display = 'none';

      // ワークスペースを再読み込み
      await loadWorkspaces();

      // すべてのタブを閉じる（セッション保存済み）
      const tabIds = [...tabManager.tabs.map(t => t.id)];
      for (const tabId of tabIds) {
        await tabManager.closeTab(tabId, true); // skipAutoSave = true
      }

      // ファイルリストとタブを更新
      files = await window.api.getFiles();
      rootFolder = await window.api.getRootFolder();
      updateRootFolderPath();

      // タグデータを再読み込み
      await loadTags();

      // タグフィルター状態を復元
      await restoreTagFilterFromSession();

      displayFiles();

      // 新しいワークスペースのセッションを復元
      await tabManager.restoreSession();

      showStatus('ワークスペースを切り替えました');
    } else {
      if (result.error === 'Workspace folder does not exist') {
        // フォルダが存在しない場合は自動削除を提案
        if (confirm('ワークスペースフォルダが存在しません。リストから削除しますか？')) {
          await removeWorkspace(workspacePath);
        }
      } else {
        showStatus('ワークスペースの切り替えに失敗しました');
      }
    }
  } catch (error) {
    console.error('Failed to switch workspace:', error);
    showStatus('ワークスペースの切り替えに失敗しました');
  }
}

async function removeWorkspace(workspacePath) {
  try {
    // ワークスペース名を取得
    const data = await window.api.getWorkspaces();
    const workspace = data.workspaces.find(w => w.path === workspacePath);
    const workspaceName = workspace ? workspace.name : workspacePath;

    // 確認ダイアログ
    const confirmed = confirm(`ワークスペース「${workspaceName}」をリストから削除しますか？\n\n※フォルダ自体は削除されません。`);
    if (!confirmed) {
      return;
    }

    const result = await window.api.removeWorkspace(workspacePath);

    if (result.success) {
      // ワークスペースリストを再読み込み
      await loadWorkspaces();

      // 削除したワークスペースがアクティブだった場合、UIを更新
      files = await window.api.getFiles();
      rootFolder = await window.api.getRootFolder();
      updateRootFolderPath();
      displayFiles();

      // セッションを復元
      await tabManager.restoreSession();

      showStatus('ワークスペースをリストから削除しました');
    }
  } catch (error) {
    console.error('Failed to remove workspace:', error);
    showStatus('ワークスペースの削除に失敗しました');
  }
}

// ========================================
// タグ管理機能
// ========================================

// タグデータの読み込み
async function loadTags() {
  try {
    const result = await window.api.getTags();
    tags = result.tags || [];
    fileTags = result.fileTags || [];

    // タグフィルター状態を初期化（セッションから復元する場合もある）
    tags.forEach(tag => {
      if (tagFilterStatus[tag.id] === undefined) {
        tagFilterStatus[tag.id] = 'none';
      }
    });

    renderTagList();
    updateTagFilterButton();
  } catch (error) {
    console.error('Failed to load tags:', error);
  }
}

// タグリストの表示
function renderTagList() {
  const tagList = document.getElementById('tag-list');
  tagList.innerHTML = '';

  if (tags.length === 0) {
    tagList.innerHTML = '<div style="padding: 15px; color: #969696; text-align: center; font-size: 12px;">タグがありません</div>';
    return;
  }

  // タグをorder順にソート
  const sortedTags = [...tags].sort((a, b) => (a.order || 0) - (b.order || 0));

  sortedTags.forEach(tag => {
    const tagItem = document.createElement('div');
    tagItem.className = 'tag-item';

    const status = tagFilterStatus[tag.id] || 'none';
    tagItem.classList.add(`status-${status}`);

    // 色インジケーター
    const colorDiv = document.createElement('div');
    colorDiv.className = 'tag-item-color';
    colorDiv.style.backgroundColor = tag.color;

    // タグ名
    const nameDiv = document.createElement('div');
    nameDiv.className = 'tag-item-name';
    nameDiv.textContent = tag.name;

    // ファイル数
    const count = fileTags.filter(ft => ft.tagId === tag.id).length;
    const countDiv = document.createElement('div');
    countDiv.className = 'tag-item-count';
    countDiv.textContent = `(${count})`;

    tagItem.appendChild(colorDiv);
    tagItem.appendChild(nameDiv);
    tagItem.appendChild(countDiv);

    // クリックイベント: ステータスを切り替え
    tagItem.addEventListener('click', () => {
      cycleTagStatus(tag.id);
    });

    tagList.appendChild(tagItem);
  });
}

// タグフィルターの開閉
function toggleTagFilter() {
  const tagFilter = document.getElementById('tag-filter');
  isTagFilterVisible = !isTagFilterVisible;

  if (isTagFilterVisible) {
    tagFilter.style.display = 'block';
  } else {
    tagFilter.style.display = 'none';
  }

  updateTagFilterButton();
}

// タグフィルターボタンの表示を更新
function updateTagFilterButton() {
  const button = document.getElementById('toggle-tags-btn');

  // アクティブなフィルターがあるかチェック
  const hasActiveFilter = Object.values(tagFilterStatus).some(status => status !== 'none');

  if (hasActiveFilter) {
    button.classList.add('active');
  } else {
    button.classList.remove('active');
  }
}

// タグフィルターをすべてクリア
async function clearAllTagFilters() {
  // すべてのタグフィルターステータスを'none'にリセット
  tagFilterStatus = {};

  // 表示を更新
  renderTagList();
  displayFiles();
  updateTagFilterButton();

  // セッションに保存
  await saveTagFilterToSession();
}

// タグステータスを3状態でサイクル
function cycleTagStatus(tagId) {
  const currentStatus = tagFilterStatus[tagId] || 'none';

  // none → show → hide → none
  if (currentStatus === 'none') {
    tagFilterStatus[tagId] = 'show';
  } else if (currentStatus === 'show') {
    tagFilterStatus[tagId] = 'hide';
  } else {
    tagFilterStatus[tagId] = 'none';
  }

  renderTagList();
  updateTagFilterButton();
  applyTagFilter();

  // セッションに保存
  saveTagFilterToSession();
}

// タグフィルターを適用
function applyTagFilter() {
  // 検索がアクティブな場合は検索結果を再表示
  const searchQuery = document.getElementById('search-input').value.trim();
  if (searchQuery) {
    searchFiles();
  } else {
    displayFiles();
  }
}

// タグフィルター状態をセッションに保存
async function saveTagFilterToSession() {
  try {
    const session = await window.api.getSession();
    session.tagFilterStatus = tagFilterStatus;
    await window.api.saveSession(session);
  } catch (error) {
    console.error('Failed to save tag filter to session:', error);
  }
}

// セッションからタグフィルター状態を復元
async function restoreTagFilterFromSession() {
  try {
    const session = await window.api.getSession();
    if (session.tagFilterStatus) {
      tagFilterStatus = session.tagFilterStatus;
    }
    renderTagList();
    updateTagFilterButton();
  } catch (error) {
    console.error('Failed to restore tag filter from session:', error);
  }
}

// ファイルがタグフィルターに一致するかチェック
function fileMatchesTagFilter(file) {
  const showTags = Object.keys(tagFilterStatus).filter(tagId => tagFilterStatus[tagId] === 'show');
  const hideTags = Object.keys(tagFilterStatus).filter(tagId => tagFilterStatus[tagId] === 'hide');

  // フィルターが何も設定されていない場合は全て表示
  if (showTags.length === 0 && hideTags.length === 0) {
    return true;
  }

  // このファイルが持つタグ
  const fileTagIds = fileTags
    .filter(ft => ft.filePath === file.name)
    .map(ft => ft.tagId);

  // 非表示タグチェック（優先）
  if (hideTags.length > 0) {
    const hasHideTag = hideTags.some(tagId => fileTagIds.includes(tagId));
    if (hasHideTag) {
      return false;
    }
  }

  // 表示タグチェック
  if (showTags.length > 0) {
    const hasShowTag = showTags.some(tagId => fileTagIds.includes(tagId));
    return hasShowTag;
  }

  return true;
}

// ========================================
// タグダイアログ管理
// ========================================

let currentTagDialogFile = null; // 現在タグ編集中のファイル
let tagSearchQuery = ''; // タグ検索クエリ

// タグダイアログを開く
async function openTagDialog(file) {
  console.log('[openTagDialog] Opening for file:', file);
  currentTagDialogFile = file;

  // タグデータを再読み込み
  await loadTags();
  console.log('[openTagDialog] After loadTags, fileTags:', fileTags);

  // ダイアログを表示
  const dialog = document.getElementById('tag-dialog');
  dialog.classList.remove('hidden');

  // 検索ボックスをクリア
  const searchInput = document.getElementById('tag-search-input');
  searchInput.value = '';
  tagSearchQuery = '';

  // タグを描画
  renderTagFlowArea();
}

// タグフローエリアを描画
function renderTagFlowArea() {
  const flowArea = document.getElementById('tag-flow-area');
  flowArea.innerHTML = '';

  // 検索クエリでフィルタ
  const filteredTags = tags.filter(tag =>
    tag.name.toLowerCase().includes(tagSearchQuery.toLowerCase())
  );

  if (filteredTags.length === 0) {
    flowArea.innerHTML = '<div style="padding: 20px; text-align: center; color: #969696; font-size: 12px;">タグがありません</div>';
    return;
  }

  filteredTags.forEach((tag) => {
    const badge = document.createElement('div');
    badge.className = 'tag-badge-item';
    badge.dataset.tagId = tag.id;
    badge.textContent = tag.name;

    // 割り当て済みかチェック
    const isAssigned = isTagAssignedToFile(tag.id);
    if (isAssigned) {
      badge.classList.add('assigned');
      badge.style.backgroundColor = tag.color;
    }

    // 左クリック：トグル
    badge.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleTagAssignment(tag.id);
    });

    // 右クリック：編集メニュー
    badge.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[contextmenu] Tag:', tag.name);
      showTagEditMenu(e, tag);
    });

    flowArea.appendChild(badge);
  });
}

// タグがファイルに割り当てられているかチェック
function isTagAssignedToFile(tagId) {
  if (!currentTagDialogFile) return false;
  return fileTags.some(ft =>
    ft.filePath === currentTagDialogFile.name && ft.tagId === tagId
  );
}

// タグの割り当てをトグル
async function toggleTagAssignment(tagId) {
  const isAssigned = isTagAssignedToFile(tagId);
  if (isAssigned) {
    await unassignTagFromFile(tagId);
  } else {
    await assignTagToFile(tagId);
  }
}

// タグをファイルに割り当て
async function assignTagToFile(tagId) {
  if (!currentTagDialogFile) return;
  try {
    const result = await window.api.addFileTag(currentTagDialogFile.name, tagId);
    if (result.success) {
      await loadTags();
      renderTagFlowArea();
      displayFiles();
    }
  } catch (error) {
    console.error('Failed to assign tag:', error);
  }
}

// タグをファイルから解除
async function unassignTagFromFile(tagId) {
  if (!currentTagDialogFile) return;
  try {
    const result = await window.api.removeFileTag(currentTagDialogFile.name, tagId);
    if (result.success) {
      await loadTags();
      renderTagFlowArea();
      displayFiles();
    }
  } catch (error) {
    console.error('Failed to unassign tag:', error);
  }
}

// タグ名を更新
async function updateTagName(tagId, newName) {
  try {
    const result = await window.api.updateTag(tagId, { name: newName });
    if (result.success) {
      await loadTags();
      renderTagFlowArea();
      renderTagList();
      displayFiles();
    }
  } catch (error) {
    console.error('Failed to update tag name:', error);
  }
}

// タグの色を更新
async function updateTagColor(tagId, newColor) {
  try {
    const result = await window.api.updateTag(tagId, { color: newColor });
    if (result.success) {
      await loadTags();
      renderTagFlowArea();
      renderTagList();
      displayFiles();
    }
  } catch (error) {
    console.error('Failed to update tag color:', error);
  }
}

// タグを削除
async function deleteTag(tagId) {
  if (!confirm('このタグを削除しますか？')) return;
  try {
    const result = await window.api.deleteTag(tagId);
    if (result.success) {
      await loadTags();
      renderTagFlowArea();
      renderTagList();
      displayFiles();
    }
  } catch (error) {
    console.error('Failed to delete tag:', error);
  }
}

// 検索ボックスから新規タグ作成
async function createTagFromSearch(name) {
  const color = TAG_COLOR_PALETTE[Math.floor(Math.random() * TAG_COLOR_PALETTE.length)];

  try {
    const result = await window.api.createTag({
      name: name,
      color: color,
      order: tags.length
    });

    if (result.success) {
      await loadTags();
      renderTagFlowArea();
      renderTagList();
      document.getElementById('tag-search-input').value = '';
      tagSearchQuery = '';
    }
  } catch (error) {
    console.error('Failed to create tag:', error);
  }
}

// 編集中のタグID
let editingTagId = null;

// タグ編集メニューを表示（右クリック）
function showTagEditMenu(event, tag) {
  console.log('[showTagEditMenu] Called for tag:', tag.name);

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.position = 'fixed';
  menu.style.display = 'block';
  menu.style.zIndex = '10000';

  // 編集
  const editItem = document.createElement('div');
  editItem.className = 'context-menu-item';
  editItem.textContent = '編集';
  editItem.addEventListener('click', (e) => {
    e.stopPropagation();
    openEditTagDialog(tag);
    if (document.body.contains(menu)) {
      document.body.removeChild(menu);
    }
  });

  // 削除
  const deleteItem = document.createElement('div');
  deleteItem.className = 'context-menu-item danger';
  deleteItem.textContent = '削除';
  deleteItem.addEventListener('click', async (e) => {
    e.stopPropagation();
    await deleteTag(tag.id);
    if (document.body.contains(menu)) {
      document.body.removeChild(menu);
    }
  });

  menu.appendChild(editItem);
  menu.appendChild(deleteItem);

  document.body.appendChild(menu);

  // 位置を調整（画面外に出ないように）
  const menuRect = menu.getBoundingClientRect();
  let left = event.clientX;
  let top = event.clientY;

  if (left + menuRect.width > window.innerWidth) {
    left = window.innerWidth - menuRect.width - 10;
  }
  if (top + menuRect.height > window.innerHeight) {
    top = window.innerHeight - menuRect.height - 10;
  }

  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  console.log('[showTagEditMenu] Menu displayed at:', left, top);

  // メニュー外クリックで閉じる
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      if (document.body.contains(menu)) {
        document.body.removeChild(menu);
      }
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeMenu);
  }, 100);
}

// タグ編集ダイアログを開く
let selectedTagColor = null;

function openEditTagDialog(tag) {
  editingTagId = tag.id;
  selectedTagColor = tag.color;

  const dialog = document.getElementById('edit-tag-dialog');
  const nameInput = document.getElementById('edit-tag-name-input');
  const palette = document.getElementById('edit-tag-color-palette');
  const preview = document.getElementById('edit-tag-color-preview');

  nameInput.value = tag.name;
  preview.style.backgroundColor = tag.color;
  preview.textContent = tag.name;

  // カラーパレットを生成
  palette.innerHTML = '';
  TAG_COLOR_PALETTE.forEach(color => {
    const colorItem = document.createElement('div');
    colorItem.className = 'color-palette-item';
    colorItem.style.backgroundColor = color;
    if (color === selectedTagColor) {
      colorItem.classList.add('selected');
    }

    colorItem.addEventListener('click', () => {
      selectedTagColor = color;
      preview.style.backgroundColor = color;

      // 全ての選択状態をリセット
      palette.querySelectorAll('.color-palette-item').forEach(item => {
        item.classList.remove('selected');
      });
      colorItem.classList.add('selected');
    });

    palette.appendChild(colorItem);
  });

  dialog.classList.remove('hidden');
  nameInput.focus();
  nameInput.select();
}

// タグ編集を保存
async function saveEditTag() {
  const nameInput = document.getElementById('edit-tag-name-input');
  const newName = nameInput.value.trim();

  if (newName && editingTagId && selectedTagColor) {
    await updateTagName(editingTagId, newName);
    await updateTagColor(editingTagId, selectedTagColor);
  }

  closeEditTagDialog();
}

// タグ編集ダイアログを閉じる
function closeEditTagDialog() {
  const dialog = document.getElementById('edit-tag-dialog');
  dialog.classList.add('hidden');
  editingTagId = null;

  // 設定画面のタグリストを更新
  const settingsDialog = document.getElementById('settings-dialog');
  if (!settingsDialog.classList.contains('hidden')) {
    renderSettingsTagList();
  }
}

// タグダイアログを閉じる
function closeTagDialog() {
  const dialog = document.getElementById('tag-dialog');
  dialog.classList.add('hidden');
  currentTagDialogFile = null;

  // タグバッジを更新
  updateCurrentFilePath();
}

// ========================
// 表編集機能
// ========================

let tableEditorData = {
  headers: [],
  rows: [],
  alignments: [],
  isEditMode: false,
  originalRange: null,
  selectedRow: -1,
  selectedCol: -1
};

// マークダウン表のパース
function parseMarkdownTable(markdown) {
  const lines = markdown.trim().split('\n').filter(line => line.trim());

  if (lines.length < 2) {
    return null; // 最低2行必要（ヘッダー + 区切り行）
  }

  // ヘッダー行のパース
  const headerLine = lines[0].trim();
  const headers = headerLine.split('|')
    .map(cell => cell.trim())
    .filter((cell, index, arr) => {
      // 最初と最後の空要素を除外
      return !(index === 0 && cell === '') && !(index === arr.length - 1 && cell === '');
    })
    .map(cell => cell.replace(/<br>/g, '\n')); // <br>を改行に変換

  // 区切り行のパース（配置情報）
  const separatorLine = lines[1].trim();
  const separators = separatorLine.split('|')
    .map(cell => cell.trim())
    .filter((cell, index, arr) => {
      return !(index === 0 && cell === '') && !(index === arr.length - 1 && cell === '');
    });

  const alignments = separators.map(sep => {
    if (sep.startsWith(':') && sep.endsWith(':')) {
      return 'center';
    } else if (sep.endsWith(':')) {
      return 'right';
    } else {
      return 'left';
    }
  });

  // データ行のパース
  const rows = [];
  for (let i = 2; i < lines.length; i++) {
    const rowLine = lines[i].trim();
    const cells = rowLine.split('|')
      .map(cell => cell.trim())
      .filter((cell, index, arr) => {
        return !(index === 0 && cell === '') && !(index === arr.length - 1 && cell === '');
      })
      .map(cell => cell.replace(/<br>/g, '\n')); // <br>を改行に変換

    rows.push(cells);
  }

  return {
    headers,
    rows,
    alignments
  };
}

// マークダウン表の生成
function generateMarkdownTable() {
  const { headers, rows, alignments } = tableEditorData;

  // ヘッダー行
  const headerCells = headers.map(h => h.replace(/\n/g, '<br>')); // 改行を<br>に変換
  const headerLine = '| ' + headerCells.join(' | ') + ' |';

  // 区切り行
  const separators = alignments.map(align => {
    switch (align) {
      case 'center': return ':---:';
      case 'right': return '---:';
      default: return '---';
    }
  });
  const separatorLine = '| ' + separators.join(' | ') + ' |';

  // データ行
  const dataLines = rows.map(row => {
    const cells = row.map(cell => (cell || '').replace(/\n/g, '<br>')); // 改行を<br>に変換
    return '| ' + cells.join(' | ') + ' |';
  });

  return [headerLine, separatorLine, ...dataLines].join('\n');
}

// 編集UIの構築
function buildTableEditor() {
  const { headers, rows, alignments } = tableEditorData;
  const tableArea = document.getElementById('table-editor-area');

  // テーブル要素の作成
  const table = document.createElement('table');
  table.className = 'editable-table';

  // ヘッダー行
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headers.forEach((header, colIndex) => {
    const th = document.createElement('th');
    th.contentEditable = 'true';
    th.innerHTML = header.replace(/\n/g, '<br>');
    th.dataset.col = colIndex;

    // セルクリックで列選択
    th.addEventListener('click', () => selectColumn(colIndex));

    // Enterキーで<br>を挿入
    th.addEventListener('keydown', handleCellKeydown);

    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  // 配置ボタン行
  const alignmentRow = document.createElement('tr');
  alignmentRow.className = 'alignment-row';
  alignments.forEach((align, colIndex) => {
    const td = document.createElement('td');
    td.dataset.col = colIndex;

    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'alignment-buttons';

    ['left', 'center', 'right'].forEach(alignment => {
      const btn = document.createElement('button');
      btn.className = 'alignment-btn' + (align === alignment ? ' active' : '');
      btn.textContent = alignment === 'left' ? '◀' : alignment === 'center' ? '■' : '▶';
      btn.dataset.alignment = alignment;
      btn.addEventListener('click', () => setColumnAlignment(colIndex, alignment));
      buttonsDiv.appendChild(btn);
    });

    td.appendChild(buttonsDiv);
    alignmentRow.appendChild(td);
  });
  thead.appendChild(alignmentRow);
  table.appendChild(thead);

  // データ行
  const tbody = document.createElement('tbody');
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement('tr');
    tr.dataset.row = rowIndex;

    row.forEach((cell, colIndex) => {
      const td = document.createElement('td');
      td.contentEditable = 'true';
      td.innerHTML = (cell || '').replace(/\n/g, '<br>');
      td.dataset.row = rowIndex;
      td.dataset.col = colIndex;

      // セルクリックで行選択
      td.addEventListener('click', () => selectCell(rowIndex, colIndex));

      // Enterキーで<br>を挿入
      td.addEventListener('keydown', handleCellKeydown);

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  tableArea.innerHTML = '';
  tableArea.appendChild(table);
}

// セル内でのEnterキー処理
function handleCellKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();

    // 選択範囲を取得
    const selection = window.getSelection();
    const range = selection.getRangeAt(0);

    // <br>要素を挿入
    const br = document.createElement('br');
    range.deleteContents();
    range.insertNode(br);

    // カーソルを<br>の後ろに移動
    range.setStartAfter(br);
    range.setEndAfter(br);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

// 列の配置を設定
function setColumnAlignment(colIndex, alignment) {
  tableEditorData.alignments[colIndex] = alignment;

  // UIを更新
  const alignmentRow = document.querySelector('.alignment-row');
  const alignmentCell = alignmentRow.children[colIndex];
  const buttons = alignmentCell.querySelectorAll('.alignment-btn');

  buttons.forEach(btn => {
    if (btn.dataset.alignment === alignment) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// セルを選択
function selectCell(rowIndex, colIndex) {
  tableEditorData.selectedRow = rowIndex;
  tableEditorData.selectedCol = colIndex;

  // 既存のハイライトを削除
  document.querySelectorAll('.selected-row').forEach(el => el.classList.remove('selected-row'));
  document.querySelectorAll('.selected-col').forEach(el => el.classList.remove('selected-col'));

  // 行をハイライト
  const rows = document.querySelectorAll('.editable-table tbody tr');
  if (rows[rowIndex]) {
    rows[rowIndex].classList.add('selected-row');
  }

  // 列をハイライト
  document.querySelectorAll(`[data-col="${colIndex}"]`).forEach(el => {
    if (el.tagName === 'TH' || el.tagName === 'TD') {
      el.classList.add('selected-col');
    }
  });
}

// 列を選択
function selectColumn(colIndex) {
  tableEditorData.selectedCol = colIndex;
  tableEditorData.selectedRow = -1;

  // 既存のハイライトを削除
  document.querySelectorAll('.selected-row').forEach(el => el.classList.remove('selected-row'));
  document.querySelectorAll('.selected-col').forEach(el => el.classList.remove('selected-col'));

  // 列をハイライト
  document.querySelectorAll(`[data-col="${colIndex}"]`).forEach(el => {
    if (el.tagName === 'TH' || el.tagName === 'TD') {
      el.classList.add('selected-col');
    }
  });
}

// 上に行を追加
function addRowAbove() {
  const { selectedRow } = tableEditorData;
  if (selectedRow < 0) {
    alert('行を選択してください');
    return;
  }

  const newRow = new Array(tableEditorData.headers.length).fill('');
  tableEditorData.rows.splice(selectedRow, 0, newRow);

  buildTableEditor();
  selectCell(selectedRow, tableEditorData.selectedCol);
}

// 下に行を追加
function addRowBelow() {
  const { selectedRow } = tableEditorData;
  if (selectedRow < 0) {
    alert('行を選択してください');
    return;
  }

  const newRow = new Array(tableEditorData.headers.length).fill('');
  tableEditorData.rows.splice(selectedRow + 1, 0, newRow);

  buildTableEditor();
  selectCell(selectedRow + 1, tableEditorData.selectedCol);
}

// 行を削除
function deleteRow() {
  const { selectedRow } = tableEditorData;
  if (selectedRow < 0) {
    alert('行を選択してください');
    return;
  }

  if (tableEditorData.rows.length <= 1) {
    alert('最低1行は必要です');
    return;
  }

  tableEditorData.rows.splice(selectedRow, 1);

  const newSelectedRow = Math.min(selectedRow, tableEditorData.rows.length - 1);
  buildTableEditor();
  selectCell(newSelectedRow, tableEditorData.selectedCol);
}

// 左に列を追加
function addColumnLeft() {
  const { selectedCol } = tableEditorData;
  if (selectedCol < 0) {
    alert('列を選択してください');
    return;
  }

  tableEditorData.headers.splice(selectedCol, 0, '');
  tableEditorData.alignments.splice(selectedCol, 0, 'left');
  tableEditorData.rows.forEach(row => row.splice(selectedCol, 0, ''));

  buildTableEditor();
  selectColumn(selectedCol);
}

// 右に列を追加
function addColumnRight() {
  const { selectedCol } = tableEditorData;
  if (selectedCol < 0) {
    alert('列を選択してください');
    return;
  }

  tableEditorData.headers.splice(selectedCol + 1, 0, '');
  tableEditorData.alignments.splice(selectedCol + 1, 0, 'left');
  tableEditorData.rows.forEach(row => row.splice(selectedCol + 1, 0, ''));

  buildTableEditor();
  selectColumn(selectedCol + 1);
}

// 列を削除
function deleteColumn() {
  const { selectedCol } = tableEditorData;
  if (selectedCol < 0) {
    alert('列を選択してください');
    return;
  }

  if (tableEditorData.headers.length <= 2) {
    alert('最低2列は必要です');
    return;
  }

  tableEditorData.headers.splice(selectedCol, 1);
  tableEditorData.alignments.splice(selectedCol, 1);
  tableEditorData.rows.forEach(row => row.splice(selectedCol, 1));

  const newSelectedCol = Math.min(selectedCol, tableEditorData.headers.length - 1);
  buildTableEditor();
  selectColumn(newSelectedCol);
}

// UIからデータを更新
function updateTableDataFromUI() {
  // ヘッダー
  const headerCells = document.querySelectorAll('.editable-table thead tr:first-child th');
  tableEditorData.headers = Array.from(headerCells).map(th => {
    // innerHTMLから<br>を改行に変換、末尾の改行を削除
    return th.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/\n+$/, '');
  });

  // データ行
  const dataRows = document.querySelectorAll('.editable-table tbody tr');
  tableEditorData.rows = Array.from(dataRows).map(tr => {
    const cells = tr.querySelectorAll('td');
    return Array.from(cells).map(td => {
      // innerHTMLから<br>を改行に変換、末尾の改行を削除
      return td.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/\n+$/, '');
    });
  });
}

// カーソル位置の表を検出
function detectTableAtCursor(editor) {
  const cursor = editor.getCursorPosition();
  const currentLine = editor.session.getLine(cursor.row);

  // 現在行が表の一部かチェック
  if (!currentLine.trim().startsWith('|')) {
    return null;
  }

  // 表の開始行を探す
  let startRow = cursor.row;
  while (startRow > 0) {
    const line = editor.session.getLine(startRow - 1);
    if (!line.trim().startsWith('|')) {
      break;
    }
    startRow--;
  }

  // 表の終了行を探す
  let endRow = cursor.row;
  const totalLines = editor.session.getLength();
  while (endRow < totalLines - 1) {
    const line = editor.session.getLine(endRow + 1);
    if (!line.trim().startsWith('|')) {
      break;
    }
    endRow++;
  }

  // 表のテキストを取得
  const lines = [];
  for (let i = startRow; i <= endRow; i++) {
    lines.push(editor.session.getLine(i));
  }

  return {
    markdown: lines.join('\n'),
    startRow,
    endRow
  };
}

// 表編集ダイアログを開く（新規追加）
function openTableEditorForNew() {
  // デフォルトの3列x3行の表
  tableEditorData = {
    headers: ['', '', ''],
    rows: [
      ['', '', ''],
      ['', '', '']
    ],
    alignments: ['left', 'left', 'left'],
    isEditMode: false,
    originalRange: null,
    selectedRow: 0,
    selectedCol: 0
  };

  const dialog = document.getElementById('table-editor-dialog');
  dialog.classList.remove('hidden');

  buildTableEditor();
  selectCell(0, 0);
}

// 表編集ダイアログを開く（編集）
function openTableEditorForEdit(editor) {
  const tableInfo = detectTableAtCursor(editor);
  if (!tableInfo) {
    alert('カーソル位置に表が見つかりません');
    return;
  }

  const parsedTable = parseMarkdownTable(tableInfo.markdown);
  if (!parsedTable) {
    alert('表の形式が正しくありません');
    return;
  }

  tableEditorData = {
    ...parsedTable,
    isEditMode: true,
    originalRange: {
      startRow: tableInfo.startRow,
      endRow: tableInfo.endRow
    },
    selectedRow: 0,
    selectedCol: 0
  };

  const dialog = document.getElementById('table-editor-dialog');
  dialog.classList.remove('hidden');

  buildTableEditor();
  selectCell(0, 0);
}

// 表を保存
function saveTable() {
  const activeTab = tabManager.getActiveTab();
  if (!activeTab || !editors[activeTab.id]) {
    return;
  }

  const editor = editors[activeTab.id];

  // UIからデータを更新
  updateTableDataFromUI();

  // マークダウンを生成
  const markdown = generateMarkdownTable();

  if (tableEditorData.isEditMode) {
    // 編集モード：既存の表を置換
    const { startRow, endRow } = tableEditorData.originalRange;
    const range = new ace.Range(startRow, 0, endRow, editor.session.getLine(endRow).length);
    editor.session.replace(range, markdown);
  } else {
    // 新規追加モード：カーソル位置に挿入
    const cursor = editor.getCursorPosition();
    editor.session.insert(cursor, '\n' + markdown + '\n');
  }

  closeTableEditor();
}

// 表編集ダイアログを閉じる
function closeTableEditor() {
  const dialog = document.getElementById('table-editor-dialog');
  dialog.classList.add('hidden');

  tableEditorData = {
    headers: [],
    rows: [],
    alignments: [],
    isEditMode: false,
    originalRange: null,
    selectedRow: -1,
    selectedCol: -1
  };
}

