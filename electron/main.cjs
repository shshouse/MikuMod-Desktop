const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const fsPromises = require('fs/promises')
const util = require('util')
// child_process exec 转 Promise
const exec = util.promisify(require('child_process').exec)
const { loadEnvFiles } = require('./env-loader.cjs')

loadEnvFiles({ app })

const { registerAcceleratorIPC, cleanupOnExit } = require('./accelerator.cjs')
const { listManagedMods, importExternalMod, importDownloadedArchive, installManagedMod, uninstallManagedMod } = require('./mod-manager.cjs')

function getAppBaseDir() {
  return app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : path.resolve(__dirname, '..')
}

function canWriteDirectory(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true })
    const testPath = path.join(dirPath, `.write-test-${process.pid}`)
    fs.writeFileSync(testPath, 'ok')
    fs.unlinkSync(testPath)
    return true
  } catch {
    return false
  }
}

function initializeDesktopPaths() {
  const appDir = getAppBaseDir()
  const preferredDataDir = path.join(appDir, 'data')
  const fallbackDataDir = app.getPath('userData')
  const dataDir = canWriteDirectory(preferredDataDir) ? preferredDataDir : fallbackDataDir
  const logsDir = path.join(dataDir, 'logs')
  const preferredModsDir = path.join(appDir, 'mods')
  const modsDir = canWriteDirectory(preferredModsDir) ? preferredModsDir : path.join(dataDir, 'mods')

  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(logsDir, { recursive: true })
  fs.mkdirSync(modsDir, { recursive: true })
  app.setPath('userData', dataDir)
  app.setPath('logs', logsDir)

  return { appDir, dataDir, logsDir, modsDir }
}

const desktopPaths = initializeDesktopPaths()
const authorizedBaseDirs = new Set()
loadAuthorizedBaseDirs()

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
const pendingDownloadRequests = []
let registeredDownloadSession = null

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

function getRequestIdFromHeaders(headers) {
  if (!headers || typeof headers !== 'object') return undefined
  return headers['x-request-id'] || headers['X-Request-Id'] || undefined
}

function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function writeStructuredLog(level, message, context, error) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'mikumod-desktop-main',
    message,
  }
  if (context && Object.keys(context).length > 0) {
    entry.context = context
  }
  if (error) {
    entry.error = {
      name: error.name || 'Error',
      message: error.message || String(error),
      stack: app.isPackaged ? undefined : error.stack,
    }
  }
  const line = JSON.stringify(entry)
  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
  try {
    fs.appendFileSync(path.join(desktopPaths.logsDir, 'main.log'), line + '\n', 'utf-8')
  } catch {}
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

function getAuthorizedBaseDirsPath() {
  return path.join(desktopPaths.dataDir, 'authorized-base-dirs.json')
}

function normalizeBaseDir(dirPath) {
  if (typeof dirPath !== 'string' || !dirPath.trim()) {
    return null
  }

  const normalized = path.normalize(path.resolve(dirPath))
  if (normalized === path.parse(normalized).root) {
    return null
  }

  return normalized
}

function loadAuthorizedBaseDirs() {
  try {
    const content = fs.readFileSync(getAuthorizedBaseDirsPath(), 'utf-8')
    const entries = JSON.parse(content)
    if (!Array.isArray(entries)) {
      return
    }

    for (const entry of entries) {
      const normalized = normalizeBaseDir(entry)
      if (normalized) {
        authorizedBaseDirs.add(normalized)
      }
    }
  } catch {}
}

function saveAuthorizedBaseDirs() {
  try {
    fs.writeFileSync(getAuthorizedBaseDirsPath(), JSON.stringify([...authorizedBaseDirs].sort(), null, 2), 'utf-8')
  } catch {}
}

function authorizeBaseDir(dirPath) {
  const normalized = normalizeBaseDir(dirPath)
  if (!normalized) {
    return null
  }

  authorizedBaseDirs.add(normalized)
  saveAuthorizedBaseDirs()
  return normalized
}

