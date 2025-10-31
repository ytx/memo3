const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const chokidar = require('chokidar');

// アプリケーション名を最初に設定
app.setName('memo3');

// macOS固有の設定
if (process.platform === 'darwin') {
  // 入力メソッド関連のエラーを抑制するための設定
  app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

let mainWindow;
let previewWindow = null;
let memos = [];
let rootFolder = null;
let fileWatcher = null;
let files = [];
let workspaces = [];
let activeWorkspace = null;
const MEMOS_FILE = path.join(app.getPath('userData'), 'memos.json');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const WORKSPACE_FILE = path.join(app.getPath('userData'), 'workspace.json');
const SESSIONS_FILE = path.join(app.getPath('userData'), 'sessions.json');
const SESSION_FILE = path.join(app.getPath('userData'), 'session.json'); // 旧形式（マイグレーション用）

async function loadMemos() {
  try {
    const data = await fs.readFile(MEMOS_FILE, 'utf8');
    memos = JSON.parse(data);
  } catch (error) {
    memos = [];
  }
}

async function saveMemos() {
  try {
    await fs.writeFile(MEMOS_FILE, JSON.stringify(memos, null, 2));
  } catch (error) {
    console.error('Failed to save memos:', error);
  }
}

async function loadSettings() {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {
      keybinding: 'ace/keyboard/vim',
      theme: 'ace/theme/monokai',
      fontSize: 14,
      wordWrap: true,
      showLineNumbers: true,
      showInvisibles: false
    };
  }
}

async function saveSettings(settings) {
  try {
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    return true;
  } catch (error) {
    console.error('Failed to save settings:', error);
    return false;
  }
}

async function loadWorkspaces() {
  try {
    const data = await fs.readFile(WORKSPACE_FILE, 'utf8');
    const workspaceData = JSON.parse(data);

    // 旧形式からのマイグレーション
    if (workspaceData.rootFolder && !workspaceData.version) {
      console.log('Migrating workspace.json from old format to new format');
      const oldRootFolder = workspaceData.rootFolder;
      const folderName = path.basename(oldRootFolder);

      workspaces = [{
        path: oldRootFolder,
        name: folderName,
        lastAccessed: new Date().toISOString()
      }];
      activeWorkspace = oldRootFolder;

      await saveWorkspaces();

      // 旧session.jsonがあれば、sessions.jsonに移行
      await migrateSessions();
    } else if (workspaceData.version === '2.0') {
      // 新形式
      workspaces = workspaceData.workspaces || [];
      activeWorkspace = workspaceData.activeWorkspace || null;
    } else {
      // 空または不明な形式
      workspaces = [];
      activeWorkspace = null;
    }

    // アクティブワークスペースが設定されている場合、rootFolderを設定
    if (activeWorkspace) {
      rootFolder = activeWorkspace;
      await scanFiles();
      setupFileWatcher();
    }
  } catch (error) {
    // workspace.jsonが存在しない場合は初回起動とみなす
    console.log('workspace.json not found, initializing first-time setup');
    await firstTimeSetup();
  }
}

async function saveWorkspaces() {
  try {
    const workspaceData = {
      version: '2.0',
      workspaces: workspaces,
      activeWorkspace: activeWorkspace
    };
    await fs.writeFile(WORKSPACE_FILE, JSON.stringify(workspaceData, null, 2));
  } catch (error) {
    console.error('Failed to save workspaces:', error);
  }
}

