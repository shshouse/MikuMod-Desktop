import path from 'path'
import fsPromises from 'fs/promises'
import { ipcMain, dialog, shell } from 'electron'
import { getMainWindow } from '../core/window'
import { isPathAllowed, authorizeBaseDir, normalizeBaseDir } from '../core/security'
import { getDesktopPaths } from '../core/paths'
import { IpcChannels } from '@shared/ipc-channels'

export function registerFilesystemIPC() {
  const paths = getDesktopPaths()

  ipcMain.handle(IpcChannels.filesystem.getAppDir, () => paths.appDir)
  ipcMain.handle(IpcChannels.filesystem.getAppDataDir, () => paths.dataDir)
  ipcMain.handle(IpcChannels.filesystem.getAppModsDir, () => paths.modsDir)
  ipcMain.handle(IpcChannels.filesystem.getAppBackupsDir, () => paths.backupsDir)

  const BLOCKED_DIR_PREFIXES = [
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\ProgramData',
    'C:\\$Recycle.Bin',
    'C:\\System Volume Information',
  ]

  ipcMain.handle(IpcChannels.filesystem.authorizeDirectory, async (_e, dirPath: string) => {
    try {
      const normalized = normalizeBaseDir(dirPath)
      if (!normalized) return false
      const lower = normalized.toLowerCase()
      if (BLOCKED_DIR_PREFIXES.some(p => lower.startsWith(p.toLowerCase()))) {
        console.warn(`authorize-directory blocked (system path): ${normalized}`)
        return false
      }
      const stat = await fsPromises.stat(normalized)
      if (!stat.isDirectory()) return false
      authorizeBaseDir(normalized)
      return true
    } catch { return false }
  })

  ipcMain.handle(IpcChannels.filesystem.selectDirectory, async () => {
    try {
      const win = getMainWindow()
      const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
      if (result.canceled) return null
      const selectedPath = result.filePaths[0]
      authorizeBaseDir(selectedPath)
      return selectedPath
    } catch (error) {
      console.error('select-directory error:', error)
      return null
    }
  })

  ipcMain.handle(IpcChannels.filesystem.selectModFile, async () => {
    try {
      const win = getMainWindow()
      const result = await dialog.showOpenDialog(win!, {
        properties: ['openFile'],
        filters: [
          { name: '支持的压缩包', extensions: ['zip', '7z', 'rar', 'tar', 'gz', 'tgz'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      })
      if (result.canceled) return null
      const selectedPath = result.filePaths[0]
      authorizeBaseDir(path.dirname(selectedPath))
      return selectedPath
    } catch (error) {
      console.error('select-mod-file error:', error)
      return null
    }
  })

  ipcMain.handle(IpcChannels.filesystem.openDirectory, async (_e, dirPath: string) => {
    try {
      if (!isPathAllowed(dirPath)) { console.warn(`open-directory blocked: ${dirPath}`); return }
      await shell.openPath(dirPath)
    } catch (error) { console.error('open-directory error:', error) }
  })

  ipcMain.handle(IpcChannels.filesystem.openExternal, async (_e, url: string) => {
    const { isAllowedExternalUrl } = await import('../core/security')
    try {
      if (!isAllowedExternalUrl(url)) { console.warn(`open-external blocked: ${url}`); return }
      await shell.openExternal(url)
    } catch (error) { console.error('open-external error:', error) }
  })

  ipcMain.handle(IpcChannels.filesystem.fileExists, async (_e, filePath: string) => {
    try {
      if (!isPathAllowed(filePath)) return false
      await fsPromises.access(filePath)
      return true
    } catch { return false }
  })

  ipcMain.handle(IpcChannels.filesystem.readFile, async (_e, filePath: string) => {
    try {
      if (!isPathAllowed(filePath)) { console.warn(`read-file blocked: ${filePath}`); return null }
      return await fsPromises.readFile(filePath, 'utf-8')
    } catch (error) { console.error(`read-file error (${filePath}):`, error); return null }
  })

  ipcMain.handle(IpcChannels.filesystem.writeFile, async (_e, filePath: string, content: string) => {
    try {
      if (!isPathAllowed(filePath)) { console.warn(`write-file blocked: ${filePath}`); return false }
      await fsPromises.mkdir(path.dirname(filePath), { recursive: true })
      await fsPromises.writeFile(filePath, content, 'utf-8')
      return true
    } catch (error) { console.error(`write-file error (${filePath}):`, error); return false }
  })

  ipcMain.handle(IpcChannels.filesystem.scanDirectory, async (_e, dirPath: string) => {
    try {
      if (!isPathAllowed(dirPath)) { console.warn(`scan-directory blocked: ${dirPath}`); return [] }
      const entries = await fsPromises.readdir(dirPath, { withFileTypes: true })
      return entries.filter(e => e.isDirectory()).map(e => e.name)
    } catch (error) { console.error(`scan-directory error (${dirPath}):`, error); return [] }
  })

  ipcMain.handle(IpcChannels.filesystem.copyFile, async (_e, srcPath: string, destPath: string) => {
    try {
      if (!isPathAllowed(srcPath)) { console.warn(`copy-file src blocked: ${srcPath}`); return false }
      if (!isPathAllowed(destPath)) { console.warn(`copy-file dest blocked: ${destPath}`); return false }
      await fsPromises.mkdir(path.dirname(destPath), { recursive: true })
      await fsPromises.copyFile(srcPath, destPath)
      return true
    } catch (error) { console.error(`copy-file error (${srcPath} -> ${destPath}):`, error); return false }
  })

  ipcMain.handle(IpcChannels.filesystem.deleteFile, async (_e, filePath: string) => {
    try {
      if (!isPathAllowed(filePath)) { console.warn(`delete-file blocked: ${filePath}`); return false }
      await fsPromises.unlink(filePath)
      return true
    } catch (error: any) {
      if (error.code !== 'ENOENT') console.error(`delete-file error (${filePath}):`, error)
      return false
    }
  })
}
