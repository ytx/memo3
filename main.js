const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const chokidar = require('chokidar');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const packageJson = require('./package.json');

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
let tagsData = null; // 現在のワークスペースのタグデータ
const hostname = os.hostname();
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

// ========================================
// タグ管理機能
// ========================================

// UUID生成
function generateUUID() {
  return crypto.randomUUID();
}

// タグファイルのパスを取得
function getTagsFilePath(workspacePath) {
  if (!workspacePath) return null;
  return path.join(workspacePath, `memo3-tags-${hostname}.json`);
}

// タグデータの初期化
function createEmptyTagsData() {
  return {
    version: '1.0',
    hostname: hostname,
    tags: [],
    fileTags: [],
    tagLogs: [],
    fileTagLogs: []
  };
}

// ログから現在の状態を再構築
function rebuildTagsFromLogs(tagsData) {
  const tags = new Map();
  const fileTags = new Map(); // key: "filePath|tagId", value: fileTag object

  // タグログを時系列順にソート
  const sortedTagLogs = [...tagsData.tagLogs].sort((a, b) =>
    new Date(a.timestamp) - new Date(b.timestamp)
  );

  // タグログを再生
  for (const log of sortedTagLogs) {
    if (log.action === 'create') {
      tags.set(log.tagId, {
        id: log.tagId,
        name: log.data.name,
        color: log.data.color,
        order: log.data.order !== undefined ? log.data.order : tags.size,
        createdAt: log.timestamp,
        updatedAt: log.timestamp
      });
    } else if (log.action === 'update') {
      const tag = tags.get(log.tagId);
      if (tag) {
        if (log.data.name !== undefined) tag.name = log.data.name;
        if (log.data.color !== undefined) tag.color = log.data.color;
        if (log.data.order !== undefined) tag.order = log.data.order;
        tag.updatedAt = log.timestamp;
      }
    } else if (log.action === 'delete') {
      tags.delete(log.tagId);
    }
  }

  // ファイルタグログを時系列順にソート
  const sortedFileTagLogs = [...tagsData.fileTagLogs].sort((a, b) =>
    new Date(a.timestamp) - new Date(b.timestamp)
  );

  // ファイルタグログを再生
  for (const log of sortedFileTagLogs) {
    const key = `${log.filePath}|${log.tagId}`;
    if (log.action === 'add') {
      // タグが存在する場合のみ追加
      if (tags.has(log.tagId)) {
        fileTags.set(key, {
          filePath: log.filePath,
          tagId: log.tagId,
          createdAt: log.timestamp
        });
      }
    } else if (log.action === 'remove') {
      fileTags.delete(key);
    }
  }

  return {
    ...tagsData,
    tags: Array.from(tags.values()).sort((a, b) => a.order - b.order),
    fileTags: Array.from(fileTags.values())
  };
}

// タグデータの読み込み
async function loadTagsData(workspacePath) {
  const tagsFilePath = getTagsFilePath(workspacePath);
  if (!tagsFilePath) return createEmptyTagsData();

  try {
    const data = await fs.readFile(tagsFilePath, 'utf8');
    const parsedData = JSON.parse(data);

    // ログから現在の状態を再構築
    return rebuildTagsFromLogs(parsedData);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // ファイルが存在しない場合は空のデータを返す
      return createEmptyTagsData();
    }
    console.error('Failed to load tags data:', error);
    return createEmptyTagsData();
  }
}

