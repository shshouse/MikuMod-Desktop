import path from 'path'
import fs from 'fs'
import { ipcMain, app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { getMainWindow } from '../core/window'
import { getDesktopPaths } from '../core/paths'
import { IpcChannels } from '@shared/ipc-channels'

const ALLOWED_CHANNELS = new Set(['stable', 'beta', 'alpha'])

function getChannelFile() {
  return path.join(getDesktopPaths().dataDir, 'update-channel.txt')
}

function readChannel() {
  try {
    const v = fs.readFileSync(getChannelFile(), 'utf-8').trim()
    if (ALLOWED_CHANNELS.has(v)) return v
  } catch {}
  return 'stable'
}

function writeChannel(channel: string) {
  if (!ALLOWED_CHANNELS.has(channel)) return false
  try { fs.writeFileSync(getChannelFile(), channel, 'utf-8'); return true } catch { return false }
}

export function initAutoUpdater() {
  if (!autoUpdater) return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  autoUpdater.channel = readChannel()

  const sendEvent = (payload: any) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IpcChannels.updater.event, payload)
  }

  autoUpdater.on('update-available', (info: any) => sendEvent({ type: 'update-available', info }))
  autoUpdater.on('update-not-available', () => sendEvent({ type: 'update-not-available' }))
  autoUpdater.on('download-progress', (progress: any) => sendEvent({ type: 'download-progress', progress }))
  autoUpdater.on('update-downloaded', (info: any) => sendEvent({ type: 'update-downloaded', info }))
  autoUpdater.on('error', (err: any) => sendEvent({ type: 'error', error: err?.message || String(err) }))
}

export function registerUpdaterIPC() {
  ipcMain.handle(IpcChannels.updater.check, async () => {
    if (!autoUpdater) return { available: false, reason: 'updater-not-available' }
    try {
      const result = await autoUpdater.checkForUpdates()
      return { available: !!result?.updateInfo, info: result?.updateInfo }
    } catch (err: any) { return { available: false, reason: err?.message || String(err) } }
  })

  ipcMain.handle(IpcChannels.updater.download, async () => {
    if (!autoUpdater) return false
    try { await autoUpdater.downloadUpdate(); return true } catch { return false }
  })

  ipcMain.handle(IpcChannels.updater.install, () => {
    if (!autoUpdater) return
    autoUpdater.quitAndInstall(false, true)
  })

  ipcMain.handle(IpcChannels.appVersion, () => app.getVersion())
  ipcMain.handle(IpcChannels.updater.getChannel, () => readChannel())

  ipcMain.handle(IpcChannels.updater.setChannel, (_event, channel: string) => {
    if (!writeChannel(channel)) return { success: false }
    if (autoUpdater) autoUpdater.channel = channel
    return { success: true }
  })
}