async function loadSessions() {
  try {
    const data = await fs.readFile(SESSIONS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

async function saveSessions(sessions) {
  try {
    await fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  } catch (error) {
    console.error('Failed to save sessions:', error);
  }
}

async function getWorkspaceSession(workspacePath) {
  const sessions = await loadSessions();
  return sessions[workspacePath] || {
    openTabs: [],
    activeTabId: null
  };
}

async function saveWorkspaceSession(workspacePath, session) {
  const sessions = await loadSessions();
  sessions[workspacePath] = session;
  await saveSessions(sessions);
}

async function migrateSessions() {
  try {
    // 旧session.jsonがあるか確認
    const oldSessionData = await fs.readFile(SESSION_FILE, 'utf8');
    const oldSession = JSON.parse(oldSessionData);

    // activeWorkspaceに対応するセッションとして保存
    if (activeWorkspace) {
      const sessions = {};
      sessions[activeWorkspace] = oldSession;
      await saveSessions(sessions);
      console.log('Migrated session.json to sessions.json');
    }
  } catch (error) {
    // 旧session.jsonがない場合は何もしない
  }
}

async function firstTimeSetup() {
  try {
    // ドキュメントフォルダにmemo3フォルダを作成
    const documentsPath = app.getPath('documents');
    const memo3Folder = path.join(documentsPath, 'memo3');

    // フォルダが存在しない場合のみ作成
    try {
      await fs.access(memo3Folder);
    } catch {
      await fs.mkdir(memo3Folder, { recursive: true });
      console.log('Created memo3 folder:', memo3Folder);
    }

    // 初期ファイルを作成
    const initialFiles = {
      '概要.md': `# memo3へようこそ

memo3はシンプルで高速なマークダウンメモアプリケーションです。

## 主な機能

- **マルチタブエディタ**: 複数のファイルを同時に開いて編集
- **リアルタイムファイル監視**: 外部エディタでの変更を自動検出
- **複数ワークスペース対応**: プロジェクトごとにフォルダを切り替え
- **高速検索**: ファイル名と内容を横断検索
- **テーマカスタマイズ**: 7種類以上のエディタテーマから選択
- **Emacsキーバインド対応**: Vim、Emacsなど複数のキーバインドをサポート
- **自動保存**: 編集後5秒で自動保存（IME対応）
- **セッション復元**: アプリ再起動時に前回のタブを復元
- **マークダウンプレビュー**: 別ウィンドウでリアルタイムプレビュー

## ワークスペースについて

画面左上のプルダウンから、複数のフォルダ（ワークスペース）を切り替えることができます。
各ワークスペースは独立したセッションを持ち、開いているタブの状態が保存されます。

新しいワークスペースを追加するには、+ボタンをクリックしてフォルダを選択してください。
`,

      '操作説明.md': `# 操作マニュアル

## 基本操作

### ファイル管理

- **新しいファイルを作成**: 右上の + ボタンをクリック
  - 2行以上入力すると自動的にファイルが作成されます
  - ファイル名は最初の行から自動生成されます

- **ファイルを開く**: 左側のファイルリストからクリック

- **ファイルを検索**: 左側の検索ボックスに入力
  - ファイル名と内容の両方を検索できます

- **ファイルを削除**: ファイルリストでファイルを右クリック → 「削除」

- **ファイル名を更新**: ファイルリストでファイルを右クリック → 「ファイル名更新」
  - ファイルの最初の行に基づいて自動的にファイル名が更新されます

### タブ操作

- **タブを閉じる**: タブの × ボタンをクリック
- **タブを並べ替え**: タブをドラッグ＆ドロップ
- **タブをスクロール**: タブバーの左右の ‹ › ボタンをクリック

### エディタ機能

- **自動保存**: 編集後5秒で自動的に保存されます
- **フォントサイズ変更**: 右下の A- / A+ ボタン
- **テーマ切り替え**: 右下の 🎨 ボタン（設定で2つのテーマを登録可能）
- **空白文字表示**: 右下の ¶ ボタン
- **マークダウンプレビュー**: 右下の 👁 ボタン

### 右クリックメニュー

エディタ上で右クリックすると、以下の機能が使えます：

- **URLを開く**: URLを選択して右クリック → 「URLを開く」
- **Googleで検索**: テキストを選択して右クリック → 「Googleで検索」
- **箇条書きにする**: 複数行を選択して右クリック → 「箇条書き(-)にする」
- **箇条書きをやめる**: 箇条書き行を選択して右クリック → 「箇条書きをやめる」

### ワークスペース管理

- **ワークスペースを切り替え**: 左上のプルダウンから選択
- **ワークスペースを追加**: 左上の + ボタンをクリック
- **ワークスペースを解除**: プルダウンでワークスペース名を右クリック → 「解除」

## キーボードショートカット

### macOS

- **設定を開く**: Cmd + ,
- **新しいファイル**: Cmd + N
- **保存**: Cmd + S（通常は自動保存されます）
- **フォルダを開く**: Cmd + O

### Windows / Linux

- **設定を開く**: Ctrl + ,
- **新しいファイル**: Ctrl + N
- **保存**: Ctrl + S
- **フォルダを開く**: Ctrl + O

## 設定

設定画面では以下の項目をカスタマイズできます：

- **キーバインド**: Vim、Emacs、標準から選択
- **テーマ1・テーマ2**: 2つのテーマを登録して 🎨 ボタンで切り替え
- **フォントサイズ**: 8〜32pxの範囲で設定
- **行番号表示**: オン/オフ
- **ワードラップ**: オン/オフ
- **空白文字表示**: オン/オフ

## トラブルシューティング

### ファイルが表示されない

- ワークスペースフォルダが正しく設定されているか確認してください
- .md または .txt ファイルのみが表示されます
- 隠しファイル（.で始まるファイル）は表示されません

### 自動保存が動作しない

- 日本語入力（IME）中は自動保存が一時停止します
- 変換を確定すると自動保存が再開されます

### タブが復元されない

- ファイルが削除されている場合、そのタブは復元されません
- ワークスペースごとにセッションが保存されます
`,

      'サンプル.md': `# サンプル文書

これはmemo3のサンプル文書です。

## Markdownの書き方

### 見出し

# 見出し1
## 見出し2
### 見出し3

### 強調

**太字**
*イタリック*
~~取り消し線~~

### リスト

- 箇条書き1
- 箇条書き2
  - ネストした項目
  - ネストした項目

1. 番号付きリスト
2. 番号付きリスト
3. 番号付きリスト

### リンク

[Googleへのリンク](https://www.google.com)

### コードブロック

\`\`\`javascript
function hello() {
  console.log('Hello, memo3!');
}
\`\`\`

### 引用

> これは引用です。
> 複数行にわたって引用できます。

### 水平線

---

### テーブル

| 列1 | 列2 | 列3 |
|-----|-----|-----|
| A   | B   | C   |
| D   | E   | F   |

## メモの活用例

### プロジェクト管理

- [ ] タスク1
- [x] タスク2（完了）
- [ ] タスク3

### アイデアメモ

思いついたアイデアをすぐにメモ。
タグをつけて整理することもできます。

#アイデア #メモ #マークダウン

### 学習ノート

学んだことをまとめておけば、後で検索して簡単に見つけられます。

memo3の検索機能を使えば、すべてのファイルから一瞬で情報を探せます。
`
    };

    // 初期ファイルを作成（既に存在する場合は上書きしない）
    for (const [fileName, content] of Object.entries(initialFiles)) {
      const filePath = path.join(memo3Folder, fileName);
      try {
        await fs.access(filePath);
        // ファイルが既に存在する場合はスキップ
      } catch {
        await fs.writeFile(filePath, content, 'utf8');
        console.log('Created initial file:', fileName);
      }
    }

    // ワークスペースを設定
    workspaces = [{
      path: memo3Folder,
      name: 'memo3',
      lastAccessed: new Date().toISOString()
    }];
    activeWorkspace = memo3Folder;
    rootFolder = memo3Folder;

    await saveWorkspaces();
    await scanFiles();
    setupFileWatcher();

    console.log('First-time setup completed');
  } catch (error) {
    console.error('Failed to complete first-time setup:', error);
  }
}

async function scanFiles() {
  if (!rootFolder) {
    files = [];
    return;
  }
  
  try {
    const allFiles = [];
    
    async function walkDir(dir, relativePath = '') {
      const items = await fs.readdir(dir);
      
      for (const item of items) {
        // 一時ファイルやバックアップファイルを除外
        if (item.startsWith('.') || item.endsWith('~') || item.includes('.swp') || item.includes('.tmp')) {
          continue;
        }

        const fullPath = path.join(dir, item);
        const relativeItemPath = path.join(relativePath, item);

        let stats;
        try {
          stats = await fs.stat(fullPath);
        } catch (error) {
          // ファイルが存在しない場合（削除された、アクセスできないなど）はスキップ
          console.log(`Skipping inaccessible file: ${fullPath}`);
          continue;
        }

        if (stats.isDirectory()) {
          await walkDir(fullPath, relativeItemPath);
        } else if (stats.isFile() && (item.endsWith('.md') || item.endsWith('.txt'))) {
          // ファイルの内容を読み込んでタイトルを取得
          let title = item;
          try {
            const content = await fs.readFile(fullPath, 'utf8');
            const lines = content.split('\n');
            for (let line of lines) {
              const trimmed = line.trim();
              if (trimmed) {
                // マークダウンのヘッダー記号を除去
                title = trimmed.replace(/^#+\s*/, '').substring(0, 50) || item;
                break;
              }
            }
          } catch (error) {
            // ファイル読み込みエラーの場合はファイル名をタイトルとする
          }
          
          allFiles.push({
            name: item,
            path: fullPath,
            relativePath: relativeItemPath,
            isDirectory: false,
            modifiedTime: stats.mtime,
            title: title
          });
        }
      }
    }
    
    await walkDir(rootFolder);
    // 更新日時の降順でソート
    allFiles.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
    files = allFiles;
    
    // Notify renderer of file changes
    if (mainWindow) {
      mainWindow.webContents.send('files-updated', files);
    }
  } catch (error) {
    console.error('Failed to scan files:', error);
    files = [];
  }
}

function setupFileWatcher() {
  if (fileWatcher) {
    fileWatcher.close();
  }

  if (!rootFolder) return;

  fileWatcher = chokidar.watch(rootFolder, {
    ignored: [
      /(^|[\/\\])\../,  // 隠しファイル
      /~$/,              // バックアップファイル
      /\.swp$/,          // Vimスワップファイル
      /\.tmp$/,          // 一時ファイル
      /\.DS_Store$/      // macOS システムファイル
    ],
    persistent: true,
    ignoreInitial: true
  });

  fileWatcher
    .on('add', () => scanFiles())
    .on('change', () => scanFiles())
    .on('unlink', () => scanFiles())
    .on('addDir', () => scanFiles())
    .on('unlinkDir', () => scanFiles());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'memo3',
    icon: path.join(__dirname, 'icon.icns')
  });

  mainWindow.loadFile('index.html');

  // タイトルバーの右クリックメニューを削除

  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory']
            });
            
            if (!result.canceled && result.filePaths.length > 0) {
              rootFolder = result.filePaths[0];
              await saveWorkspace();
              await scanFiles();
              setupFileWatcher();
            }
          }
        },
        { type: 'separator' },
        {
          label: 'New Memo',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow.webContents.send('new-memo');
          }
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            mainWindow.webContents.send('save-memo');
          }
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            mainWindow.webContents.send('open-settings');
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'Cmd+,',
          click: () => {
            mainWindow.webContents.send('open-settings');
          }
        },
        { type: 'separator' },
        { role: 'services', submenu: [] },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(async () => {
  await loadMemos();
  await loadWorkspaces();
  
  // macOS IMKエラー対策
  if (process.platform === 'darwin') {
    // IMKエラーを抑制
    process.on('uncaughtException', (error) => {
      if (error.message && error.message.includes('IMKCFRunLoopWakeUpReliable')) {
        // IMKエラーを無視してログのみ出力
        console.warn('IMK error suppressed:', error.message);
        return;
      }
      // その他のエラーは通常通り処理
      console.error('Uncaught exception:', error);
      process.exit(1);
    });
    
    // Dockアイコンを設定
    try {
      app.dock.setIcon(path.join(__dirname, 'app-icon.png'));
    } catch (error) {
      console.warn('Could not set dock icon:', error.message);
    }
  }
  
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // プラットフォームに関係なく、ウィンドウが全て閉じられたらアプリを終了
  app.quit();
});

