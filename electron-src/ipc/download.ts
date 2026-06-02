import path from 'path'
import fs from 'fs'
import { ipcMain, app, type DownloadItem, type BrowserWindow } from 'electron'
import { getMainWindow } from '../core/window'
import { isAllowedHttpDomain, isPathAllowed } from '../core/security'
import { IpcChannels } from '@shared/ipc-channels'

interface DownloadRequest {
  kind: 'start' | 'resume'
  downloadId: string
  url?: string
  fileName?: string
  saveDir?: string
  resumeData?: any
  autoResume?: boolean
}

const activeDownloads = new Map<string, DownloadItem>()
const pendingDownloadRequests: DownloadRequest[] = []
let registeredDownloadSession: Electron.Session | null = null

function emitDownloadEvent(payload: any) {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(IpcChannels.download.event, payload)
}

function enqueueDownloadRequest(request: DownloadRequest) {
  pendingDownloadRequests.push(request)
}

function removePendingDownloadRequest(downloadId: string) {
  const index = pendingDownloadRequests.findIndex(r => r.downloadId === downloadId)
  if (index !== -1) pendingDownloadRequests.splice(index, 1)
}

function takeDownloadRequest(item: DownloadItem) {
  const itemUrl = item.getURL()
  const itemUrlChain = Array.isArray(item.getURLChain()) ? item.getURLChain() : []
  const itemSavePath = item.getSavePath()

  let index = pendingDownloadRequests.findIndex(r =>
    r.kind === 'resume' && r.resumeData && r.resumeData.path === itemSavePath
  )
  if (index === -1) {
    index = pendingDownloadRequests.findIndex(r =>
      r.kind === 'start' && (r.url === itemUrl || itemUrlChain.includes(r.url!))
    )
  }
  if (index === -1) {
    index = pendingDownloadRequests.findIndex(r =>
      r.kind === 'resume' && r.resumeData && Array.isArray(r.resumeData.urlChain)
      && r.resumeData.urlChain.some((url: string) => url === itemUrl || itemUrlChain.includes(url))
    )
  }
  if (index === -1 && pendingDownloadRequests.length === 1) index = 0
  if (index === -1) return null
  return pendingDownloadRequests.splice(index, 1)[0]
}

function getDownloadPercent(receivedBytes: number, totalBytes: number) {
  if (!totalBytes || totalBytes <= 0) return 0
  return Math.min(100, (receivedBytes / totalBytes) * 100)
}

function buildResumeData(item: DownloadItem, fallbackData: any) {
  const savePath = item.getSavePath() || fallbackData?.path
  const currentUrlChain = item.getURLChain()
  const urlChain = Array.isArray(currentUrlChain) && currentUrlChain.length > 0 ? currentUrlChain : fallbackData?.urlChain
  const length = item.getTotalBytes() || fallbackData?.length || 0
  const offset = item.getReceivedBytes() || fallbackData?.offset || 0

  if (!savePath || !Array.isArray(urlChain) || urlChain.length === 0 || !Number.isFinite(length) || length <= 0) return undefined

  const mimeType = item.getMimeType() || fallbackData?.mimeType
  const lastModified = item.getLastModifiedTime() || fallbackData?.lastModified
  const eTag = item.getETag() || fallbackData?.eTag
  const startTime = item.getStartTime() || fallbackData?.startTime

  return {
    path: savePath, urlChain, offset, length,
    ...(mimeType ? { mimeType } : {}),
    ...(lastModified ? { lastModified } : {}),
    ...(eTag ? { eTag } : {}),
    ...(startTime ? { startTime } : {}),
  }
}

function attachDownloadItem(item: DownloadItem, request: DownloadRequest) {
  const fallbackResumeData = request.kind === 'resume' ? request.resumeData : undefined

  if (request.kind === 'start') {
    const downloadDir = request.saveDir || path.join(app.getPath('downloads'), 'MikuMod')
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true })
    item.setSavePath(path.join(downloadDir, request.fileName || item.getFilename()))
  }

  activeDownloads.set(request.downloadId, item)

  const emitState = (status: string, extra: any = {}) => {
    const receivedBytes = item.getReceivedBytes()
    const totalBytes = item.getTotalBytes()
    const resumeData = status === 'done' ? undefined : buildResumeData(item, fallbackResumeData)
    emitDownloadEvent({
      id: request.downloadId, status, receivedBytes, totalBytes,
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
      if (item.canResume() && resumeData) { emitState('paused'); return }
      emitDownloadEvent({
        id: request.downloadId, status: 'error', error: '连接中断',
        savePath: item.getSavePath(), ...(resumeData ? { resumeData } : {}),
      })
      return
    }
    if (state === 'progressing') emitState(item.isPaused() ? 'paused' : 'downloading')
  })

  item.once('done', (_event, state) => {
    activeDownloads.delete(request.downloadId)
    if (state === 'completed') { emitDownloadEvent({ id: request.downloadId, status: 'done', percent: 100, savePath: item.getSavePath() }); return }
    if (state === 'cancelled') return
    const resumeData = buildResumeData(item, fallbackResumeData)
    if (resumeData) {
      emitDownloadEvent({
        id: request.downloadId, status: 'paused',
        receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes(),
        percent: getDownloadPercent(item.getReceivedBytes(), item.getTotalBytes()),
        savePath: item.getSavePath(), resumeData,
      })
      return
    }
    emitDownloadEvent({ id: request.downloadId, status: 'error', error: `下载失败: ${state}`, savePath: item.getSavePath() })
  })
}

