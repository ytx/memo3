let editors = {}; // エディタインスタンスを管理
let tabs = []; // タブ管理
let activeTabId = null;
let files = [];
let rootFolder = null;
let autoSaveTimers = {}; // 自動保存タイマー管理
let lastOpenedFromFileList = null; // ファイル一覧から最後に開いたタブ
let editorInteractions = {}; // エディタとのユーザーインタラクション追跡
let settings = {
  keybinding: '',
  theme: 'ace/theme/monokai',
  themePreset2: 'ace/theme/github',
  fontSize: 14,
  wordWrap: true,
  showLineNumbers: true,
  showInvisibles: false,
  themeIndex: 0
};

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
      
      // タブを復元
      for (const tabData of session.openTabs) {
        if (tabData.filePath && files.find(f => f.path === tabData.filePath)) {
          const file = files.find(f => f.path === tabData.filePath);
          const tabId = this.createTab(file);
          
          // ファイルを読み込んでエディタに設定
          const result = await window.api.loadFile(file.path);
          if (result.success && editors[tabId]) {
            editors[tabId].setValue(result.content, -1);
            // 初期タイトルを設定
            tabManager.updateTabTitle(tabId, result.content || '');
          }
        }
      }
      
      // アクティブタブを復元
      if (session.activeTabId && this.tabs.find(t => t.file && files.find(f => f.path === session.openTabs.find(o => o.id === session.activeTabId)?.filePath))) {
        const activeTabData = session.openTabs.find(t => t.id === session.activeTabId);
        if (activeTabData && activeTabData.filePath) {
          const activeTab = this.tabs.find(t => t.file && t.file.path === activeTabData.filePath);
          if (activeTab) {
            this.switchToTab(activeTab.id);
          }
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
  editor.setTheme(settings.theme);
  editor.session.setMode("ace/mode/markdown");
  editor.setFontSize(settings.fontSize);
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
  
  // 全ファイルを表示
  const filteredFiles = files;
  
  filteredFiles.forEach(file => {
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    
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
  const activeTab = tabManager.getActiveTab();
  
  if (activeTab && activeTab.file) {
    filePathElement.textContent = activeTab.file.relativePath || activeTab.file.name;
  } else {
    filePathElement.textContent = 'ファイルが選択されていません';
  }
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
async function saveFile(tabId = null) {
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
      if (!tabId) showStatus('保存しました'); // 手動保存時のみメッセージ表示
      
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
    if (tab && tab.isModified && tab.file) {
      const success = await saveFile(tabId);
      if (success) {
        console.log(`自動保存: ${tab.file.name}`);
      }
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
  
  if (results.length === 0) {
    searchResults.innerHTML = '<div style="padding: 20px; color: #969696; text-align: center;">検索結果が見つかりませんでした</div>';
    return;
  }
  
  // 重複を除去してファイルリスト形式で表示
  const uniqueFiles = new Map();
  
  results.forEach(result => {
    if (!uniqueFiles.has(result.file.path)) {
      uniqueFiles.set(result.file.path, result.file);
    }
  });
  
  Array.from(uniqueFiles.values()).forEach(file => {
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    
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
    
    searchResults.appendChild(fileItem);
  });
}

// 検索結果からファイルを開く
async function openFileFromSearch(file) {
  // 検索結果はそのままにしてファイルを開く
  await openFileInTab(file);
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
  const theme1 = document.getElementById('theme-select').value;
  const theme2 = settings.themePreset2;

  // テーマ1とテーマ2を切り替え
  if (settings.theme === theme2) {
    // 現在テーマ2なら、テーマ1に戻す
    settings.theme = theme1;
    settings.themeIndex = 0;
  } else {
    // 現在テーマ1なら、テーマ2に切り替え
    settings.theme = theme2;
    settings.themeIndex = 1;
  }

  // 全てのエディタに適用
  Object.values(editors).forEach(editor => {
    editor.setTheme(settings.theme);
  });

  // アプリのテーマも更新
  updateAppTheme(settings.theme);

  // 設定を保存
  await window.api.saveSettings(settings);

  const themeName = settings.theme.split('/').pop().replace('_', ' ');
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
    }
  );
  
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
      
      menuItem.addEventListener('click', item.action);
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

// ステータス表示
function showStatus(message) {
  const statusText = document.getElementById('status-text');
  statusText.textContent = message;
  setTimeout(() => {
    statusText.textContent = 'Ready';
  }, 2000);
}

// 設定ダイアログの表示
function showSettings() {
  const dialog = document.getElementById('settings-dialog');
  dialog.classList.remove('hidden');
  
  // 現在の設定を反映
  document.getElementById('current-folder-display').value = rootFolder || '';
  document.getElementById('keybinding-select').value = settings.keybinding || '';
  document.getElementById('theme-select').value = settings.theme;
  document.getElementById('theme-preset2').value = settings.themePreset2;
  document.getElementById('font-size').value = settings.fontSize;
  document.getElementById('word-wrap').checked = settings.wordWrap;
  document.getElementById('show-line-numbers').checked = settings.showLineNumbers;
}

// 設定ダイアログを閉じる
function hideSettings() {
  const dialog = document.getElementById('settings-dialog');
  dialog.classList.add('hidden');
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
  settings.wordWrap = document.getElementById('word-wrap').checked;
  settings.showLineNumbers = document.getElementById('show-line-numbers').checked;
  
  // 全エディタに設定を適用
  Object.values(editors).forEach(editor => {
    editor.setTheme(settings.theme);
    editor.setFontSize(settings.fontSize);
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
  updateAppTheme(settings.theme);
  
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

  // アプリ全体のテーマを適用
  updateAppTheme(settings.theme);

  // 空白文字表示ボタンの初期状態を設定
  const whitespaceButton = document.getElementById('toggle-whitespace-btn');
  whitespaceButton.style.backgroundColor = settings.showInvisibles ? '#007acc' : 'transparent';
  
  // ファイルとルートフォルダの読み込み
  files = await window.api.getFiles();
  rootFolder = await window.api.getRootFolder();
  
  updateRootFolderPath();
  displayFiles();
  updateFileStatus();
  updateCurrentFilePath();
  
  // セッションを復元
  await tabManager.restoreSession();
}

// イベントリスナーの設定
document.addEventListener('DOMContentLoaded', () => {
  init();
  
  // ボタンのイベント
  // document.getElementById('new-file-btn').addEventListener('click', createNewFile); // 削除済み
  document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);
  document.getElementById('toggle-whitespace-btn').addEventListener('click', toggleWhitespace);
  document.getElementById('font-increase-btn').addEventListener('click', increaseFontSize);
  document.getElementById('font-decrease-btn').addEventListener('click', decreaseFontSize);
  document.getElementById('new-tab-btn').addEventListener('click', () => {
    // 新しいタブを作成して新規ファイルとする
    createNewTabWithFile();
  });
  
  
  document.getElementById('settings-btn').addEventListener('click', showSettings);
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  document.getElementById('cancel-settings-btn').addEventListener('click', hideSettings);
  
  // フォルダ選択ボタン
  document.getElementById('folder-select-btn').addEventListener('click', async () => {
    const result = await window.api.selectFolder();
    if (result.success) {
      rootFolder = result.folderPath;
      document.getElementById('current-folder-display').value = rootFolder;
      updateRootFolderPath();
      files = await window.api.getFiles();
      displayFiles();
      showStatus('フォルダを選択しました');
    }
  });
  
  // 検索ボックス
  document.getElementById('search-input').addEventListener('input', searchFiles);
  document.getElementById('clear-search-btn').addEventListener('click', clearSearch);
  
  // コンテキストメニュー
  document.getElementById('context-rename').addEventListener('click', renameFileFromContext);
  document.getElementById('context-delete').addEventListener('click', deleteFileFromContext);
  
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
window.api.onNewMemo(() => createNewFile()); // 互換性のため
window.api.onSaveMemo(() => saveFile()); // 互換性のため
window.api.onOpenSettings(() => showSettings());

// ファイル更新イベントの処理
window.api.onFilesUpdated(async (_, updatedFiles) => {
  files = updatedFiles;
  displayFiles();
  showStatus('ファイルリストを更新しました');
});