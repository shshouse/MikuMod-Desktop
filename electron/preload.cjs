const { contextBridge, ipcRenderer } = require('electron')

const deepLinkListeners = new Set()
const pendingDeepLinks = []
let deepLinkFlushScheduled = false

function dispatchDeepLink(url) {
  for (const listener of deepLinkListeners) {
    listener(url)
  }
}

function schedulePendingDeepLinkFlush() {
  if (deepLinkFlushScheduled) return
  deepLinkFlushScheduled = true
  setTimeout(() => {
    deepLinkFlushScheduled = false
    const links = pendingDeepLinks.splice(0)
    for (const url of links) {
      dispatchDeepLink(url)
    }
  }, 0)
}

ipcRenderer.on('deep-link', (_e, url) => {
  if (deepLinkListeners.size === 0) {
    pendingDeepLinks.push(url)
    return
  }

  dispatchDeepLink(url)
})

contextBridge.exposeInMainWorld('electronAPI', {
  // 文件系统
  getAppDir: () => ipcRenderer.invoke('get-app-dir'),
  getAppDataDir: () => ipcRenderer.invoke('get-app-data-dir'),
  getAppModsDir: () => ipcRenderer.invoke('get-app-mods-dir'),
  authorizeDirectory: (path) => ipcRenderer.invoke('authorize-directory', path),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectModFile: () => ipcRenderer.invoke('select-mod-file'),
  openDirectory: (path) => ipcRenderer.invoke('open-directory', path),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  httpRequest: (url, options) => ipcRenderer.invoke('http-request', url, options),
  fileExists: (path) => ipcRenderer.invoke('file-exists', path),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  writeFile: (path, content) => ipcRenderer.invoke('write-file', path, content),
  scanDirectory: (path) => ipcRenderer.invoke('scan-directory', path),
  deleteFile: (path) => ipcRenderer.invoke('delete-file', path),
  scanSteamGames: () => ipcRenderer.invoke('scan-steam-games'),

  // 嵌入式登录窗口
  openLoginWindow: (url) => ipcRenderer.invoke('open-login-window', url),

  // 自动更新
  updaterCheck: () => ipcRenderer.invoke('updater-check'),
  updaterDownload: () => ipcRenderer.invoke('updater-download'),
  updaterInstall: () => ipcRenderer.invoke('updater-install'),
  updaterGetChannel: () => ipcRenderer.invoke('updater-get-channel'),
  updaterSetChannel: (channel) => ipcRenderer.invoke('updater-set-channel', channel),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdaterEvent: (callback) => {
    ipcRenderer.on('updater-event', (_e, data) => callback(data))
  },

  // 窗口控制
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // Deep link
  onDeepLink: (callback) => {
    deepLinkListeners.add(callback)
    if (pendingDeepLinks.length > 0) {
      schedulePendingDeepLinkFlush()
    }
    return () => deepLinkListeners.delete(callback)
  },

  // 下载进度和控制
  onDownloadEvent: (callback) => {
    ipcRenderer.on('download-event', (_e, data) => callback(data))
  },
  startDownload: (url, downloadId, fileName, saveDir) => ipcRenderer.invoke('start-download', url, downloadId, fileName, saveDir),
  pauseDownload: (id) => ipcRenderer.invoke('pause-download', id),
  resumeDownload: (id, resumeData) => ipcRenderer.invoke('resume-download', id, resumeData),
  cancelDownload: (id) => ipcRenderer.invoke('cancel-download', id),
  listManagedMods: (input) => ipcRenderer.invoke('managed-mods-list', input),
  importExternalMod: (input) => ipcRenderer.invoke('managed-mods-import-external', input),
  importDownloadedMod: (input) => ipcRenderer.invoke('managed-mods-import-download', input),
  installManagedMod: (input) => ipcRenderer.invoke('managed-mods-install', input),
  uninstallManagedMod: (input) => ipcRenderer.invoke('managed-mods-uninstall', input),

  // 加速器
  acceleratorStatus: () => ipcRenderer.invoke('accelerator-status'),
  acceleratorSetDomains: (domains) => ipcRenderer.invoke('accelerator-set-domains', domains),
  acceleratorGetDomains: () => ipcRenderer.invoke('accelerator-get-domains'),
  acceleratorResolve: (domain) => ipcRenderer.invoke('accelerator-resolve', domain),
  acceleratorResolveAll: (domains) => ipcRenderer.invoke('accelerator-resolve-all', domains),
  acceleratorStart: (enabledDomains) => ipcRenderer.invoke('accelerator-start', enabledDomains),
  acceleratorStop: () => ipcRenderer.invoke('accelerator-stop'),
  acceleratorRepair: () => ipcRenderer.invoke('accelerator-repair'),
  acceleratorCheckHosts: () => ipcRenderer.invoke('accelerator-check-hosts'),
  acceleratorPing: (ip) => ipcRenderer.invoke('accelerator-ping', ip),
  acceleratorPingBoth: (domain, ip) => ipcRenderer.invoke('accelerator-ping-both', domain, ip),
})
