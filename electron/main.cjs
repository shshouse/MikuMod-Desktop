const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const fsPromises = require('fs/promises')
const util = require('util')
// child_process exec 转 Promise
const exec = util.promisify(require('child_process').exec)
const { registerAcceleratorIPC, cleanupOnExit } = require('./accelerator.cjs')

// === Auto-update (electron-updater) ===
let autoUpdater = null
try {
  autoUpdater = require('electron-updater').autoUpdater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
} catch {
  // electron-updater not installed (dev mode) — skip
}

// 禁止多实例
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow = null
const activeDownloads = new Map() // { id: DownloadItem }

// === Security: path & URL validation ===
const ALLOWED_EXTERNAL_DOMAINS = new Set([
  'mikumod.com', 'www.mikumod.com',
  'REDACTED.icu', 'www.REDACTED.icu',
  'github.com',
])

function isAllowedExternalUrl(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    const host = parsed.hostname.toLowerCase()
    for (const domain of ALLOWED_EXTERNAL_DOMAINS) {
      if (host === domain || host.endsWith('.' + domain)) return true
    }
    return false
  } catch {
    return false
  }
}

const ALLOWED_HTTP_DOMAINS = new Set([
  'mikumod.com', 'www.mikumod.com',
  'REDACTED.icu', 'www.REDACTED.icu',
])

function isAllowedHttpDomain(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    const host = parsed.hostname.toLowerCase()
    if (host.endsWith('.supabase.co') || host.endsWith('.supabase.in')) return true
    for (const domain of ALLOWED_HTTP_DOMAINS) {
      if (host === domain || host.endsWith('.' + domain)) return true
    }
    return false
  } catch {
    return false
  }
}

function getSafeBaseDirs() {
  const appDir = app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : path.resolve(__dirname, '..')
  return [
    path.normalize(appDir),
    path.normalize(app.getPath('userData')),
    path.normalize(app.getPath('downloads')),
    path.normalize(app.getPath('temp')),
  ]
}

function isPathAllowed(targetPath) {
  const normalized = path.normalize(path.resolve(targetPath))
  const baseDirs = getSafeBaseDirs()
  return baseDirs.some(base => normalized.startsWith(base + path.sep) || normalized === base)
}

// === Steam 路径检测工具 (完全异步) ===
async function getSteamPath() {
  if (process.platform !== 'win32') return null
  
  // 1. 读取注册表（异步不阻塞主进程）
  try {
    const { stdout } = await exec('reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath', { encoding: 'utf-8' })
    const match = stdout.match(/InstallPath\s+REG_SZ\s+(.+)/)
    if (match) return match[1].trim()
  } catch {}
  
  // 2. 备用默认路径回退
  const defaults = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', 'D:\\Steam']
  for (const p of defaults) {
    try {
      await fsPromises.access(p)
      return p
    } catch {}
  }
  return null
}

async function getLibraryFolders(steamPath) {
  const folders = [steamPath]
  const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf')
  try {
    await fsPromises.access(vdfPath)
    const content = await fsPromises.readFile(vdfPath, 'utf-8')
    const regex = /"path"\s+"([^"]+)"/g
    let m
    while ((m = regex.exec(content)) !== null) {
      const p = m[1].replace(/\\\\/g, '\\')
      if (!folders.includes(p)) folders.push(p)
    }
  } catch {}
  return folders
}

function parseVdfValue(content, key) {
  const m = content.match(new RegExp(`"${key}"\\s+"([^"]+)"`, 'i'))
  return m ? m[1] : null
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../public/favicon.ico'),
    backgroundColor: '#09090b',
    show: false,
  })

  // 开发模式加载 Vite dev server，生产加载打包文件
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // 外部链接用默认浏览器打开 (仅允许白名单域名)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url).catch(() => {})
    } else {
      console.warn(`setWindowOpenHandler blocked: ${url}`)
    }
    return { action: 'deny' }
  })
}

// === IPC Handlers ===

// 获取 app 运行目录
ipcMain.handle('get-app-dir', () => {
  return app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : path.resolve(__dirname, '..')
})

// 选择目录
ipcMain.handle('select-directory', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  } catch (error) {
    console.error('select-directory error:', error)
    return null
  }
})

// 打开目录 (限制在安全目录)
ipcMain.handle('open-directory', async (_e, dirPath) => {
  try {
    if (!isPathAllowed(dirPath)) {
      console.warn(`open-directory blocked: ${dirPath}`)
      return
    }
    await shell.openPath(dirPath)
  } catch (error) {
    console.error('open-directory error:', error)
  }
})

// 打开外部链接 (仅允许白名单域名的 https/http 链接)
ipcMain.handle('open-external', async (_e, url) => {
  try {
    if (!isAllowedExternalUrl(url)) {
      console.warn(`open-external blocked: ${url}`)
      return
    }
    await shell.openExternal(url)
  } catch (error) {
    console.error('open-external error:', error)
  }
})

