import path from 'path'
import crypto from 'crypto'
import { BrowserWindow, shell } from 'electron'
import { writeMainLog } from './logger'
import { isAllowedExternalUrl, isAllowedHttpDomain } from './security'
import { IpcChannels } from '@shared/ipc-channels'

let mainWindow: BrowserWindow | null = null
let loginWindow: BrowserWindow | null = null

const pendingAuthStates = new Set<string>()

export function getMainWindow() { return mainWindow }

export function consumeAuthState(url: string): boolean {
  try {
    const urlObj = new URL(url)
    if (!urlObj.pathname.startsWith('//auth-callback') && !urlObj.pathname.includes('auth-callback')) return false
    const state = urlObj.searchParams.get('state')
    if (!state) return false
    if (!pendingAuthStates.has(state)) return false
    pendingAuthStates.delete(state)
    return true
  } catch { return false }
}

function attachWindowDiagnostics(win: BrowserWindow) {
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    writeMainLog(`[Window] did-fail-load code=${errorCode} description=${errorDescription} url=${validatedURL} mainFrame=${isMainFrame}`)
  })
  win.webContents.on('did-fail-provisional-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    writeMainLog(`[Window] did-fail-provisional-load code=${errorCode} description=${errorDescription} url=${validatedURL} mainFrame=${isMainFrame}`)
  })
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    writeMainLog(`[Window] preload-error path=${preloadPath} error=${(error as any)?.stack || (error as any)?.message || error}`)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    writeMainLog(`[Window] render-process-gone reason=${details?.reason} exitCode=${details?.exitCode}`)
  })
  win.webContents.on('console-message', (event) => {
    const { level, message, lineNumber, sourceId } = event
    writeMainLog(`[Renderer] level=${level} ${sourceId || ''}:${lineNumber || 0} ${message || ''}`)
  })
}

export function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../../public/favicon.ico'),
    backgroundColor: '#09090b',
    show: false,
  })

  attachWindowDiagnostics(mainWindow)

  // electron-vite 注入的是 ELECTRON_RENDERER_URL；VITE_DEV_SERVER_URL 兼容旧配置
  const devServerUrl = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    writeMainLog(`[Window] loading dev server ${devServerUrl}`)
    mainWindow.loadURL(devServerUrl).catch((err) => {
      writeMainLog(`[Window] loadURL failed: ${err?.stack || err?.message || err}`)
    })
  } else {
    const indexPath = path.join(__dirname, '../../dist/index.html')
    writeMainLog(`[Window] loading ${indexPath}`)
    mainWindow.loadFile(indexPath).catch((err) => {
      writeMainLog(`[Window] loadFile failed: ${err?.stack || err?.message || err}`)
    })
  }

  mainWindow.once('ready-to-show', () => { mainWindow!.show() })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url).catch(() => {})
    else console.warn(`setWindowOpenHandler blocked: ${url}`)
    return { action: 'deny' }
  })

  return mainWindow
}

export function openLoginWindow(loginUrl: string) {
  if (loginWindow && !loginWindow.isDestroyed()) { loginWindow.focus(); return }
  if (!isAllowedExternalUrl(loginUrl) && !isAllowedHttpDomain(loginUrl)) {
    writeMainLog(`[Window] openLoginWindow blocked: ${loginUrl}`)
    return
  }

  const state = crypto.randomBytes(16).toString('hex')
  pendingAuthStates.add(state)
  const urlWithState = new URL(loginUrl)
  urlWithState.searchParams.set('desktop_state', state)
  const finalUrl = urlWithState.toString()

  loginWindow = new BrowserWindow({
    width: 480, height: 680,
    parent: mainWindow!,
    modal: true,
    resizable: false, minimizable: false, maximizable: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
    backgroundColor: '#09090b',
    title: 'MikuMod 登录',
    autoHideMenuBar: true,
  })

  loginWindow.loadURL(finalUrl)

  const handleAuthRedirect = (event: Electron.Event, url: string) => {
    if (url.startsWith('mikumod://auth-callback')) {
      event.preventDefault()
      if (consumeAuthState(url) && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IpcChannels.deepLink, url)
      } else {
        writeMainLog(`[Window] auth-callback rejected: invalid or missing state`)
      }
      loginWindow!.close()
    }
  }

  loginWindow.webContents.on('will-navigate', handleAuthRedirect)
  loginWindow.webContents.on('will-redirect', handleAuthRedirect)
  loginWindow.on('closed', () => { loginWindow = null })
}
