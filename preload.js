const { contextBridge, ipcRenderer } = require('electron');

// セキュアなAPI露出
contextBridge.exposeInMainWorld('api', {
  // メモ関連（互換性のため残す）
  getMemos: () => ipcRenderer.invoke('get-memos'),
  saveMemo: (memo) => ipcRenderer.invoke('save-memo', memo),
  deleteMemo: (id) => ipcRenderer.invoke('delete-memo', id),
  searchMemos: (query) => ipcRenderer.invoke('search-memos', query),
  
  // ファイル関連
  getFiles: () => ipcRenderer.invoke('get-files'),
  getRootFolder: () => ipcRenderer.invoke('get-root-folder'),
  loadFile: (filePath) => ipcRenderer.invoke('load-file', filePath),
  saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
  createFile: (fileName, content) => ipcRenderer.invoke('create-file', fileName, content),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  searchFilesContent: (query) => ipcRenderer.invoke('search-files-content', query),
  
  // 設定関連
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  
  // セッション関連
  getSession: () => ipcRenderer.invoke('get-session'),
  saveSession: (session) => ipcRenderer.invoke('save-session', session),
  
  // フォルダ選択
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  
  // 開発者ツール
  openDevTools: () => ipcRenderer.invoke('open-dev-tools'),
  
  // メインプロセスからのイベント
  onNewMemo: (callback) => {
    ipcRenderer.on('new-memo', callback);
  },
  onSaveMemo: (callback) => {
    ipcRenderer.on('save-memo', callback);
  },
  onOpenSettings: (callback) => {
    ipcRenderer.on('open-settings', callback);
  },
  onFilesUpdated: (callback) => {
    ipcRenderer.on('files-updated', callback);
  }
});