// 请求安全代理与异常处理 (仅允许受信域名)
ipcMain.handle('http-request', async (_e, url, options = {}) => {
  try {
    if (!isAllowedHttpDomain(url)) {
      console.warn(`http-request blocked: ${url}`)
      return { ok: false, status: 403, text: 'Domain not allowed' }
    }
    const response = await fetch(url, options)
    const text = await response.text()
    return {
      ok: response.ok,
      status: response.status,
      text,
    }
  } catch (error) {
    console.error(`http-request failed for ${url}:`, error)
    return { ok: false, status: 500, text: error.message }
  }
})

// 检查文件是否存在 (限制在安全目录)
ipcMain.handle('file-exists', async (_e, filePath) => {
  try {
    if (!isPathAllowed(filePath)) return false
    await fsPromises.access(filePath)
    return true
  } catch {
    return false
  }
})

// 读取文件 (限制在安全目录)
ipcMain.handle('read-file', async (_e, filePath) => {
  try {
    if (!isPathAllowed(filePath)) {
      console.warn(`read-file blocked: ${filePath}`)
      return null
    }
    return await fsPromises.readFile(filePath, 'utf-8')
  } catch (error) {
    console.error(`read-file error (${filePath}):`, error)
    return null
  }
})

// 写入文件 (限制在安全目录)
ipcMain.handle('write-file', async (_e, filePath, content) => {
  try {
    if (!isPathAllowed(filePath)) {
      console.warn(`write-file blocked: ${filePath}`)
      return false
    }
    const dir = path.dirname(filePath)
    await fsPromises.mkdir(dir, { recursive: true })
    await fsPromises.writeFile(filePath, content, 'utf-8')
    return true
  } catch (error) {
    console.error(`write-file error (${filePath}):`, error)
    return false
  }
})

// 扫描目录 (限制在安全目录)
ipcMain.handle('scan-directory', async (_e, dirPath) => {
  try {
    if (!isPathAllowed(dirPath)) {
      console.warn(`scan-directory blocked: ${dirPath}`)
      return []
    }
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true })
    return entries.filter(e => e.isDirectory()).map(e => e.name)
  } catch (error) {
    console.error(`scan-directory error (${dirPath}):`, error)
    return []
  }
})

// 复制文件 (源和目标都必须在安全目录内)
ipcMain.handle('copy-file', async (_e, srcPath, destPath) => {
  try {
    if (!isPathAllowed(srcPath)) {
      console.warn(`copy-file src blocked: ${srcPath}`)
      return false
    }
    // 目标路径需要动态加入安全目录 (用户指定的游戏目录)
    const destDir = path.dirname(destPath)
    await fsPromises.mkdir(destDir, { recursive: true })
    await fsPromises.copyFile(srcPath, destPath)
    return true
  } catch (error) {
    console.error(`copy-file error (${srcPath} -> ${destPath}):`, error)
    return false
  }
})

// 删除文件 (限制在安全目录)
ipcMain.handle('delete-file', async (_e, filePath) => {
  try {
    if (!isPathAllowed(filePath)) {
      console.warn(`delete-file blocked: ${filePath}`)
      return false
    }
    await fsPromises.unlink(filePath)
    return true
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`delete-file error (${filePath}):`, error)
    }
    return false
  }
})

// Steam 游戏自动检测 (纯异步流，彻底解放主线程)
ipcMain.handle('scan-steam-games', async () => {
  try {
    const steamPath = await getSteamPath()
    if (!steamPath) return []

    const libraries = await getLibraryFolders(steamPath)
    const results = []

    for (const lib of libraries) {
      const steamapps = path.join(lib, 'steamapps')
      let files
      try {
        files = await fsPromises.readdir(steamapps)
      } catch {
        continue
      }

      for (const file of files) {
        if (!file.startsWith('appmanifest_') || !file.endsWith('.acf')) continue
        try {
          const content = await fsPromises.readFile(path.join(steamapps, file), 'utf-8')
          const appId = parseVdfValue(content, 'appid')
          const name = parseVdfValue(content, 'name')
          const installDir = parseVdfValue(content, 'installdir')
          if (appId && installDir) {
            results.push({
              appId,
              name: name || installDir,
              installPath: path.join(steamapps, 'common', installDir),
            })
          }
        } catch {}
      }
    }

    return results
  } catch (error) {
    console.error("scan-steam-games general fault:", error)
    return []
  }
})

// === 下载管理 ===
ipcMain.handle('start-download', async (event, url, downloadId, fileName, saveDir) => {
  try {
    mainWindow?.webContents.downloadURL(url)
    
    mainWindow.webContents.session.once('will-download', (e, item, webContents) => {
      try {
        const downloadDir = saveDir || path.join(app.getPath('downloads'), 'MikuMod')
        if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true })
        
        item.setSavePath(path.join(downloadDir, fileName || item.getFilename()))
        activeDownloads.set(downloadId, item)

        item.on('updated', (event, state) => {
          if (state === 'interrupted') {
            mainWindow?.webContents.send('download-event', { id: downloadId, status: 'error', error: '连接中断' })
          } else if (state === 'progressing') {
            if (item.isPaused()) {
              mainWindow?.webContents.send('download-event', { id: downloadId, status: 'paused' })
            } else {
              mainWindow?.webContents.send('download-event', {
                id: downloadId,
                status: 'downloading',
                receivedBytes: item.getReceivedBytes(),
                totalBytes: item.getTotalBytes(),
                percent: (item.getReceivedBytes() / item.getTotalBytes()) * 100
              })
            }
          }
        })

        item.once('done', (event, state) => {
          activeDownloads.delete(downloadId)
          if (state === 'completed') {
            mainWindow?.webContents.send('download-event', { id: downloadId, status: 'done', savePath: item.getSavePath() })
          } else {
            mainWindow?.webContents.send('download-event', { id: downloadId, status: 'error', error: `下载失败: ${state}` })
          }
        })
      } catch (err) {
        console.error('will-download inner error:', err)
        mainWindow?.webContents.send('download-event', { id: downloadId, status: 'error', error: err.message })
      }
    })
  } catch (error) {
    console.error('start-download invoke fallback:', error)
  }
})

