import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '@shared/ipc-channels'

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

ipcRenderer.on(IpcChannels.deepLink, (_e, url: string) => {
  if (deepLinkListeners.size === 0) {
    pendingDeepLinks.push(url)
    return
  }
  dispatchDeepLink(url)
})

contextBridge.exposeInMainWorld('electronAPI', {
  // 文件系统
  getAppDir: () => ipcRenderer.invoke(IpcChannels.filesystem.getAppDir),
  getAppDataDir: () => ipcRenderer.invoke(IpcChannels.filesystem.getAppDataDir),
  getAppModsDir: () => ipcRenderer.invoke(IpcChannels.filesystem.getAppModsDir),
  getAppBackupsDir: () => ipcRenderer.invoke(IpcChannels.filesystem.getAppBackupsDir),
  authorizeDirectory: (path: string) => ipcRenderer.invoke(IpcChannels.filesystem.authorizeDirectory, path),
  selectDirectory: () => ipcRenderer.invoke(IpcChannels.filesystem.selectDirectory),
  selectModFile: () => ipcRenderer.invoke(IpcChannels.filesystem.selectModFile),
  openDirectory: (path: string) => ipcRenderer.invoke(IpcChannels.filesystem.openDirectory, path),
  openExternal: (url: string) => ipcRenderer.invoke(IpcChannels.filesystem.openExternal, url),
  httpRequest: (url: string, options: unknown) => ipcRenderer.invoke(IpcChannels.http.request, url, options),
  fileExists: (path: string) => ipcRenderer.invoke(IpcChannels.filesystem.fileExists, path),
  readFile: (path: string) => ipcRenderer.invoke(IpcChannels.filesystem.readFile, path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke(IpcChannels.filesystem.writeFile, path, content),
  scanDirectory: (path: string) => ipcRenderer.invoke(IpcChannels.filesystem.scanDirectory, path),
  deleteFile: (path: string) => ipcRenderer.invoke(IpcChannels.filesystem.deleteFile, path),
  scanSteamGames: () => ipcRenderer.invoke(IpcChannels.steam.scan),
  detectEndfield: () => ipcRenderer.invoke(IpcChannels.gameDetect.endfield),

  // 嵌入式登录窗口
  openLoginWindow: (url: string) => ipcRenderer.invoke(IpcChannels.login.open, url),

  // 自动更新
  updaterCheck: () => ipcRenderer.invoke(IpcChannels.updater.check),
  updaterDownload: () => ipcRenderer.invoke(IpcChannels.updater.download),
  updaterInstall: () => ipcRenderer.invoke(IpcChannels.updater.install),
  updaterGetChannel: () => ipcRenderer.invoke(IpcChannels.updater.getChannel),
  updaterSetChannel: (channel: string) => ipcRenderer.invoke(IpcChannels.updater.setChannel, channel),
  getAppVersion: () => ipcRenderer.invoke(IpcChannels.appVersion),
  onUpdaterEvent: (callback: (data: unknown) => void) => {
    ipcRenderer.on(IpcChannels.updater.event, (_e, data) => callback(data))
  },

  // 窗口控制
  minimize: () => ipcRenderer.invoke(IpcChannels.window.minimize),
  maximize: () => ipcRenderer.invoke(IpcChannels.window.maximize),
  close: () => ipcRenderer.invoke(IpcChannels.window.close),
  isMaximized: () => ipcRenderer.invoke(IpcChannels.window.isMaximized),

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
    ipcRenderer.on(IpcChannels.download.event, (_e, data) => callback(data))
  },
  startDownload: (url: string, downloadId: string, fileName: string, saveDir: string) => ipcRenderer.invoke(IpcChannels.download.start, url, downloadId, fileName, saveDir),
  pauseDownload: (id: string) => ipcRenderer.invoke(IpcChannels.download.pause, id),
  resumeDownload: (id: string, resumeData: unknown) => ipcRenderer.invoke(IpcChannels.download.resume, id, resumeData),
  cancelDownload: (id: string) => ipcRenderer.invoke(IpcChannels.download.cancel, id),
  listManagedMods: (input: unknown) => ipcRenderer.invoke(IpcChannels.modManager.list, input),
  importExternalMod: (input: unknown) => ipcRenderer.invoke(IpcChannels.modManager.importExternal, input),
  importDownloadedMod: (input: unknown) => ipcRenderer.invoke(IpcChannels.modManager.importDownload, input),
  installManagedMod: (input: unknown) => ipcRenderer.invoke(IpcChannels.modManager.install, input),
  uninstallManagedMod: (input: unknown) => ipcRenderer.invoke(IpcChannels.modManager.uninstall, input),
  deleteManagedMod: (input: unknown) => ipcRenderer.invoke(IpcChannels.modManager.delete, input),
  resetManagedModState: (input: unknown) => ipcRenderer.invoke(IpcChannels.modManager.resetState, input),

  // XXMI Launcher
  xxmiImportPackage: (zipPath: string) => ipcRenderer.invoke(IpcChannels.xxmi.importPackage, zipPath),
  xxmiGetFrameworkInfo: () => ipcRenderer.invoke(IpcChannels.xxmi.getFrameworkInfo),
  xxmiWriteGameFolder: (gameName: string, gameFolderPath: string) => ipcRenderer.invoke(IpcChannels.xxmi.writeGameFolder, gameName, gameFolderPath),
  xxmiGetGameFolder: (gameName: string) => ipcRenderer.invoke(IpcChannels.xxmi.getGameFolder, gameName),
  xxmiLaunchGame: (gameName: string, gameExePath?: string) => ipcRenderer.invoke(IpcChannels.xxmi.launchGame, gameName, gameExePath),
  xxmiGetModsDir: (miName: string) => ipcRenderer.invoke(IpcChannels.xxmi.getModsDir, miName),
  xxmiGetAllModsDirs: () => ipcRenderer.invoke(IpcChannels.xxmi.getAllModsDirs),
  xxmiUninstall: () => ipcRenderer.invoke(IpcChannels.xxmi.uninstall),
  xxmiCreateShortcut: (gameName: string, miName: string, gameExePath: string) => ipcRenderer.invoke(IpcChannels.xxmi.createShortcut, gameName, miName, gameExePath),

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
