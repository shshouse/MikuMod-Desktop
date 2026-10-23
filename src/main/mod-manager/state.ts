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

/** 状态文件存在但无法解析时抛出，避免被当作"首次运行"而用空状态覆盖真实记录 */
export class StateCorruptedError extends Error {
  readonly code = 'STATE_CORRUPTED'
  readonly statePath: string
  readonly backupPath: string
  constructor(statePath: string, backupPath: string, cause?: unknown) {
    super(
      `模组状态文件损坏，已停止写入以保护原有记录。` +
        `请检查 ${statePath} 或 ${backupPath}；确认丢失后调用 resetCorruptedState 重置。`,
    )
    this.name = 'StateCorruptedError'
    this.statePath = statePath
    this.backupPath = backupPath
    if (cause) (this as any).cause = cause
  }
}

export type StateLoadResult =
  | { status: 'missing'; state: ModState }
  | { status: 'ok'; state: ModState }
  | { status: 'recovered'; state: ModState }
  | { status: 'corrupted'; error: StateCorruptedError }

/** 拦截 JSON 合法但结构不对的情况（例如被截断成 `{}`），否则会静默丢光记录 */
function isPlausibleState(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  const mods = (parsed as any).mods
  if (mods !== undefined && (mods === null || typeof mods !== 'object' || Array.isArray(mods))) return false
  const files = (parsed as any).files
  if (files !== undefined && (files === null || typeof files !== 'object' || Array.isArray(files))) return false
  return true
}

async function readStateFile(filePath: string, gameId: string, gameName: string) {
  const raw = await fsPromises.readFile(filePath, 'utf-8')
  const parsed = JSON.parse(raw)
  if (!isPlausibleState(parsed)) throw new Error(`状态文件结构异常: ${filePath}`)
  return normalizeState(parsed, gameId, gameName)
}

async function replaceStateFile(tempPath: string, targetPath: string) {
  try { await fsPromises.rename(tempPath, targetPath); return } catch (error: any) {
    if (!error || (error.code !== 'EEXIST' && error.code !== 'EPERM')) throw error
  }
  await removeFileIfExists(targetPath)
  await fsPromises.rename(tempPath, targetPath)
}

/**
 * 读取状态并区分四种情况：不存在（首次运行）/ 正常 / 从备份恢复 / 损坏。
 * 只有"不存在"才允许自动创建空状态；损坏必须由调用方显式处理。
 */
export async function tryLoadState(dirs: GameDirs, gameId: string, gameName: string): Promise<StateLoadResult> {
  await ensureGameDirs(dirs)
  const hasState = await pathExists(dirs.statePath)
  const hasBackup = await pathExists(dirs.stateBackupPath)

  if (!hasState && !hasBackup) {
    return { status: 'missing', state: createEmptyState(gameId, gameName) }
  }

  let lastError: unknown
  if (hasState) {
    try {
      return { status: 'ok', state: await readStateFile(dirs.statePath, gameId, gameName) }
    } catch (error) { lastError = error }
  }
  if (hasBackup) {
    try {
      const recovered = await readStateFile(dirs.stateBackupPath, gameId, gameName)
      await copyFileSafe(dirs.stateBackupPath, dirs.statePath)
      return { status: 'recovered', state: recovered }
    } catch (error) { lastError = error }
  }
  return { status: 'corrupted', error: new StateCorruptedError(dirs.statePath, dirs.stateBackupPath, lastError) }
}

/** 损坏时抛错而不是返回空状态：宁可让写操作失败，也不能覆盖用户既有的所有权记录 */
export async function loadState(dirs: GameDirs, gameId: string, gameName: string): Promise<ModState> {
  const result = await tryLoadState(dirs, gameId, gameName)
  if (result.status === 'corrupted') throw result.error
  return result.state
}

/**
 * 显式重置损坏状态：把两个文件改名保留（不删除），再创建空状态。
 * 只能由用户明确操作触发，绝不能在 loadState 里自动执行。
 */
export async function resetCorruptedState(dirs: GameDirs, gameId: string, gameName: string): Promise<{ moved: string[] }> {
  await ensureGameDirs(dirs)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const moved: string[] = []
  for (const filePath of [dirs.statePath, dirs.stateBackupPath]) {
    if (!(await pathExists(filePath))) continue
    const target = `${filePath}.corrupt-${stamp}`
    try { await fsPromises.rename(filePath, target); moved.push(target) } catch {}
  }
  await saveState(dirs, createEmptyState(gameId, gameName))
  return { moved }
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
