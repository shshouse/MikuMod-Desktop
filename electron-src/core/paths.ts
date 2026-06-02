import path from 'path'
import fs from 'fs'
import { app } from 'electron'

export interface DesktopPaths {
  appDir: string
  dataDir: string
  logsDir: string
  modsDir: string
  backupsDir: string
}

function getAppBaseDir() {
  return app.isPackaged ? path.dirname(app.getPath('exe')) : path.resolve(__dirname, '..')
}

function canWriteDirectory(dirPath: string) {
  try {
    fs.mkdirSync(dirPath, { recursive: true })
    const testPath = path.join(dirPath, `.write-test-${process.pid}`)
    fs.writeFileSync(testPath, 'ok')
    fs.unlinkSync(testPath)
    return true
  } catch { return false }
}

let _paths: DesktopPaths | null = null

export function initializeDesktopPaths(): DesktopPaths {
  if (_paths) return _paths
  const appDir = getAppBaseDir()
  const preferredDataDir = path.join(appDir, 'data')
  const fallbackDataDir = app.getPath('userData')
  const dataDir = canWriteDirectory(preferredDataDir) ? preferredDataDir : fallbackDataDir
  const logsDir = path.join(dataDir, 'logs')
  const preferredModsDir = path.join(appDir, 'mods')
  const modsDir = canWriteDirectory(preferredModsDir) ? preferredModsDir : path.join(dataDir, 'mods')
  const preferredBackupsDir = path.join(appDir, 'backups')
  const backupsDir = canWriteDirectory(preferredBackupsDir) ? preferredBackupsDir : path.join(dataDir, 'backups')

  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(logsDir, { recursive: true })
  fs.mkdirSync(modsDir, { recursive: true })
  fs.mkdirSync(backupsDir, { recursive: true })
  app.setPath('userData', dataDir)
  app.setPath('logs', logsDir)

  _paths = { appDir, dataDir, logsDir, modsDir, backupsDir }
  return _paths
}

export function getDesktopPaths() {
  if (!_paths) throw new Error('DesktopPaths not initialized')
  return _paths
}