// タグデータの保存
async function saveTagsData(workspacePath, data) {
  const tagsFilePath = getTagsFilePath(workspacePath);
  if (!tagsFilePath) return;

  try {
    await fs.writeFile(tagsFilePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Failed to save tags data:', error);
  }
}

// 複数ホストのタグデータをマージ
async function mergeAllTagsData(workspacePath) {
  if (!workspacePath) return createEmptyTagsData();

  try {
    // ワークスペース内のすべてのタグファイルを検索
    const filesInWorkspace = await fs.readdir(workspacePath);
    const tagFiles = filesInWorkspace.filter(f => f.startsWith('memo3-tags-') && f.endsWith('.json'));

    if (tagFiles.length === 0) {
      return createEmptyTagsData();
    }

    // すべてのタグファイルを読み込んでログをマージ
    let allTagLogs = [];
    let allFileTagLogs = [];

    for (const tagFile of tagFiles) {
      try {
        const filePath = path.join(workspacePath, tagFile);
        const data = await fs.readFile(filePath, 'utf8');
        const parsedData = JSON.parse(data);

        allTagLogs = allTagLogs.concat(parsedData.tagLogs || []);
        allFileTagLogs = allFileTagLogs.concat(parsedData.fileTagLogs || []);
      } catch (error) {
        console.error(`Failed to read tag file ${tagFile}:`, error);
      }
    }

    // 重複ログを除去（同じtimestamp+hostname+action+idの組み合わせ）
    const uniqueTagLogs = Array.from(
      new Map(
        allTagLogs.map(log => [
          `${log.timestamp}|${log.hostname}|${log.action}|${log.tagId}`,
          log
        ])
      ).values()
    );

    const uniqueFileTagLogs = Array.from(
      new Map(
        allFileTagLogs.map(log => [
          `${log.timestamp}|${log.hostname}|${log.action}|${log.filePath}|${log.tagId}`,
          log
        ])
      ).values()
    );

    // マージ後のデータを再構築
    const mergedData = {
      version: '1.0',
      hostname: hostname,
      tags: [],
      fileTags: [],
      tagLogs: uniqueTagLogs,
      fileTagLogs: uniqueFileTagLogs
    };

    return rebuildTagsFromLogs(mergedData);
  } catch (error) {
    console.error('Failed to merge tags data:', error);
    return createEmptyTagsData();
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
      'memo3へようこそ.md': `# memo3へようこそ

memo3はシンプルで高速なマークダウンメモアプリケーションです。

Evernoteの代わりになるものを目指して開発されました。
ファイル名を決めずに書き始められ、Ctrl+Kで素早く検索できます。

## 主な特徴

### 📝 エディタ機能
- **マルチタブ編集**: 複数ファイルを同時に開いて編集
- **スマート自動保存**: 編集後5秒で自動保存（日本語入力中は待機）
- **ACE Editor統合**: Vim、Emacsなど複数のキーバインド対応
- **7種類のテーマ**: Monokai、GitHub、Dracula、Solarizedなど
- **表編集機能**: マークダウン表をWYSIWYGで編集

### 🏷️ 整理機能
- **タグ管理**: カラータグでファイルを分類・フィルタリング
- **全文検索**: ファイル名と内容を高速検索
- **行ジャンプ**: 検索結果から該当行に直接移動
- **複数ワークスペース**: プロジェクトごとにフォルダを切り替え

### ⚡ 快適な操作
- **Ctrl+Tab**: 次のタブに切り替え
- **ドラッグ&ドロップ**: タブの並び替え
- **リアルタイム監視**: 外部エディタでの変更を自動検出
- **セッション復元**: 前回開いていたタブを自動復元

### 🎨 カスタマイズ
- **2テーマ切り替え**: 🎨ボタンで素早くテーマ変更
- **フォントサイズ調整**: A- / A+ ボタンで変更
- **空白文字表示**: スペース・タブの可視化

## はじめに

1. **新しいメモを作成**: 右上の + ボタンをクリック
2. **内容を入力**: 2行以上入力すると自動的にファイルが作成されます
3. **検索**: 左側の検索ボックスで全ファイルを検索
4. **ワークスペース切り替え**: 左上のフォルダアイコンから

詳しい使い方は「操作マニュアル.md」をご覧ください。
`,

      '操作マニュアル.md': `# 操作マニュアル

## 📝 ファイル管理

### 新しいファイルの作成
1. 右上の **+** ボタンをクリック（または Cmd+N / macOS）
2. 内容を入力開始
3. 2行以上の非空行を入力すると自動的にファイルが作成されます
4. ファイル名は最初の行（最大16文字）から自動生成されます

### ファイルの操作
- **開く**: ファイルリストからクリック
- **検索**: 検索ボックスに入力（ファイル名と内容を同時検索）
  - 「行 N」をクリックすると該当行にジャンプ
- **削除**: ファイルを右クリック → 「削除」
- **ファイル名更新**: 右クリック → 「ファイル名更新」

### 外部エディタとの連携
- 外部エディタで変更したファイルは自動的に再読み込みされます
- カーソル位置とスクロール位置は保持されます

## 🗂️ タブ操作

### タブの切り替え
- **Ctrl+Tab**: 次のタブ
- **Ctrl+Shift+Tab**: 前のタブ
- **マウス**: タブをクリック

### タブの管理
- **閉じる**: タブの × ボタン
- **並び替え**: タブをドラッグ＆ドロップ
- **スクロール**: タブバーの ‹ › ボタン
- **全て閉じる**: タブを右クリック → 「すべてのタブを閉じる」

## ⚙️ エディタ機能

### 自動保存
- 編集後5秒で自動保存
- 日本語入力（IME）中は変換確定まで待機
- タブを閉じる際も自動保存

### 表示調整
- **フォントサイズ**: A- / A+ ボタン、または設定で指定
- **テーマ切り替え**: 🎨 ボタンで2つのテーマを切り替え
- **空白文字表示**: スペース・タブを可視化
- **マークダウンプレビュー**: 👁 ボタンで別ウィンドウで表示

### エディタのコンテキストメニュー（右クリック）

エディタ上で右クリックすると、以下の機能が使えます：

- **URLを開く**: URLを選択 → 右クリック → 「URLを開く」
- **Googleで検索**: テキストを選択 → 右クリック → 「Googleで検索」
- **箇条書き操作**:
  - 「箇条書き(-)にする」: 複数行選択 → 右クリック
  - 「箇条書き(1)にする」: 番号付きリスト
  - 「箇条書きをやめる」: プレフィックスを削除
  - Tab/Shift+Tab でインデント調整
- **表操作**:
  - 「表を追加」: 新しい3×3の表を挿入
  - 「表を編集」: カーソル位置の表をWYSIWYG編集
    - セル内でEnterキーで改行可能
    - 行・列の追加・削除
    - 列ごとの配置設定（左/中央/右）

## 🏷️ タグ管理

### タグの作成
1. 設定（⚙️）→ タグタブ
2. 検索ボックスにタグ名を入力
3. Enterキーで作成（自動的に色が割り当てられます）

### ファイルにタグを付ける
1. ファイルを右クリック → 「タグを編集」
2. または、ファイルヘッダーの 🏷️ アイコンをクリック
3. タグをクリックして付け外し

### タグでフィルタリング
1. 検索ボックス横の 🏷️ ボタンをクリック
2. タグを3回クリックで状態切り替え:
   - 透明（無効）→ 青（表示）→ 赤（非表示）
3. 「クリア」ボタンで全フィルターをリセット

### タグの並べ替え
- 設定のタグタブでドラッグ&ドロップ
- ファイルアイコンの色は先頭タグの色になります

## 🗂️ ワークスペース管理

### 操作方法
- **切り替え**: 左上のフォルダ名をクリック → 選択
- **追加**: フォルダ名横の + ボタン → フォルダ選択
- **削除**: フォルダ名をクリック → 解除ボタン
  - ※フォルダ自体は削除されません

### ワークスペースの特徴
- 各ワークスペースで独立したセッション（開いているタブ）を保存
- ワークスペース切り替え時、自動的に前回のタブを復元
- 未保存の新規タブがある場合は確認ダイアログを表示

## ⌨️ キーボードショートカット

### 共通
- **Ctrl+Tab**: 次のタブ
- **Ctrl+Shift+Tab**: 前のタブ
- **Cmd+N** (macOS): 新しいタブ

### Emacsキーバインド（設定で有効化時）
- **Ctrl+S**: 検索開始 / 次の候補
- **Ctrl+R**: 前の候補
- **Ctrl+G**: 検索終了
- **Ctrl+W**: カット
- **Alt+W**: コピー
- **Ctrl+Y**: ペースト

## ⚙️ 設定

設定画面（⚙️ボタン）は3つのタブで構成：

### 全般タブ
- 作業フォルダの選択

### エディタタブ
- **キーバインド**: 標準、Vim、Emacs、Sublime、VSCode
- **テーマ1・2**: Monokai、GitHub、Tomorrow、Twilight、Solarized、Dracula
- **フォントサイズ**: 10〜30px
- **折り返し表示**: オン/オフ
- **行番号表示**: オン/オフ

### タグタブ
- タグの作成、編集、削除
- ドラッグ&ドロップで並べ替え
- タグ検索機能

## 💡 ヒント

### 高速な検索
- Ctrl+F でエディタ内検索
- 左側の検索ボックスで全ファイル検索
- 検索結果の「行 N」をクリックで該当箇所にジャンプ

### 効率的なタグ活用
- プロジェクトごとにタグを作成
- 「重要」「TODO」「完了」などのステータスタグ
- 複数のタグフィルタを組み合わせて絞り込み

### 外部エディタとの併用
- VSCodeやvimで編集 → memo3で自動検出
- カーソル位置を保持したまま再読み込み
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
    icon: path.join(__dirname, 'icon.icns'),
    autoHideMenuBar: true  // メニューバーを自動的に非表示（Windows/Linux用）
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

  // macOSの場合のみメニューを設定、Windows/Linuxでは完全に削除
  if (process.platform === 'darwin') {
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  } else {
    Menu.setApplicationMenu(null);
  }
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

    // タグデータをリセット（次回getTags()で新しいワークスペースのデータを読み込む）
    tagsData = null;

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
    },
    autoHideMenuBar: true  // メニューバーを自動的に非表示（Windows/Linux用）
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

// タグ管理 IPC handlers
ipcMain.handle('get-tags', async () => {
  if (!tagsData) {
    tagsData = await mergeAllTagsData(rootFolder);
  }
  return {
    tags: tagsData.tags,
    fileTags: tagsData.fileTags
  };
});

ipcMain.handle('create-tag', async (_, tagData) => {
  try {
    if (!tagsData) {
      tagsData = await mergeAllTagsData(rootFolder);
    }

    const tagId = generateUUID();
    const timestamp = new Date().toISOString();

    // ログに追加
    const log = {
      action: 'create',
      tagId: tagId,
      data: {
        name: tagData.name,
        color: tagData.color,
        order: tagData.order !== undefined ? tagData.order : tagsData.tags.length
      },
      timestamp: timestamp,
      hostname: hostname
    };

    tagsData.tagLogs.push(log);

    // 現在の状態を再構築
    tagsData = rebuildTagsFromLogs(tagsData);

    // 保存
    await saveTagsData(rootFolder, tagsData);

    return { success: true, tagId: tagId };
  } catch (error) {
    console.error('Failed to create tag:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-tag', async (_, tagId, updates) => {
  try {
    if (!tagsData) {
      tagsData = await mergeAllTagsData(rootFolder);
    }

    const timestamp = new Date().toISOString();

    // ログに追加
    const log = {
      action: 'update',
      tagId: tagId,
      data: updates,
      timestamp: timestamp,
      hostname: hostname
    };

    tagsData.tagLogs.push(log);

    // 現在の状態を再構築
    tagsData = rebuildTagsFromLogs(tagsData);

    // 保存
    await saveTagsData(rootFolder, tagsData);

    return { success: true };
  } catch (error) {
    console.error('Failed to update tag:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-tag', async (_, tagId) => {
  try {
    if (!tagsData) {
      tagsData = await mergeAllTagsData(rootFolder);
    }

    const timestamp = new Date().toISOString();

    // ログに追加
    const log = {
      action: 'delete',
      tagId: tagId,
      timestamp: timestamp,
      hostname: hostname
    };

    tagsData.tagLogs.push(log);

    // 現在の状態を再構築
    tagsData = rebuildTagsFromLogs(tagsData);

    // 保存
    await saveTagsData(rootFolder, tagsData);

    return { success: true };
  } catch (error) {
    console.error('Failed to delete tag:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-file-tag', async (_, filePath, tagId) => {
  try {
    console.log('[add-file-tag] Called with:', { filePath, tagId, rootFolder });
    if (!tagsData) {
      tagsData = await mergeAllTagsData(rootFolder);
      console.log('[add-file-tag] Loaded tagsData:', tagsData);
    }

    const timestamp = new Date().toISOString();

    // ログに追加
    const log = {
      action: 'add',
      filePath: filePath,
      tagId: tagId,
      timestamp: timestamp,
      hostname: hostname
    };

    tagsData.fileTagLogs.push(log);
    console.log('[add-file-tag] Added log:', log);

    // 現在の状態を再構築
    tagsData = rebuildTagsFromLogs(tagsData);
    console.log('[add-file-tag] After rebuild, fileTags:', tagsData.fileTags);

    // 保存
    await saveTagsData(rootFolder, tagsData);
    console.log('[add-file-tag] Saved to file');

    return { success: true };
  } catch (error) {
    console.error('Failed to add file tag:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('remove-file-tag', async (_, filePath, tagId) => {
  try {
    if (!tagsData) {
      tagsData = await mergeAllTagsData(rootFolder);
    }

    const timestamp = new Date().toISOString();

    // ログに追加
    const log = {
      action: 'remove',
      filePath: filePath,
      tagId: tagId,
      timestamp: timestamp,
      hostname: hostname
    };

    tagsData.fileTagLogs.push(log);

    // 現在の状態を再構築
    tagsData = rebuildTagsFromLogs(tagsData);

    // 保存
    await saveTagsData(rootFolder, tagsData);

    return { success: true };
  } catch (error) {
    console.error('Failed to remove file tag:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-file-tags', async (_, filePath) => {
  try {
    if (!tagsData) {
      tagsData = await mergeAllTagsData(rootFolder);
    }

    const fileTagRelations = tagsData.fileTags.filter(ft => ft.filePath === filePath);
    const tagIds = fileTagRelations.map(ft => ft.tagId);
    const tags = tagsData.tags.filter(tag => tagIds.includes(tag.id));

    return { success: true, tags: tags };
  } catch (error) {
    console.error('Failed to get file tags:', error);
    return { success: false, error: error.message };
  }
});

// 開発者ツール
ipcMain.handle('open-dev-tools', () => {
  if (mainWindow) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
});

// バージョンチェック
ipcMain.handle('check-update', async () => {
  try {
    const currentVersion = packageJson.version;

    // HTTPSでページを取得
    const html = await new Promise((resolve, reject) => {
      https.get('https://xpenguin.biz/memo3/', (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => { resolve(data); });
      }).on('error', reject);
    });

    // <div class="version">Version X.X.X</div> からバージョンを抽出
    const versionMatch = html.match(/<div class="version">Version\s+([\d.]+)<\/div>/i);
    if (!versionMatch) {
      console.log('Could not find version on website');
      return { hasUpdate: false };
    }

    const latestVersion = versionMatch[1];

    // セマンティックバージョンで比較
    const isNewer = compareVersions(latestVersion, currentVersion) > 0;

    console.log(`Current: ${currentVersion}, Latest: ${latestVersion}, Has update: ${isNewer}`);

    return {
      hasUpdate: isNewer,
      currentVersion,
      latestVersion
    };
  } catch (error) {
    console.error('Failed to check for updates:', error);
    return { hasUpdate: false, error: error.message };
  }
});

// セマンティックバージョン比較
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if (parts1[i] > parts2[i]) return 1;
    if (parts1[i] < parts2[i]) return -1;
  }
  return 0;
}