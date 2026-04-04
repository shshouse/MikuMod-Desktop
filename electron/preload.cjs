const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // 文件系统
  getAppDir: () => ipcRenderer.invoke('get-app-dir'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  openDirectory: (path) => ipcRenderer.invoke('open-directory', path),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  httpRequest: (url, options) => ipcRenderer.invoke('http-request', url, options),
  fileExists: (path) => ipcRenderer.invoke('file-exists', path),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  writeFile: (path, content) => ipcRenderer.invoke('write-file', path, content),
  scanDirectory: (path) => ipcRenderer.invoke('scan-directory', path),
  deleteFile: (path) => ipcRenderer.invoke('delete-file', path),
  scanSteamGames: () => ipcRenderer.invoke('scan-steam-games'),

  // 窗口控制
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // Deep link
  onDeepLink: (callback) => {
    ipcRenderer.on('deep-link', (_e, url) => callback(url))
  },

  // 下载进度和控制
  onDownloadEvent: (callback) => {
    ipcRenderer.on('download-event', (_e, data) => callback(data))
  },
  startDownload: (url, downloadId, fileName, saveDir) => ipcRenderer.invoke('start-download', url, downloadId, fileName, saveDir),
  pauseDownload: (id) => ipcRenderer.invoke('pause-download', id),
  resumeDownload: (id) => ipcRenderer.invoke('resume-download', id),
  cancelDownload: (id) => ipcRenderer.invoke('cancel-download', id),

  // 加速器
  acceleratorStatus: () => ipcRenderer.invoke('accelerator-status'),
  acceleratorSetDomains: (domains) => ipcRenderer.invoke('accelerator-set-domains', domains),
  acceleratorGetDomains: () => ipcRenderer.invoke('accelerator-get-domains'),
  acceleratorResolve: (domain) => ipcRenderer.invoke('accelerator-resolve', domain),
  acceleratorResolveAll: (domains) => ipcRenderer.invoke('accelerator-resolve-all', domains),
  acceleratorStart: (enabledDomains) => ipcRenderer.invoke('accelerator-start', enabledDomains),
  acceleratorStop: () => ipcRenderer.invoke('accelerator-stop'),
  acceleratorCheckHosts: () => ipcRenderer.invoke('accelerator-check-hosts'),
  acceleratorPing: (ip) => ipcRenderer.invoke('accelerator-ping', ip),
  acceleratorPingBoth: (domain, ip) => ipcRenderer.invoke('accelerator-ping-both', domain, ip),
})
