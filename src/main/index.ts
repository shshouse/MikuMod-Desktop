import path from 'path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { initializeDesktopPaths, getDesktopPaths } from './core/paths'
import { loadAuthorizedBaseDirs, isPathAllowed, isAllowedHttpDomain } from './core/security'
import { getRequestIdFromHeaders, newRequestId, writeStructuredLog } from './core/logger'
import { createMainWindow, getMainWindow, openLoginWindow, consumeAuthState } from './core/window'
import { registerAcceleratorIPC, cleanupOnExit } from './accelerator/ipc'
import { registerFilesystemIPC } from './ipc/filesystem'
import { registerDownloadIPC } from './ipc/download'
import { registerSteamIPC } from './ipc/steam'
import { registerGameDetectIPC } from './ipc/game-detect'
import { initAutoUpdater, registerUpdaterIPC } from './ipc/updater'
import { listManagedMods, importExternalMod, importDownloadedArchive, installManagedMod, uninstallManagedMod, deleteManagedMod } from './mod-manager'
import { importXxmiPackage, getXxmiFrameworkInfo, writeGameFolderToConfig, getGameFolderFromConfig, launchGameWithXxmi, getXxmiMiModsDir, getAllXxmiMiModsDirs, uninstallXxmiFramework, createGameShortcut } from './launcher'
import { IpcChannels } from '@shared/ipc-channels'
import fs from 'fs'
// === STARTUP_DEBUG ===
const _dbgFile = path.join(process.cwd(), 'startup-debug.log')
const _dbg = (m: string) => {
  try { fs.appendFileSync(_dbgFile, '[' + new Date().toISOString() + '] ' + m + '\n') } catch {}
}
process.on('uncaughtException', (e: any) => _dbg('uncaught: ' + (e && e.stack ? e.stack : String(e))))
process.on('unhandledRejection', (e: any) => _dbg('unhandledRejection: ' + (e && e.stack ? e.stack : String(e))))
_dbg('module loaded | argv=' + process.argv.join(' '))
// === /STARTUP_DEBUG ===

// --- 初始化 ---

const desktopPaths = initializeDesktopPaths()
loadAuthorizedBaseDirs()

// --- 单实例 ---

const gotLock = app.requestSingleInstanceLock()
_dbg('singleInstanceLock=' + gotLock)
if (!gotLock) { _dbg('lock=false -> app.quit()'); app.quit() }

// --- 窗口控制 IPC ---

function registerWindowControlIPC() {
  ipcMain.handle(IpcChannels.window.minimize, () => { try { getMainWindow()?.minimize() } catch {} })
  ipcMain.handle(IpcChannels.window.maximize, () => {
    try {
      const win = getMainWindow()
      if (win?.isMaximized()) win.unmaximize()
      else win?.maximize()
    } catch {}
  })
  ipcMain.handle(IpcChannels.window.close, () => { try { getMainWindow()?.close() } catch {} })
  ipcMain.handle(IpcChannels.window.isMaximized, () => {
    try { return getMainWindow()?.isMaximized() || false } catch { return false }
  })
}

// --- HTTP 代理 IPC ---

function registerHttpRequestIPC() {
  const BLOCKED_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-secret'])
  ipcMain.handle(IpcChannels.http.request, async (_e, url: string, options: any = {}) => {
    const requestId = getRequestIdFromHeaders(options?.headers) || newRequestId()
    try {
      const timeoutMs = typeof options?.timeoutMs === 'number' ? options.timeoutMs : 15000
      const { timeoutMs: _t, signal: _s, ...requestOptions } = options || {}
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs)

      const userHeaders = { ...(requestOptions.headers || {}) }
      for (const key of Object.keys(userHeaders)) {
        if (BLOCKED_HEADERS.has(key.toLowerCase())) delete userHeaders[key]
      }
      userHeaders['x-request-id'] = requestId
      requestOptions.headers = userHeaders

      if (!isAllowedHttpDomain(url)) {
        writeStructuredLog('warn', 'http-request blocked', { request_id: requestId, code: 'HTTP-MAIN-1001', url })
        return { ok: false, status: 403, text: 'Domain not allowed', headers: { 'x-request-id': requestId } }
      }

      try {
        const response = await fetch(url, { ...requestOptions, signal: controller.signal })
        const text = await response.text()
        const responseRequestId = response.headers.get('x-request-id') || requestId
        return { ok: response.ok, status: response.status, text, headers: { 'x-request-id': responseRequestId } }
      } finally { clearTimeout(timeout) }
    } catch (error: any) {
      writeStructuredLog('error', 'http-request failed', { request_id: requestId, code: 'HTTP-MAIN-1002', url }, error)
      return {
        ok: false,
        status: error?.name === 'AbortError' ? 504 : 500,
        text: error?.message || 'Request failed',
        headers: { 'x-request-id': requestId },
      }
    }
  })
}