// IPC handlers
ipcMain.handle('get-memos', () => {
  return memos;
});

ipcMain.handle('save-memo', async (event, memo) => {
  if (memo.id) {
    const index = memos.findIndex(m => m.id === memo.id);
    if (index !== -1) {
      memos[index] = { ...memo, updatedAt: new Date().toISOString() };
    }
  } else {
    memo.id = Date.now().toString();
    memo.createdAt = new Date().toISOString();
    memo.updatedAt = new Date().toISOString();
    memos.push(memo);
  }
  await saveMemos();
  return memos;
});

ipcMain.handle('delete-memo', async (event, id) => {
  memos = memos.filter(m => m.id !== id);
  await saveMemos();
  return memos;
});

ipcMain.handle('search-memos', (event, query) => {
  if (!query) return memos;
  const lowerQuery = query.toLowerCase();
  return memos.filter(memo => 
    memo.title.toLowerCase().includes(lowerQuery) || 
    memo.content.toLowerCase().includes(lowerQuery)
  );
});

ipcMain.handle('get-settings', async () => {
  return await loadSettings();
});

ipcMain.handle('save-settings', async (event, settings) => {
  return await saveSettings(settings);
});

// File-based management handlers
ipcMain.handle('get-files', () => {
  return files;
});

ipcMain.handle('get-root-folder', () => {
  return rootFolder;
});

