const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { registerAcceleratorIPC, cleanupOnExit } = require('./accelerator.cjs')

// 禁止多实例
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow = null
const activeDownloads = new Map() // { id: DownloadItem }

// === Steam 路径检测工具 ===
function getSteamPath() {
  if (process.platform !== 'win32') return null
  try {
    const output = require('child_process').execSync(
      'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath',
      { encoding: 'utf-8' }
    )
    const match = output.match(/InstallPath\s+REG_SZ\s+(.+)/)
    if (match) return match[1].trim()
  } catch {}
  const defaults = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', 'D:\\Steam']
  for (const p of defaults) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function getLibraryFolders(steamPath) {
  const folders = [steamPath]
  const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf')
  if (!fs.existsSync(vdfPath)) return folders
  try {
    const content = fs.readFileSync(vdfPath, 'utf-8')
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

  // 外部链接用默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
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
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })
  return result.canceled ? null : result.filePaths[0]
})

// 打开目录
ipcMain.handle('open-directory', async (_e, dirPath) => {
  shell.openPath(dirPath)
})

// 打开外部链接
ipcMain.handle('open-external', async (_e, url) => {
  shell.openExternal(url)
})

ipcMain.handle('http-request', async (_e, url, options = {}) => {
  const response = await fetch(url, options)
  const text = await response.text()

  return {
    ok: response.ok,
    status: response.status,
    text,
  }
})

// 检查文件是否存在
ipcMain.handle('file-exists', async (_e, filePath) => {
  return fs.existsSync(filePath)
})

// 读取文件
ipcMain.handle('read-file', async (_e, filePath) => {
  return fs.readFileSync(filePath, 'utf-8')
})

// 写入文件
ipcMain.handle('write-file', async (_e, filePath, content) => {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filePath, content, 'utf-8')
})

// 扫描目录
ipcMain.handle('scan-directory', async (_e, dirPath) => {
  if (!fs.existsSync(dirPath)) return []
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  return entries.filter(e => e.isDirectory()).map(e => e.name)
})

// 删除文件
ipcMain.handle('delete-file', async (_e, filePath) => {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
})

// Steam 游戏自动检测
ipcMain.handle('scan-steam-games', async () => {
  const steamPath = getSteamPath()
  if (!steamPath) return []

  const libraries = getLibraryFolders(steamPath)
  const results = []

  for (const lib of libraries) {
    const steamapps = path.join(lib, 'steamapps')
    if (!fs.existsSync(steamapps)) continue

    let files
    try { files = fs.readdirSync(steamapps) } catch { continue }

    for (const file of files) {
      if (!file.startsWith('appmanifest_') || !file.endsWith('.acf')) continue
      try {
        const content = fs.readFileSync(path.join(steamapps, file), 'utf-8')
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
})

// === 下载管理 ===
ipcMain.handle('start-download', async (event, url, downloadId, fileName, saveDir) => {
  mainWindow?.webContents.downloadURL(url)
  // 通过临时变量将 ID 传给 will-download
  mainWindow.webContents.session.once('will-download', (e, item, webContents) => {
    const downloadDir = saveDir || path.join(app.getPath('downloads'), 'MikuMod')
    fs.mkdirSync(downloadDir, { recursive: true })
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
  })
})

ipcMain.handle('pause-download', (e, downloadId) => {
  const item = activeDownloads.get(downloadId)
  if (item && !item.isPaused()) item.pause()
})

ipcMain.handle('resume-download', (e, downloadId) => {
  const item = activeDownloads.get(downloadId)
  if (item && item.canResume()) item.resume()
})

ipcMain.handle('cancel-download', (e, downloadId) => {
  const item = activeDownloads.get(downloadId)
  if (item) {
    item.cancel()
    activeDownloads.delete(downloadId)
  }
})

// 窗口控制
ipcMain.handle('window-minimize', () => mainWindow?.minimize())
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.handle('window-close', () => mainWindow?.close())
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized())

app.whenReady().then(() => {
  registerAcceleratorIPC()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('second-instance', (_event, argv) => {
  // Deep link 处理
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()

    const deepLinkUrl = argv.find(arg => arg.startsWith('mikumod://'))
    if (deepLinkUrl) {
      mainWindow.webContents.send('deep-link', deepLinkUrl)
    }
  }
})

app.on('window-all-closed', () => {
  cleanupOnExit()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 注册 mikumod:// 协议
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('mikumod', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('mikumod')
}