export function setupDownloadSessionHandlers(targetWindow: BrowserWindow) {
  const targetSession = targetWindow && !targetWindow.isDestroyed() ? targetWindow.webContents.session : null
  if (!targetSession || registeredDownloadSession === targetSession) return

  registeredDownloadSession = targetSession
  targetSession.on('will-download', (_event, item) => {
    const request = takeDownloadRequest(item)
    if (!request) return
    try {
      attachDownloadItem(item, request)
      if (request.kind === 'resume' && request.autoResume) {
        if (item.canResume()) { item.resume() } else {
          activeDownloads.delete(request.downloadId)
          emitDownloadEvent({
            id: request.downloadId, status: 'error', error: '当前下载不支持断点恢复',
            savePath: item.getSavePath() || request.resumeData?.path,
            ...(request.resumeData ? { resumeData: request.resumeData } : {}),
          })
        }
      }
    } catch (error: any) {
      activeDownloads.delete(request.downloadId)
      emitDownloadEvent({ id: request.downloadId, status: 'error', error: error?.message || '下载任务初始化失败' })
    }
  })
}

export function registerDownloadIPC() {
  ipcMain.handle(IpcChannels.download.start, async (_event, url: string, downloadId: string, fileName: string, saveDir: string) => {
    try {
      const win = getMainWindow()
      if (!win || win.isDestroyed()) throw new Error('主窗口不可用，无法启动下载')
      if (!isAllowedHttpDomain(url)) throw new Error('下载地址不在允许列表中')
      if (saveDir && !isPathAllowed(saveDir)) throw new Error('下载目录不在允许列表中')
      setupDownloadSessionHandlers(win)
      enqueueDownloadRequest({ kind: 'start', downloadId, url, fileName, saveDir })
      win.webContents.downloadURL(url)
    } catch (error: any) {
      console.error('start-download invoke fallback:', error)
      removePendingDownloadRequest(downloadId)
      emitDownloadEvent({ id: downloadId, status: 'error', error: error?.message || '下载启动失败' })
    }
  })

  ipcMain.handle(IpcChannels.download.pause, (_e, downloadId: string) => {
    try { const item = activeDownloads.get(downloadId); if (item && !item.isPaused()) item.pause() } catch {}
  })

  ipcMain.handle(IpcChannels.download.resume, async (_e, downloadId: string, resumeData: any) => {
    try {
      const item = activeDownloads.get(downloadId)
      if (item && item.canResume()) { item.resume(); return }

      const win = getMainWindow()
      if (!win || win.isDestroyed()) throw new Error('主窗口不可用，无法继续下载')
      if (!resumeData || !resumeData.path || !Array.isArray(resumeData.urlChain) || resumeData.urlChain.length === 0) throw new Error('缺少可恢复的下载信息')
      if (!isPathAllowed(resumeData.path)) throw new Error('恢复下载路径不在允许列表中')
      for (const resumeUrl of resumeData.urlChain) {
        if (!isAllowedHttpDomain(resumeUrl)) throw new Error('恢复下载地址不在允许列表中')
      }

      setupDownloadSessionHandlers(win)
      enqueueDownloadRequest({ kind: 'resume', downloadId, resumeData, autoResume: true })
      win.webContents.session.createInterruptedDownload(resumeData)
    } catch (error: any) {
      console.error('resume-download invoke fallback:', error)
      removePendingDownloadRequest(downloadId)
      emitDownloadEvent({
        id: downloadId, status: 'error', error: error?.message || '下载恢复失败',
        ...(resumeData ? { resumeData } : {}),
      })
    }
  })

  ipcMain.handle(IpcChannels.download.cancel, (_e, downloadId: string) => {
    try {
      removePendingDownloadRequest(downloadId)
      const item = activeDownloads.get(downloadId)
      if (item) { item.cancel(); activeDownloads.delete(downloadId) }
    } catch {}
  })
}