ipcMain.handle('load-file', async (event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-file', async (event, filePath, content) => {
  try {
    await fs.writeFile(filePath, content, 'utf8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-file', async (event, fileName, content = '') => {
  if (!rootFolder) {
    return { success: false, error: 'No root folder selected' };
  }
  
  try {
    const filePath = path.join(rootFolder, fileName);
    await fs.writeFile(filePath, content, 'utf8');
    return { success: true, filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-file', async (event, filePath) => {
  try {
    await fs.unlink(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rename-file', async (event, oldPath, newPath) => {
  try {
    await fs.rename(oldPath, newPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('search-files-content', async (event, query) => {
  if (!query || !rootFolder) {
    return [];
  }
  
  try {
    const results = [];
    const lowerQuery = query.toLowerCase();
    
    for (const file of files) {
      const matches = [];
      
      // ファイル名での検索
      if (file.name.toLowerCase().includes(lowerQuery)) {
        matches.push({
          type: 'filename',
          text: file.name,
          line: 0
        });
      }
      
      // ファイル内容での検索
      try {
        const content = await fs.readFile(file.path, 'utf8');
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
          if (line.toLowerCase().includes(lowerQuery)) {
            matches.push({
              type: 'content',
              text: line.trim(),
              line: index + 1
            });
          }
        });
      } catch (error) {
        // ファイル読み込みエラーは無視
      }
      
      if (matches.length > 0) {
        results.push({
          file: file,
          matches: matches
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error('Search error:', error);
    return [];
  }
});

// Session management handlers
ipcMain.handle('get-session', async () => {
  if (activeWorkspace) {
    return await getWorkspaceSession(activeWorkspace);
  }
  return { openTabs: [], activeTabId: null };
});

ipcMain.handle('save-session', async (_, session) => {
  if (activeWorkspace) {
    await saveWorkspaceSession(activeWorkspace, session);
  }
});

// フォルダ選択（レガシー設定画面用）
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    rootFolder = result.filePaths[0];
    activeWorkspace = rootFolder;

    // ワークスペースリストに追加または更新
    const existingIndex = workspaces.findIndex(w => w.path === rootFolder);
    if (existingIndex >= 0) {
      workspaces[existingIndex].lastAccessed = new Date().toISOString();
    } else {
      const folderName = path.basename(rootFolder);
      workspaces.push({
        path: rootFolder,
        name: folderName,
        lastAccessed: new Date().toISOString()
      });
    }

    await saveWorkspaces();
    await scanFiles();
    setupFileWatcher();
    return { success: true, folderPath: rootFolder };
  }

  return { success: false };
});

// ワークスペース管理用IPC handlers
ipcMain.handle('get-workspaces', async () => {
  return {
    workspaces: workspaces.sort((a, b) =>
      new Date(b.lastAccessed) - new Date(a.lastAccessed)
    ),
    activeWorkspace: activeWorkspace
  };
});

ipcMain.handle('add-workspace', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'ワークスペースフォルダを選択'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];
    const folderName = path.basename(selectedPath);

    // 既に存在する場合は更新
    const existingIndex = workspaces.findIndex(w => w.path === selectedPath);
    if (existingIndex >= 0) {
      workspaces[existingIndex].lastAccessed = new Date().toISOString();
    } else {
      // 新規追加
      workspaces.push({
        path: selectedPath,
        name: folderName,
        lastAccessed: new Date().toISOString()
      });
    }

    // アクティブワークスペースを切り替え
    activeWorkspace = selectedPath;
    rootFolder = selectedPath;

    await saveWorkspaces();
    await scanFiles();
    setupFileWatcher();

    return {
      success: true,
      workspace: {
        path: selectedPath,
        name: folderName,
        lastAccessed: new Date().toISOString()
      }
    };
  }

  return { success: false };
});

ipcMain.handle('switch-workspace', async (_, workspacePath) => {
  try {
    // ワークスペースが存在するか確認
    const workspace = workspaces.find(w => w.path === workspacePath);
    if (!workspace) {
      return { success: false, error: 'Workspace not found' };
    }

    // フォルダが実際に存在するか確認
    try {
      await fs.access(workspacePath);
    } catch {
      return { success: false, error: 'Workspace folder does not exist' };
    }

    // lastAccessedを更新
    workspace.lastAccessed = new Date().toISOString();

    // アクティブワークスペースを切り替え
    activeWorkspace = workspacePath;
    rootFolder = workspacePath;

    await saveWorkspaces();
    await scanFiles();
    setupFileWatcher();

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('remove-workspace', async (_, workspacePath) => {
  try {
    // ワークスペースリストから削除
    workspaces = workspaces.filter(w => w.path !== workspacePath);

    // 削除したワークスペースがアクティブだった場合
    if (activeWorkspace === workspacePath) {
      if (workspaces.length > 0) {
        // 最近使ったワークスペースをアクティブにする
        const sorted = workspaces.sort((a, b) =>
          new Date(b.lastAccessed) - new Date(a.lastAccessed)
        );
        activeWorkspace = sorted[0].path;
        rootFolder = activeWorkspace;
        await scanFiles();
        setupFileWatcher();
      } else {
        // ワークスペースが空になった場合
        activeWorkspace = null;
        rootFolder = null;
        files = [];
        if (fileWatcher) {
          fileWatcher.close();
          fileWatcher = null;
        }
      }
    }

    await saveWorkspaces();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// URL and search handlers
ipcMain.handle('open-url', async (_, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('search-google', async (_, searchText) => {
  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchText)}`;
    await shell.openExternal(searchUrl);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// プレビューウィンドウ
ipcMain.handle('open-preview', async () => {
  if (previewWindow) {
    previewWindow.focus();
    return { success: true };
  }

  previewWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'プレビュー',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  previewWindow.loadFile('preview.html');

  previewWindow.on('closed', () => {
    previewWindow = null;
  });

  return { success: true };
});

ipcMain.handle('update-preview', async (_, content) => {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.webContents.send('preview-update', content);
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('request-preview-reload', async () => {
  if (previewWindow && !previewWindow.isDestroyed() && mainWindow) {
    mainWindow.webContents.send('reload-preview-content');
    return { success: true };
  }
  return { success: false };
});

// 開発者ツール
ipcMain.handle('open-dev-tools', () => {
  if (mainWindow) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
});