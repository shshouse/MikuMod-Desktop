import path from 'path'
import fsPromises from 'fs/promises'
import { STATE_VERSION } from './constants'
import { sanitizeSegment, ensureDir, pathExists, copyFileSafe, removeFileIfExists, createId } from './utils'
import type { GameDirs, ModState } from './types'

export function getAppBaseDir(app: Electron.App) {
  return app.isPackaged ? path.dirname(app.getPath('exe')) : path.resolve(__dirname, '..')
}

export function getGameDirs(app: Electron.App, gameName: string, modsRootDir?: string, backupsRootDir?: string): GameDirs {
  const rootDir = path.resolve(modsRootDir || path.join(getAppBaseDir(app), 'mods'))
  const gameFolder = sanitizeSegment(gameName)
  // ponytail: 非 USER 游戏的 mod 统一进 mods/<gameFolder>/, 不再散落 mods/ 根
  const gameDir = gameName === 'USER' ? path.join(rootDir, 'user') : path.join(rootDir, gameFolder)
  const systemDir = gameName === 'USER' ? path.join(gameDir, '_system') : path.join(gameDir, '_system')

  const backupsRoot = path.resolve(backupsRootDir || path.join(getAppBaseDir(app), 'backups'))
  const backupsDir = path.join(backupsRoot, gameFolder)

  return {
    rootDir,
    gameFolder,
    gameDir,
    systemDir,
    backupsDir,
    tempDir: path.join(systemDir, 'temp'),
    statePath: path.join(systemDir, 'state.json'),
    stateBackupPath: path.join(systemDir, 'state.last-good.json'),
  }
}

export async function ensureGameDirs(dirs: GameDirs) {
  await Promise.all([
    ensureDir(dirs.rootDir),
    ensureDir(dirs.gameDir),
    ensureDir(dirs.systemDir),
    ensureDir(dirs.backupsDir),
    ensureDir(dirs.tempDir),
  ])
}

function createEmptyState(gameId: string, gameName: string): ModState {
  return { version: STATE_VERSION, gameId, gameName, mods: {}, files: {} }
}

function normalizeState(parsed: any, gameId: string, gameName: string): ModState {
  return {
    version: parsed?.version || STATE_VERSION,
    gameId: parsed?.gameId || gameId,
    gameName: parsed?.gameName || gameName,
    mods: parsed?.mods || {},
    files: parsed?.files || {},
  }
}

async function readStateFile(filePath: string, gameId: string, gameName: string) {
  const raw = await fsPromises.readFile(filePath, 'utf-8')
  return normalizeState(JSON.parse(raw), gameId, gameName)
}

async function replaceStateFile(tempPath: string, targetPath: string) {
  try { await fsPromises.rename(tempPath, targetPath); return } catch (error: any) {
    if (!error || (error.code !== 'EEXIST' && error.code !== 'EPERM')) throw error
  }
  await removeFileIfExists(targetPath)
  await fsPromises.rename(tempPath, targetPath)
}

export async function loadState(dirs: GameDirs, gameId: string, gameName: string): Promise<ModState> {
  await ensureGameDirs(dirs)
  if (await pathExists(dirs.statePath)) {
    try { return await readStateFile(dirs.statePath, gameId, gameName) } catch {}
  }
  if (await pathExists(dirs.stateBackupPath)) {
    try {
      const recovered = await readStateFile(dirs.stateBackupPath, gameId, gameName)
      await copyFileSafe(dirs.stateBackupPath, dirs.statePath)
      return recovered
    } catch {}
  }
  return createEmptyState(gameId, gameName)
}

export async function saveState(dirs: GameDirs, state: ModState) {
  await ensureGameDirs(dirs)
  const serialized = JSON.stringify(state, null, 2)
  const tempPath = path.join(dirs.systemDir, `state.${createId('tmp')}.json.tmp`)
  await fsPromises.writeFile(tempPath, serialized, 'utf-8')
  if (await pathExists(dirs.statePath)) {
    await copyFileSafe(dirs.statePath, dirs.stateBackupPath)
  }
  try {
    await replaceStateFile(tempPath, dirs.statePath)
  } catch (error) {
    await removeFileIfExists(tempPath)
    if (!(await pathExists(dirs.statePath)) && (await pathExists(dirs.stateBackupPath))) {
      await copyFileSafe(dirs.stateBackupPath, dirs.statePath).catch(() => {})
    }
    throw error
  }
  await copyFileSafe(dirs.statePath, dirs.stateBackupPath)
}