// --- Mod 管理 IPC ---

function registerModManagerIPC() {
  ipcMain.handle(IpcChannels.modManager.list, async (_e, input) => {
    try { return await listManagedMods(app, input, desktopPaths.modsDir, desktopPaths.backupsDir) }
    catch (error: any) { console.error('managed-mods-list error:', error); throw new Error(error.message || '获取模组列表失败') }
  })

  ipcMain.handle(IpcChannels.modManager.importExternal, async (_e, input) => {
    try {
      if (!isPathAllowed(input?.sourcePath)) throw new Error('导入源不在允许列表中')
      return await importExternalMod(app, input, desktopPaths.modsDir, desktopPaths.backupsDir)
    } catch (error: any) { console.error('managed-mods-import-external error:', error); throw new Error(error.message || '导入模组失败') }
  })

  ipcMain.handle(IpcChannels.modManager.importDownload, async (_e, input) => {
    try {
      if (!isPathAllowed(input?.sourcePath)) throw new Error('下载文件不在允许列表中')
      return await importDownloadedArchive(app, input, desktopPaths.modsDir, desktopPaths.backupsDir)
    } catch (error: any) { console.error('managed-mods-import-download error:', error); throw new Error(error.message || '导入下载模组失败') }
  })

  ipcMain.handle(IpcChannels.modManager.install, async (_e, input) => {
    try {
      if (!isPathAllowed(input?.gamePath)) throw new Error('游戏目录不在允许列表中')
      return await installManagedMod(app, input, desktopPaths.modsDir, desktopPaths.backupsDir)
    } catch (error: any) {
      console.error('managed-mods-install error:', error)
      return { ok: false, error: error.message || '安装失败', conflicts: [], installedPaths: 0 }
    }
  })

  ipcMain.handle(IpcChannels.modManager.uninstall, async (_e, input) => {
    try {
      if (!isPathAllowed(input?.gamePath)) throw new Error('游戏目录不在允许列表中')
      return await uninstallManagedMod(app, input, desktopPaths.modsDir, desktopPaths.backupsDir)
    } catch (error: any) {
      console.error('managed-mods-uninstall error:', error)
      return { ok: false, error: error.message || '卸载失败', restoredPaths: 0 }
    }
  })

  ipcMain.handle(IpcChannels.modManager.delete, async (_e, input) => {
    try {
      return await deleteManagedMod(app, input, desktopPaths.modsDir, desktopPaths.backupsDir)
    } catch (error: any) {
      console.error('managed-mods-delete error:', error)
      return { ok: false, error: error.message || '删除失败' }
    }
  })
}

// --- XXMI Launcher IPC ---