function getSafeBaseDirs() {
  return [
    path.normalize(desktopPaths.appDir),
    path.normalize(desktopPaths.dataDir),
    path.normalize(desktopPaths.modsDir),
    path.normalize(app.getPath('userData')),
    path.normalize(app.getPath('downloads')),
    path.normalize(app.getPath('temp')),
    ...authorizedBaseDirs,
  ]
}

function isPathAllowed(targetPath) {
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    return false
  }

  const normalized = path.normalize(path.resolve(targetPath))
  const baseDirs = getSafeBaseDirs()
  return baseDirs.some(base => normalized.startsWith(base + path.sep) || normalized === base)
}

function emitDownloadEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-event', payload)
  }
}

function enqueueDownloadRequest(request) {
  pendingDownloadRequests.push(request)
}

function removePendingDownloadRequest(downloadId) {
  const index = pendingDownloadRequests.findIndex((request) => request.downloadId === downloadId)
  if (index !== -1) {
    pendingDownloadRequests.splice(index, 1)
  }
}

function takeDownloadRequest(item) {
  const itemUrl = item.getURL()
  const itemUrlChain = Array.isArray(item.getURLChain()) ? item.getURLChain() : []
  const itemSavePath = item.getSavePath()

  let index = pendingDownloadRequests.findIndex((request) => (
    request.kind === 'resume'
      && request.resumeData
      && request.resumeData.path === itemSavePath
  ))

  if (index === -1) {
    index = pendingDownloadRequests.findIndex((request) => (
      request.kind === 'start'
        && (request.url === itemUrl || itemUrlChain.includes(request.url))
    ))
  }

  if (index === -1) {
    index = pendingDownloadRequests.findIndex((request) => (
      request.kind === 'resume'
        && request.resumeData
        && Array.isArray(request.resumeData.urlChain)
        && request.resumeData.urlChain.some((url) => url === itemUrl || itemUrlChain.includes(url))
    ))
  }

  if (index === -1 && pendingDownloadRequests.length === 1) {
    index = 0
  }

  if (index === -1) {
    return null
  }

  return pendingDownloadRequests.splice(index, 1)[0]
}

function getDownloadPercent(receivedBytes, totalBytes) {
  if (!totalBytes || totalBytes <= 0) {
    return 0
  }

  return Math.min(100, (receivedBytes / totalBytes) * 100)
}

function buildResumeData(item, fallbackData) {
  const savePath = item.getSavePath() || fallbackData?.path
  const currentUrlChain = item.getURLChain()
  const urlChain = Array.isArray(currentUrlChain) && currentUrlChain.length > 0
    ? currentUrlChain
    : fallbackData?.urlChain
  const length = item.getTotalBytes() || fallbackData?.length || 0
  const offset = item.getReceivedBytes() || fallbackData?.offset || 0

  if (!savePath || !Array.isArray(urlChain) || urlChain.length === 0 || !Number.isFinite(length) || length <= 0) {
    return undefined
  }

  const mimeType = item.getMimeType() || fallbackData?.mimeType
  const lastModified = item.getLastModifiedTime() || fallbackData?.lastModified
  const eTag = item.getETag() || fallbackData?.eTag
  const startTime = item.getStartTime() || fallbackData?.startTime

  return {
    path: savePath,
    urlChain,
    offset,
    length,
    ...(mimeType ? { mimeType } : {}),
    ...(lastModified ? { lastModified } : {}),
    ...(eTag ? { eTag } : {}),
    ...(startTime ? { startTime } : {}),
  }
}

