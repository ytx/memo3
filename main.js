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
let memos = [];
let rootFolder = null;
let fileWatcher = null;
let files = [];
const MEMOS_FILE = path.join(app.getPath('userData'), 'memos.json');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const WORKSPACE_FILE = path.join(app.getPath('userData'), 'workspace.json');
const SESSION_FILE = path.join(app.getPath('userData'), 'session.json');

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

async function loadWorkspace() {
  try {
    const data = await fs.readFile(WORKSPACE_FILE, 'utf8');
    const workspace = JSON.parse(data);
    rootFolder = workspace.rootFolder;
    if (rootFolder) {
      await scanFiles();
      setupFileWatcher();
    }
  } catch (error) {
    rootFolder = null;
    files = [];
  }
}

async function saveWorkspace() {
  try {
    const workspace = { rootFolder };
    await fs.writeFile(WORKSPACE_FILE, JSON.stringify(workspace, null, 2));
  } catch (error) {
    console.error('Failed to save workspace:', error);
  }
}

async function loadSession() {
  try {
    const data = await fs.readFile(SESSION_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {
      openTabs: [],
      activeTabId: null
    };
  }
}

async function saveSession(session) {
  try {
    await fs.writeFile(SESSION_FILE, JSON.stringify(session, null, 2));
  } catch (error) {
    console.error('Failed to save session:', error);
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
        const fullPath = path.join(dir, item);
        const relativeItemPath = path.join(relativePath, item);
        const stats = await fs.stat(fullPath);
        
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
    ignored: /(^|[\/\\])\../,
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
  await loadWorkspace();
  
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
  return await loadSession();
});

ipcMain.handle('save-session', async (_, session) => {
  return await saveSession(session);
});

// フォルダ選択
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    rootFolder = result.filePaths[0];
    await saveWorkspace();
    await scanFiles();
    setupFileWatcher();
    return { success: true, folderPath: rootFolder };
  }
  
  return { success: false };
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

// 開発者ツール
ipcMain.handle('open-dev-tools', () => {
  if (mainWindow) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
});