ipcMain.handle('pause-download', (e, downloadId) => {
  try {
    const item = activeDownloads.get(downloadId)
    if (item && !item.isPaused()) item.pause()
  } catch (err) {}
})

ipcMain.handle('resume-download', (e, downloadId) => {
  try {
    const item = activeDownloads.get(downloadId)
    if (item && item.canResume()) item.resume()
  } catch (err) {}
})

ipcMain.handle('cancel-download', (e, downloadId) => {
  try {
    const item = activeDownloads.get(downloadId)
    if (item) {
      item.cancel()
      activeDownloads.delete(downloadId)
    }
  } catch (err) {}
})

// 窗口控制兜底
ipcMain.handle('window-minimize', () => { try { mainWindow?.minimize() } catch {} })
ipcMain.handle('window-maximize', () => {
  try {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  } catch {}
})
ipcMain.handle('window-close', () => { try { mainWindow?.close() } catch {} })
ipcMain.handle('window-is-maximized', () => {
  try { return mainWindow?.isMaximized() || false } catch { return false }
})

// === Embedded OAuth Login Window ===
let loginWindow = null

ipcMain.handle('open-login-window', async (_e, loginUrl) => {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus()
    return
  }

  loginWindow = new BrowserWindow({
    width: 480,
    height: 680,
    parent: mainWindow,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#09090b',
    title: 'MikuMod 登录',
    autoHideMenuBar: true,
  })

  loginWindow.loadURL(loginUrl)

  // Watch for navigation to auth-callback deep link or redirect URL
  loginWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('mikumod://auth-callback')) {
      event.preventDefault()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('deep-link', url)
      }
      loginWindow.close()
    }
  })

  loginWindow.webContents.on('will-redirect', (event, url) => {
    if (url.startsWith('mikumod://auth-callback')) {
      event.preventDefault()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('deep-link', url)
      }
      loginWindow.close()
    }
  })

  loginWindow.on('closed', () => {
    loginWindow = null
  })
})

// === Auto-update IPC ===
function setupAutoUpdater() {
  if (!autoUpdater) return

  autoUpdater.on('update-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater-event', { type: 'update-available', info })
    }
  })

  autoUpdater.on('update-not-available', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater-event', { type: 'update-not-available' })
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater-event', { type: 'download-progress', progress })
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater-event', { type: 'update-downloaded', info })
    }
  })

  autoUpdater.on('error', (err) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater-event', { type: 'error', error: err?.message || String(err) })
    }
  })
}

ipcMain.handle('updater-check', async () => {
  if (!autoUpdater) return { available: false, reason: 'updater-not-available' }
  try {
    const result = await autoUpdater.checkForUpdates()
    return { available: !!result?.updateInfo, info: result?.updateInfo }
  } catch (err) {
    return { available: false, reason: err?.message || String(err) }
  }
})

ipcMain.handle('updater-download', async () => {
  if (!autoUpdater) return false
  try { await autoUpdater.downloadUpdate(); return true } catch { return false }
})

ipcMain.handle('updater-install', () => {
  if (!autoUpdater) return
  autoUpdater.quitAndInstall(false, true)
})

ipcMain.handle('get-app-version', () => app.getVersion())

app.whenReady().then(() => {
  try { registerAcceleratorIPC() } catch (err) { console.error("accelerator fallback:", err) }
  setupAutoUpdater()
  createWindow()

  // Cold start deep link: check if app was launched via mikumod:// URL
  const deepLinkArg = process.argv.find(arg => arg.startsWith('mikumod://'))
  if (deepLinkArg && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('deep-link', deepLinkArg)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('second-instance', (_event, argv) => {
  // Deep link 处理
  if (mainWindow) {
    try {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()

      const deepLinkUrl = argv.find(arg => arg.startsWith('mikumod://'))
      if (deepLinkUrl) {
        mainWindow.webContents.send('deep-link', deepLinkUrl)
      }
    } catch {}
  }
})

app.on('window-all-closed', () => {
  try { cleanupOnExit() } catch {}
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 注册 mikumod:// 协议
try {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('mikumod', process.execPath, [path.resolve(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient('mikumod')
  }
} catch (error) {
  console.error("Default protocol registration error:", error)
}