function registerXxmiIPC() {
  ipcMain.handle(IpcChannels.xxmi.importPackage, async (_e, zipPath: string) => {
    try {
      if (!isPathAllowed(zipPath)) throw new Error('压缩包路径不在允许列表中')
      return await importXxmiPackage(app, zipPath)
    } catch (error: any) {
      console.error('xxmi-import-package error:', error)
      throw new Error(error.message || '导入 XXMI 失败')
    }
  })

  ipcMain.handle(IpcChannels.xxmi.getFrameworkInfo, async (_e) => {
    try {
      return await getXxmiFrameworkInfo(app)
    } catch (error: any) {
      console.error('xxmi-get-framework-info error:', error)
      throw new Error(error.message || '获取框架信息失败')
    }
  })

  ipcMain.handle(IpcChannels.xxmi.writeGameFolder, async (_e, gameName: string, gameFolderPath: string) => {
    try {
      return await writeGameFolderToConfig(app, gameName, gameFolderPath)
    } catch (error: any) {
      console.error('xxmi-write-game-folder error:', error)
      return { success: false, error: error.message || '写入游戏路径失败' }
    }
  })

  ipcMain.handle(IpcChannels.xxmi.getGameFolder, async (_e, gameName: string) => {
    try {
      return await getGameFolderFromConfig(app, gameName)
    } catch (error: any) {
      console.error('xxmi-get-game-folder error:', error)
      return null
    }
  })

  ipcMain.handle(IpcChannels.xxmi.launchGame, async (_e, gameName: string, gameExePath?: string) => {
    try {
      return await launchGameWithXxmi(app, gameName, gameExePath)
    } catch (error: any) {
      console.error('xxmi-launch-game error:', error)
      throw new Error(error.message || '启动失败')
    }
  })

  ipcMain.handle(IpcChannels.xxmi.getModsDir, async (_e, miName: string) => {
    try {
      return await getXxmiMiModsDir(app, miName as any)
    } catch (error: any) {
      console.error('xxmi-get-mods-dir error:', error)
      throw new Error(error.message || '获取 Mods 目录失败')
    }
  })

  ipcMain.handle(IpcChannels.xxmi.getAllModsDirs, async (_e) => {
    try {
      return await getAllXxmiMiModsDirs(app)
    } catch (error: any) {
      console.error('xxmi-get-all-mods-dirs error:', error)
      throw new Error(error.message || '获取 Mods 目录列表失败')
    }
  })

  ipcMain.handle(IpcChannels.xxmi.uninstall, async (_e) => {
    try {
      await uninstallXxmiFramework(app)
      return { ok: true }
    } catch (error: any) {
      console.error('xxmi-uninstall error:', error)
      throw new Error(error.message || '卸载失败')
    }
  })

  ipcMain.handle(IpcChannels.xxmi.createShortcut, async (_e, gameName: string, miName: string, gameExePath: string) => {
    try {
      return await createGameShortcut(app, gameName, miName as any, gameExePath)
    } catch (error: any) {
      console.error('xxmi-create-shortcut error:', error)
      throw new Error(error.message || '创建快捷方式失败')
    }
  })
}

// --- 登录窗口 IPC ---

function registerLoginIPC() {
  ipcMain.handle(IpcChannels.login.open, async (_e, loginUrl: string) => {
    openLoginWindow(loginUrl)
  })
}

// --- 启动 ---

app.whenReady().then(() => {
  _dbg('whenReady fired')
  try { registerAcceleratorIPC() } catch (err) { console.error('accelerator fallback:', err) }
  initAutoUpdater()
  registerWindowControlIPC()
  registerHttpRequestIPC()
  registerFilesystemIPC()
  registerDownloadIPC()
  registerSteamIPC()
  registerGameDetectIPC()
  registerUpdaterIPC()
  registerModManagerIPC()
  registerLoginIPC()
  registerXxmiIPC()

  const win = createMainWindow()
  _dbg('createMainWindow -> ' + (win ? 'ok' : 'null'))

  const deepLinkArg = process.argv.find(arg => arg.startsWith('mikumod://'))
  if (deepLinkArg && win) {
    win.webContents.once('did-finish-load', () => {
      if (deepLinkArg.startsWith('mikumod://auth-callback')) {
        if (!consumeAuthState(deepLinkArg)) {
          writeStructuredLog('warn', 'deep-link auth-callback rejected: invalid state', { url: deepLinkArg })
          return
        }
      }
      win.webContents.send(IpcChannels.deepLink, deepLinkArg)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('second-instance', (_event, argv) => {
  const win = getMainWindow()
  if (win) {
    try {
      if (win.isMinimized()) win.restore()
      win.focus()
      const deepLinkUrl = argv.find(arg => arg.startsWith('mikumod://'))
      if (deepLinkUrl) {
        if (deepLinkUrl.startsWith('mikumod://auth-callback')) {
          if (!consumeAuthState(deepLinkUrl)) {
            writeStructuredLog('warn', 'second-instance auth-callback rejected: invalid state', { url: deepLinkUrl })
            return
          }
        }
        win.webContents.send(IpcChannels.deepLink, deepLinkUrl)
      }
    } catch {}
  }
})

app.on('window-all-closed', async () => {
  _dbg('window-all-closed')
  try { await cleanupOnExit() } catch {}
  if (process.platform !== 'darwin') app.quit()
})

// --- 协议注册 ---

try {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('mikumod', process.execPath, [path.resolve(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient('mikumod')
  }
} catch (error) {
  console.error('Default protocol registration error:', error)
}
