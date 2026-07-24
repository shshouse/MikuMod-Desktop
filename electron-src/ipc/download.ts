import path from 'path'
import { ipcMain, app } from 'electron'
import { getMainWindow } from '../core/window'
import { isAllowedHttpDomain, isPathAllowed } from '../core/security'
import { IpcChannels } from '@shared/ipc-channels'
import { MultiDownload } from './multi-download'
import type { DownloadResumeData } from '@shared/electron-api'

const activeDownloads = new Map<string, MultiDownload>()

function emitDownloadEvent(payload: any) {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(IpcChannels.download.event, payload)
}

function getDownloadPercent(receivedBytes: number, totalBytes: number) {
  if (!totalBytes || totalBytes <= 0) return 0
  return Math.min(100, (receivedBytes / totalBytes) * 100)
}

function startMultiDownload(url: string, downloadId: string, fileName: string, saveDir: string, resumeData?: DownloadResumeData) {
  const safeFileName = path.basename(fileName || 'download')
  const downloader = new MultiDownload({
    url,
    fileName: safeFileName,
    saveDir,
    resumeData,
    onProgress: ({ receivedBytes, totalBytes, percent }) => {
      emitDownloadEvent({
        id: downloadId,
        status: 'downloading',
        receivedBytes,
        totalBytes,
        percent,
        savePath: path.join(saveDir, safeFileName),
      })
    },
    onPaused: (resumeData) => {
      activeDownloads.delete(downloadId)
      const receivedBytes = resumeData.segments.reduce((sum, s) => sum + s.received, 0)
      emitDownloadEvent({
        id: downloadId,
        status: 'paused',
        receivedBytes,
        totalBytes: resumeData.totalLength,
        percent: getDownloadPercent(receivedBytes, resumeData.totalLength),
        savePath: resumeData.path,
        resumeData,
      })
    },
    onDone: (savePath) => {
      activeDownloads.delete(downloadId)
      emitDownloadEvent({ id: downloadId, status: 'done', percent: 100, savePath })
    },
    onError: (error) => {
      activeDownloads.delete(downloadId)
      emitDownloadEvent({ id: downloadId, status: 'error', error })
    },
  })
  activeDownloads.set(downloadId, downloader)
  void downloader.start()
}

export function registerDownloadIPC() {
  ipcMain.handle(IpcChannels.download.start, async (_event, url: string, downloadId: string, fileName: string, saveDir: string) => {
    try {
      if (!isAllowedHttpDomain(url)) throw new Error('下载地址不在允许列表中')
      if (saveDir && !isPathAllowed(saveDir)) throw new Error('下载目录不在允许列表中')
      const defaultDir = path.join(app.getPath('downloads'), 'MikuMod')
      const finalSaveDir = saveDir || defaultDir
      startMultiDownload(url, downloadId, fileName, finalSaveDir)
    } catch (error: any) {
      emitDownloadEvent({ id: downloadId, status: 'error', error: error?.message || '下载启动失败' })
    }
  })

  ipcMain.handle(IpcChannels.download.pause, (_e, downloadId: string) => {
    try { activeDownloads.get(downloadId)?.pause() } catch {}
  })

  ipcMain.handle(IpcChannels.download.resume, async (_e, downloadId: string, resumeData: any) => {
    try {
      if (!resumeData || resumeData.version !== 2 || !resumeData.url || !resumeData.path || !resumeData.partPath || !Array.isArray(resumeData.segments)) {
        throw new Error('缺少可恢复的下载信息')
      }
      if (!isAllowedHttpDomain(resumeData.url)) throw new Error('恢复下载地址不在允许列表中')
      if (!isPathAllowed(resumeData.path) || !isPathAllowed(resumeData.partPath)) throw new Error('恢复下载路径不在允许列表中')
      const fileName = path.basename(resumeData.path)
      const saveDir = path.dirname(resumeData.path)
      startMultiDownload(resumeData.url, downloadId, fileName, saveDir, resumeData)
    } catch (error: any) {
      emitDownloadEvent({ id: downloadId, status: 'error', error: error?.message || '下载恢复失败' })
    }
  })

  ipcMain.handle(IpcChannels.download.cancel, (_e, downloadId: string) => {
    try {
      const downloader = activeDownloads.get(downloadId)
      if (downloader) {
        downloader.cancel()
        activeDownloads.delete(downloadId)
      }
    } catch {}
  })
}