function attachDownloadItem(item, request) {
  const fallbackResumeData = request.kind === 'resume' ? request.resumeData : undefined

  if (request.kind === 'start') {
    const downloadDir = request.saveDir || path.join(app.getPath('downloads'), 'MikuMod')
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true })
    }
    item.setSavePath(path.join(downloadDir, request.fileName || item.getFilename()))
  }

  activeDownloads.set(request.downloadId, item)

  const emitState = (status, extra = {}) => {
    const receivedBytes = item.getReceivedBytes()
    const totalBytes = item.getTotalBytes()
    const resumeData = status === 'done' ? undefined : buildResumeData(item, fallbackResumeData)

    emitDownloadEvent({
      id: request.downloadId,
      status,
      receivedBytes,
      totalBytes,
      percent: status === 'done' ? 100 : getDownloadPercent(receivedBytes, totalBytes),
      savePath: item.getSavePath(),
      ...(resumeData ? { resumeData } : {}),
      ...extra,
    })
  }

  emitState(request.kind === 'resume' || item.isPaused() ? 'paused' : 'downloading')

  item.on('updated', (_event, state) => {
    if (state === 'interrupted') {
      const resumeData = buildResumeData(item, fallbackResumeData)
      if (item.canResume() && resumeData) {
        emitState('paused')
      } else {
        emitDownloadEvent({
          id: request.downloadId,
          status: 'error',
          error: '连接中断',
          savePath: item.getSavePath(),
          ...(resumeData ? { resumeData } : {}),
        })
      }
      return
    }

    if (state === 'progressing') {
      if (item.isPaused()) {
        emitState('paused')
      } else {
        emitState('downloading')
      }
    }
  })

  item.once('done', (_event, state) => {
    activeDownloads.delete(request.downloadId)

    if (state === 'completed') {
      emitDownloadEvent({ id: request.downloadId, status: 'done', percent: 100, savePath: item.getSavePath() })
      return
    }

    if (state === 'cancelled') {
      return
    }

    const resumeData = buildResumeData(item, fallbackResumeData)
    if (resumeData) {
      emitDownloadEvent({
        id: request.downloadId,
        status: 'paused',
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        percent: getDownloadPercent(item.getReceivedBytes(), item.getTotalBytes()),
        savePath: item.getSavePath(),
        resumeData,
      })
      return
    }

    emitDownloadEvent({ id: request.downloadId, status: 'error', error: `下载失败: ${state}`, savePath: item.getSavePath() })
  })
}

function setupDownloadSessionHandlers(targetWindow) {
  const targetSession = targetWindow && !targetWindow.isDestroyed() ? targetWindow.webContents.session : null
  if (!targetSession || registeredDownloadSession === targetSession) {
    return
  }

  registeredDownloadSession = targetSession
  targetSession.on('will-download', (_event, item) => {
    const request = takeDownloadRequest(item)
    if (!request) {
      return
    }

    try {
      attachDownloadItem(item, request)

      if (request.kind === 'resume' && request.autoResume) {
        if (item.canResume()) {
          item.resume()
        } else {
          activeDownloads.delete(request.downloadId)
          emitDownloadEvent({
            id: request.downloadId,
            status: 'error',
            error: '当前下载不支持断点恢复',
            savePath: item.getSavePath() || request.resumeData?.path,
            ...(request.resumeData ? { resumeData: request.resumeData } : {}),
          })
        }
      }
    } catch (error) {
      activeDownloads.delete(request.downloadId)
      emitDownloadEvent({
        id: request.downloadId,
        status: 'error',
        error: error?.message || '下载任务初始化失败',
      })
    }
  })
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

  setupDownloadSessionHandlers(mainWindow)
}

// === IPC Handlers ===

// 获取 app 运行目录
ipcMain.handle('get-app-dir', () => {
  return desktopPaths.appDir
})

ipcMain.handle('get-app-data-dir', () => {
  return desktopPaths.dataDir
})

ipcMain.handle('get-app-mods-dir', () => {
  return desktopPaths.modsDir
})

ipcMain.handle('authorize-directory', async (_e, dirPath) => {
  try {
    const normalized = normalizeBaseDir(dirPath)
    if (!normalized) {
      return false
    }

    const stat = await fsPromises.stat(normalized)
    if (!stat.isDirectory()) {
      return false
    }

    authorizeBaseDir(normalized)
    return true
  } catch {
    return false
  }
})

