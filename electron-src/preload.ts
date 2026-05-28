import { contextBridge, ipcRenderer } from 'electron'

const deepLinkListeners = new Set<(url: string) => void>()
const pendingDeepLinks: string[] = []
let deepLinkFlushScheduled = false

function dispatchDeepLink(url: string) {
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

ipcRenderer.on('deep-link', (_e, url: string) => {
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
  authorizeDirectory: (path: string) => ipcRenderer.invoke('authorize-directory', path),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectModFile: () => ipcRenderer.invoke('select-mod-file'),
  openDirectory: (path: string) => ipcRenderer.invoke('open-directory', path),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  httpRequest: (url: string, options: unknown) => ipcRenderer.invoke('http-request', url, options),
  fileExists: (path: string) => ipcRenderer.invoke('file-exists', path),
  readFile: (path: string) => ipcRenderer.invoke('read-file', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('write-file', path, content),
  scanDirectory: (path: string) => ipcRenderer.invoke('scan-directory', path),
  deleteFile: (path: string) => ipcRenderer.invoke('delete-file', path),
  scanSteamGames: () => ipcRenderer.invoke('scan-steam-games'),

  // 嵌入式登录窗口
  openLoginWindow: (url: string) => ipcRenderer.invoke('open-login-window', url),

  // 自动更新
  updaterCheck: () => ipcRenderer.invoke('updater-check'),
  updaterDownload: () => ipcRenderer.invoke('updater-download'),
  updaterInstall: () => ipcRenderer.invoke('updater-install'),
  updaterGetChannel: () => ipcRenderer.invoke('updater-get-channel'),
  updaterSetChannel: (channel: string) => ipcRenderer.invoke('updater-set-channel', channel),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdaterEvent: (callback: (data: unknown) => void) => {
    ipcRenderer.on('updater-event', (_e, data) => callback(data))
  },

  // 窗口控制
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // Deep link
  onDeepLink: (callback: (url: string) => void) => {
    deepLinkListeners.add(callback)
    if (pendingDeepLinks.length > 0) {
      schedulePendingDeepLinkFlush()
    }
    return () => deepLinkListeners.delete(callback)
  },

  // 下载进度和控制
  onDownloadEvent: (callback: (data: unknown) => void) => {
    ipcRenderer.on('download-event', (_e, data) => callback(data))
  },
  startDownload: (url: string, downloadId: string, fileName: string, saveDir: string) => ipcRenderer.invoke('start-download', url, downloadId, fileName, saveDir),
  pauseDownload: (id: string) => ipcRenderer.invoke('pause-download', id),
  resumeDownload: (id: string, resumeData: unknown) => ipcRenderer.invoke('resume-download', id, resumeData),
  cancelDownload: (id: string) => ipcRenderer.invoke('cancel-download', id),
  listManagedMods: (input: unknown) => ipcRenderer.invoke('managed-mods-list', input),
  importExternalMod: (input: unknown) => ipcRenderer.invoke('managed-mods-import-external', input),
  importDownloadedMod: (input: unknown) => ipcRenderer.invoke('managed-mods-import-download', input),
  installManagedMod: (input: unknown) => ipcRenderer.invoke('managed-mods-install', input),
  uninstallManagedMod: (input: unknown) => ipcRenderer.invoke('managed-mods-uninstall', input),

  // 加速器
  acceleratorStatus: () => ipcRenderer.invoke('accelerator-status'),
  acceleratorSetDomains: (domains: unknown[]) => ipcRenderer.invoke('accelerator-set-domains', domains),
  acceleratorGetDomains: () => ipcRenderer.invoke('accelerator-get-domains'),
  acceleratorResolve: (domain: string) => ipcRenderer.invoke('accelerator-resolve', domain),
  acceleratorResolveAll: (domains: unknown[]) => ipcRenderer.invoke('accelerator-resolve-all', domains),
  acceleratorStart: (enabledDomains: unknown[]) => ipcRenderer.invoke('accelerator-start', enabledDomains),
  acceleratorStop: () => ipcRenderer.invoke('accelerator-stop'),
  acceleratorRepair: () => ipcRenderer.invoke('accelerator-repair'),
  acceleratorCheckHosts: () => ipcRenderer.invoke('accelerator-check-hosts'),
  acceleratorPing: (ip: string) => ipcRenderer.invoke('accelerator-ping', ip),
  acceleratorPingBoth: (domain: string, ip: string) => ipcRenderer.invoke('accelerator-ping-both', domain, ip),
})