// 选择目录
ipcMain.handle('select-directory', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    if (result.canceled) {
      return null
    }

    const selectedPath = result.filePaths[0]
    authorizeBaseDir(selectedPath)
    return selectedPath
  } catch (error) {
    console.error('select-directory error:', error)
    return null
  }
})

ipcMain.handle('select-mod-file', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: '支持的压缩包', extensions: ['zip', '7z', 'rar', 'tar', 'gz', 'tgz'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (result.canceled) {
      return null
    }

    const selectedPath = result.filePaths[0]
    authorizeBaseDir(path.dirname(selectedPath))
    return selectedPath
  } catch (error) {
    console.error('select-mod-file error:', error)
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
  const requestId = getRequestIdFromHeaders(options?.headers) || newRequestId()
  try {
    const timeoutMs = typeof options?.timeoutMs === 'number' ? options.timeoutMs : 15000
    const { timeoutMs: _timeoutMs, signal: _signal, ...requestOptions } = options || {}
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs)

    requestOptions.headers = {
      ...(requestOptions.headers || {}),
      'x-request-id': requestId,
    }

    if (!isAllowedHttpDomain(url)) {
      writeStructuredLog('warn', 'http-request blocked', {
        request_id: requestId,
        code: 'HTTP-MAIN-1001',
        url,
      })
      return { ok: false, status: 403, text: 'Domain not allowed', headers: { 'x-request-id': requestId } }
    }

    try {
      const response = await fetch(url, {
        ...requestOptions,
        signal: controller.signal,
      })
      const text = await response.text()
      const responseRequestId = response.headers.get('x-request-id') || requestId
      return {
        ok: response.ok,
        status: response.status,
        text,
        headers: { 'x-request-id': responseRequestId },
      }
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    writeStructuredLog('error', 'http-request failed', {
      request_id: requestId,
      code: 'HTTP-MAIN-1002',
      url,
    }, error)
    return {
      ok: false,
      status: error?.name === 'AbortError' ? 504 : 500,
      text: error?.message || 'Request failed',
      headers: { 'x-request-id': requestId },
    }
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
    if (!isPathAllowed(destPath)) {
      console.warn(`copy-file dest blocked: ${destPath}`)
      return false
    }
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

ipcMain.handle('managed-mods-list', async (_e, input) => {
  try {
    return await listManagedMods(app, input, desktopPaths.modsDir)
  } catch (error) {
    console.error('managed-mods-list error:', error)
    throw new Error(error.message || '获取模组列表失败')
  }
})

ipcMain.handle('managed-mods-import-external', async (_e, input) => {
  try {
    if (!isPathAllowed(input?.sourcePath)) {
      throw new Error('导入源不在允许列表中')
    }

    return await importExternalMod(app, input, desktopPaths.modsDir)
  } catch (error) {
    console.error('managed-mods-import-external error:', error)
    throw new Error(error.message || '导入模组失败')
  }
})

ipcMain.handle('managed-mods-import-download', async (_e, input) => {
  try {
    if (!isPathAllowed(input?.sourcePath)) {
      throw new Error('下载文件不在允许列表中')
    }

    return await importDownloadedArchive(app, input, desktopPaths.modsDir)
  } catch (error) {
    console.error('managed-mods-import-download error:', error)
    throw new Error(error.message || '导入下载模组失败')
  }
})

ipcMain.handle('managed-mods-install', async (_e, input) => {
  try {
    if (!isPathAllowed(input?.gamePath)) {
      throw new Error('游戏目录不在允许列表中')
    }

    return await installManagedMod(app, input, desktopPaths.modsDir)
  } catch (error) {
    console.error('managed-mods-install error:', error)
    return { ok: false, error: error.message || '安装失败', conflicts: [], installedPaths: 0 }
  }
})

ipcMain.handle('managed-mods-uninstall', async (_e, input) => {
  try {
    if (!isPathAllowed(input?.gamePath)) {
      throw new Error('游戏目录不在允许列表中')
    }

    return await uninstallManagedMod(app, input, desktopPaths.modsDir)
  } catch (error) {
    console.error('managed-mods-uninstall error:', error)
    return { ok: false, error: error.message || '卸载失败', restoredPaths: 0 }
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
            const installPath = path.join(steamapps, 'common', installDir)
            authorizeBaseDir(installPath)
            results.push({
              appId,
              name: name || installDir,
              installPath,
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
ipcMain.handle('start-download', async (_event, url, downloadId, fileName, saveDir) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('主窗口不可用，无法启动下载')
    }

    if (!isAllowedHttpDomain(url)) {
      throw new Error('下载地址不在允许列表中')
    }

    if (saveDir && !isPathAllowed(saveDir)) {
      throw new Error('下载目录不在允许列表中')
    }

    setupDownloadSessionHandlers(mainWindow)
    enqueueDownloadRequest({
      kind: 'start',
      downloadId,
      url,
      fileName,
      saveDir,
    })
    mainWindow.webContents.downloadURL(url)
  } catch (error) {
    console.error('start-download invoke fallback:', error)
    removePendingDownloadRequest(downloadId)
    emitDownloadEvent({ id: downloadId, status: 'error', error: error?.message || '下载启动失败' })
  }
})

ipcMain.handle('pause-download', (_e, downloadId) => {
  try {
    const item = activeDownloads.get(downloadId)
    if (item && !item.isPaused()) item.pause()
  } catch {}
})

ipcMain.handle('resume-download', async (_e, downloadId, resumeData) => {
  try {
    const item = activeDownloads.get(downloadId)
    if (item && item.canResume()) {
      item.resume()
      return
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('主窗口不可用，无法继续下载')
    }

    if (!resumeData || !resumeData.path || !Array.isArray(resumeData.urlChain) || resumeData.urlChain.length === 0) {
      throw new Error('缺少可恢复的下载信息')
    }

    if (!isPathAllowed(resumeData.path)) {
      throw new Error('恢复下载路径不在允许列表中')
    }

    for (const resumeUrl of resumeData.urlChain) {
      if (!isAllowedHttpDomain(resumeUrl)) {
        throw new Error('恢复下载地址不在允许列表中')
      }
    }

    setupDownloadSessionHandlers(mainWindow)
    enqueueDownloadRequest({
      kind: 'resume',
      downloadId,
      resumeData,
      autoResume: true,
    })
    mainWindow.webContents.session.createInterruptedDownload(resumeData)
  } catch (error) {
    console.error('resume-download invoke fallback:', error)
    removePendingDownloadRequest(downloadId)
    emitDownloadEvent({
      id: downloadId,
      status: 'error',
      error: error?.message || '下载恢复失败',
      ...(resumeData ? { resumeData } : {}),
    })
  }
})

ipcMain.handle('cancel-download', (_e, downloadId) => {
  try {
    removePendingDownloadRequest(downloadId)
    const item = activeDownloads.get(downloadId)
    if (item) {
      item.cancel()
      activeDownloads.delete(downloadId)
    }
  } catch {}
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
const ALLOWED_CHANNELS = new Set(['stable', 'beta', 'alpha'])

function getChannelFile() {
  return path.join(desktopPaths.dataDir, 'update-channel.txt')
}

function readChannel() {
  try {
    const v = fs.readFileSync(getChannelFile(), 'utf-8').trim()
    if (ALLOWED_CHANNELS.has(v)) return v
  } catch {}
  return 'stable'
}

function writeChannel(channel) {
  if (!ALLOWED_CHANNELS.has(channel)) return false
  try {
    fs.writeFileSync(getChannelFile(), channel, 'utf-8')
    return true
  } catch {
    return false
  }
}

function setupAutoUpdater() {
  if (!autoUpdater) return

  autoUpdater.allowDowngrade = true
  autoUpdater.channel = readChannel()

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

ipcMain.handle('updater-get-channel', () => readChannel())

ipcMain.handle('updater-set-channel', (_event, channel) => {
  if (!writeChannel(channel)) return { success: false }
  if (autoUpdater) autoUpdater.channel = channel
  return { success: true }
})

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
