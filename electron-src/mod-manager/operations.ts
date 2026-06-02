import path from 'path'
import fsPromises from 'fs/promises'
import { SKIPPED_INSTALL_FILENAMES } from './constants'
import {
  sanitizeSegment, createId, createStableHash,
  pathExists, ensureDir, removePath, removeFileIfExists,
  copyFileSafe, copyDirectoryContents, listFilesRecursive,
  hashFile, extractArchive, resolveContentRoot, resolveDownloadedContentRoot,
  deepClone,
} from './utils'
import { getGameDirs, loadState, saveState, ensureGameDirs } from './state'
import { buildManifest, writeManifest, getManifestIndexByModId } from './manifest'
import type { ModRecord, ModState, ModSummary, ManifestIndex, ImportInput, InstallInput, UninstallInput, ListInput, GameDirs } from './types'

// --- 冲突检测 ---

function shouldSkipInstallFile(relativePath: string) {
  const fileName = String(relativePath || '').split('/').pop()?.toLowerCase() || ''
  return SKIPPED_INSTALL_FILENAMES.has(fileName)
}

function listModRecords(state: ModState): ModRecord[] {
  return Object.values(state.mods || {})
}

function toSummary(modRecord: ModRecord, conflicts: string[]): ModSummary {
  return {
    id: modRecord.id,
    name: modRecord.name,
    gameId: modRecord.gameId,
    gameName: modRecord.gameName,
    sourceType: modRecord.sourceType,
    importedAt: modRecord.importedAt,
    installed: Boolean(modRecord.installed),
    installedAt: modRecord.installedAt || null,
    fileCount: Number(modRecord.fileCount || 0),
    conflictCount: conflicts.length,
    conflicts,
    libraryPath: modRecord.libraryPath,
    folderName: modRecord.folderName,
    platformModId: modRecord.platformModId || null,
    platformVersionId: modRecord.platformVersionId || null,
    modNumber: modRecord.modNumber || null,
  }
}

async function computeConflictPaths(state: ModState, modRecord: ModRecord, cache: Map<string, ManifestIndex>) {
  const indexedManifest = await getManifestIndexByModId(state, modRecord.id, cache)
  const conflicts: string[] = []

  for (const file of indexedManifest.manifest.files || []) {
    if (shouldSkipInstallFile(file.relativePath)) continue
    const key = String(file.relativePath || '').toLowerCase()
    const record = state.files[key]
    if (!record || !Array.isArray(record.owners) || record.owners.length === 0) continue
    const otherOwners = record.owners.filter(id => id !== modRecord.id)
    if (otherOwners.length === 0) continue
    const topOwnerId = otherOwners[otherOwners.length - 1]
    const topManifest = await getManifestIndexByModId(state, topOwnerId, cache)
    const topFile = topManifest.filesByKey.get(key)
    if (!topFile || topFile.sha256 !== file.sha256) conflicts.push(file.relativePath)
  }

  return conflicts.sort((a, b) => a.localeCompare(b))
}

// --- 路径安全 ---

function resolveGamePathTarget(gamePath: string, relativePath: string) {
  const absoluteGamePath = path.resolve(gamePath)
  const targetPath = path.resolve(absoluteGamePath, ...relativePath.split('/'))
  if (targetPath !== absoluteGamePath && !targetPath.startsWith(`${absoluteGamePath}${path.sep}`)) {
    throw new Error(`非法目标路径: ${relativePath}`)
  }
  return targetPath
}

function assertManagedGamePath(state: ModState, gamePath: string) {
  const normalized = path.resolve(gamePath)
  const installedMods = Object.values(state.mods || {}).filter(m => m.installed && m.lastGamePath)
  const mismatch = installedMods.find(m => path.resolve(m.lastGamePath!) !== normalized)
  if (mismatch) {
    throw new Error('检测到当前游戏目录与已记录的安装目录不一致。为避免错误恢复文件，请先切回原目录后再安装或卸载。')
  }
}

async function ensureUniqueFolder(gameDir: string, preferredName: string) {
  const baseName = sanitizeSegment(preferredName)
  let candidate = baseName
  let counter = 2
  while (await pathExists(path.join(gameDir, candidate))) {
    candidate = `${baseName}-${counter}`
    counter += 1
  }
  return candidate
}

// --- 文件恢复 ---

async function ensureRecordMatchesActiveFile(record: any, state: ModState, cache: Map<string, ManifestIndex>, gamePath: string) {
  if (!record || !Array.isArray(record.owners) || record.owners.length === 0) return
  const activeModId = record.owners[record.owners.length - 1]
  const manifestIndex = await getManifestIndexByModId(state, activeModId, cache)
  const expectedFile = manifestIndex.filesByKey.get(String(record.relativePath || '').toLowerCase())
  if (!expectedFile) return
  const targetPath = resolveGamePathTarget(gamePath, record.relativePath)
  if (!(await pathExists(targetPath))) throw new Error(`检测到游戏文件已丢失: ${record.relativePath}`)
  const currentHash = await hashFile(targetPath)
  if (currentHash !== expectedFile.sha256) throw new Error(`检测到游戏文件已被外部修改: ${record.relativePath}`)
}

async function restoreRecordToDisk(record: any, state: ModState, cache: Map<string, ManifestIndex>, dirs: GameDirs, gamePath: string) {
  const targetPath = resolveGamePathTarget(gamePath, record.relativePath)
  if (Array.isArray(record.owners) && record.owners.length > 0) {
    const activeModId = record.owners[record.owners.length - 1]
    const activeMod = state.mods[activeModId]
    if (!activeMod) throw new Error(`缺少模组记录: ${activeModId}`)
    const sourcePath = path.join(activeMod.libraryPath, ...record.relativePath.split('/'))
    await copyFileSafe(sourcePath, targetPath)
    return
  }
  if (record.original?.type === 'file' && record.original.backupRelativePath) {
    const backupPath = path.join(dirs.backupsDir, record.original.backupRelativePath)
    await copyFileSafe(backupPath, targetPath)
    return
  }
  if (record.original?.type === 'absent') await removeFileIfExists(targetPath)
}

// --- 导入 ---

function resolveImportName(input: ImportInput) {
  if (input.modName && String(input.modName).trim()) return String(input.modName).trim()
  const baseName = path.basename(input.sourcePath)
  const ext = path.extname(baseName)
  return ext ? baseName.slice(0, -ext.length) : baseName
}

export async function importExternalMod(app: Electron.App, input: ImportInput, modsRootDir: string, backupsRootDir?: string): Promise<ModSummary> {
  const dirs = getGameDirs(app, input.gameName, modsRootDir, backupsRootDir)
  const state = await loadState(dirs, input.gameId, input.gameName)
  const isArchive = input.sourceType === 'archive' || input.sourceType === 'download'

  if (!(await pathExists(input.sourcePath))) throw new Error('导入源不存在')

  const existingForPlatform = (input.sourceType === 'download' && input.platformModId)
    ? listModRecords(state).find(m => m.sourceType === 'download' && m.platformModId === input.platformModId)
    : null

  if (existingForPlatform && input.platformVersionId && existingForPlatform.platformVersionId === input.platformVersionId) {
    const cache = new Map<string, ManifestIndex>()
    const conflicts = await computeConflictPaths(state, existingForPlatform, cache)
    return toSummary(existingForPlatform, conflicts)
  }

  if (existingForPlatform && existingForPlatform.installed) throw new Error('请先卸载当前版本后再升级')

  const tempRoot = path.join(dirs.tempDir, createId('import'))
  const tempSourceDir = path.join(tempRoot, 'source')
  const tempExtractDir = path.join(tempRoot, 'extract')

  try {
    await ensureDir(tempRoot)

    if (isArchive) {
      await extractArchive(input.sourcePath, tempExtractDir)
      const contentRoot = input.sourceType === 'download'
        ? await resolveDownloadedContentRoot(tempExtractDir, input)
        : await resolveContentRoot(tempExtractDir)
      await copyDirectoryContents(contentRoot, tempSourceDir)
    } else {
      await copyDirectoryContents(input.sourcePath, tempSourceDir)
    }

    const importedFiles = await listFilesRecursive(tempSourceDir)
    if (importedFiles.length === 0) throw new Error('导入源中未找到可安装文件')

    let modRecord: ModRecord
    let modDir: string
    let sourceDir: string

    if (existingForPlatform) {
      modRecord = existingForPlatform
      modDir = existingForPlatform.libraryPath
      sourceDir = modDir
      await removePath(sourceDir)
      const entries = await fsPromises.readdir(modDir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (entry.isFile() && entry.name.startsWith('original.')) {
          await removeFileIfExists(path.join(modDir, entry.name))
        }
      }
    } else {
      // 平台模组：固定目录为 mods/<modNumber>
  // 用户导入：由上层传入 gameName='USER' 并在 getGameDirs 中落到 mods/user
  const hasFixedPlatformFolder = input.sourceType === 'download' && input.modNumber && input.gameName !== 'USER'
      const preferredName = hasFixedPlatformFolder ? String(input.modNumber) : resolveImportName(input)
      const folderName = hasFixedPlatformFolder ? sanitizeSegment(preferredName) : await ensureUniqueFolder(dirs.gameDir, preferredName)
      modDir = path.join(dirs.gameDir, folderName)
      sourceDir = modDir
      await ensureDir(modDir)
      await removePath(sourceDir)
      modRecord = {
        id: createId('mod'),
        name: resolveImportName(input),
        gameId: input.gameId,
        gameName: input.gameName,
        sourceType: input.sourceType,
        importedAt: new Date().toISOString(),
        installed: false,
        installedAt: null,
        fileCount: 0,
        libraryPath: modDir,
        folderName,
        platformModId: input.platformModId || null,
        platformVersionId: input.platformVersionId || null,
        modNumber: input.modNumber || null,
        lastGamePath: null,
      }
    }

    try {
      await fsPromises.rename(tempSourceDir, sourceDir)
    } catch (renameErr: any) {
      if (renameErr.code === 'EPERM' || renameErr.code === 'EACCES' || renameErr.code === 'EXDEV') {
        await copyDirectoryContents(tempSourceDir, sourceDir)
      } else { throw renameErr }
    }

    if (isArchive) {
      const ext = path.extname(input.sourcePath) || '.zip'
      const originalPath = path.join(modDir, `original${ext.toLowerCase()}`)
      if (path.resolve(input.sourcePath) !== path.resolve(originalPath)) {
        await copyFileSafe(input.sourcePath, originalPath)
      }
    }

    if (existingForPlatform) {
      modRecord.name = resolveImportName(input) || modRecord.name
      modRecord.platformVersionId = input.platformVersionId || null
      modRecord.modNumber = input.modNumber || modRecord.modNumber || null
      modRecord.importedAt = new Date().toISOString()
    }

    const manifest = await buildManifest(modRecord)
    modRecord.fileCount = manifest.fileCount
    await writeManifest(modDir, manifest)

    state.mods[modRecord.id] = modRecord
    await saveState(dirs, state)

    const cache = new Map<string, ManifestIndex>()
    const conflicts = await computeConflictPaths(state, modRecord, cache)
    return toSummary(modRecord, conflicts)
  } finally {
    await removePath(tempRoot)
  }
}

export async function importDownloadedArchive(app: Electron.App, input: any, modsRootDir: string, backupsRootDir?: string) {
  return importExternalMod(app, {
    gameId: input.gameId,
    gameName: input.gameName,
    sourcePath: input.sourcePath,
    sourceType: 'download',
    modName: input.modName,
    platformModId: input.platformModId,
    platformVersionId: input.platformVersionId,
    modNumber: input.modNumber,
    archiveFileName: input.archiveFileName,
  }, modsRootDir, backupsRootDir)
}

// --- 列表 ---

export async function listManagedMods(app: Electron.App, input: ListInput, modsRootDir: string, backupsRootDir?: string) {
  const dirs = getGameDirs(app, input.gameName, modsRootDir, backupsRootDir)
  const state = await loadState(dirs, input.gameId, input.gameName)
  const cache = new Map<string, ManifestIndex>()
  const summaries: ModSummary[] = []

  for (const modRecord of listModRecords(state)) {
    try {
      const conflicts = await computeConflictPaths(state, modRecord, cache)
      summaries.push(toSummary(modRecord, conflicts))
    } catch {
      summaries.push(toSummary(modRecord, []))
    }
  }

  return summaries.sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1
    return b.importedAt.localeCompare(a.importedAt)
  })
}

// --- 安装 ---

export async function installManagedMod(app: Electron.App, input: InstallInput, modsRootDir: string, backupsRootDir?: string) {
  const dirs = getGameDirs(app, input.gameName, modsRootDir, backupsRootDir)
  const state = await loadState(dirs, input.gameId, input.gameName)
  const modRecord = state.mods[input.modId]

  if (!modRecord) return { ok: false, error: '模组不存在', conflicts: [], installedPaths: 0 }

  assertManagedGamePath(state, input.gamePath)

  const manifestIndex = await getManifestIndexByModId(state, input.modId, new Map())
  if (!manifestIndex.manifest.files?.length) return { ok: false, error: '模组文件清单为空', conflicts: [], installedPaths: 0 }

  const cache = new Map<string, ManifestIndex>([[input.modId, manifestIndex]])
  const stagedRecords: [string, any][] = []
  const stagedWrites: { sourcePath: string; targetPath: string }[] = []
  const conflicts: string[] = []

  for (const file of manifestIndex.manifest.files) {
    if (shouldSkipInstallFile(file.relativePath)) continue
    const key = String(file.relativePath || '').toLowerCase()
    const targetPath = resolveGamePathTarget(input.gamePath, file.relativePath)
    const sourcePath = path.join(modRecord.libraryPath, ...file.relativePath.split('/'))
    const currentRecord = state.files[key]
      ? deepClone(state.files[key])
      : { relativePath: file.relativePath, owners: [], original: null }

    if (currentRecord.owners.length > 0) {
      await ensureRecordMatchesActiveFile(currentRecord, state, cache, input.gamePath)
      const previousOwnerId = currentRecord.owners[currentRecord.owners.length - 1]
      if (previousOwnerId !== input.modId) {
        const previousManifest = await getManifestIndexByModId(state, previousOwnerId, cache)
        const previousFile = previousManifest.filesByKey.get(key)
        if (!previousFile || previousFile.sha256 !== file.sha256) conflicts.push(file.relativePath)
      }
    } else {
      const targetExists = await pathExists(targetPath)
      if (targetExists) {
        const backupRelativePath = `${createStableHash(file.relativePath)}${path.extname(file.relativePath)}`
        const backupPath = path.join(dirs.backupsDir, backupRelativePath)
        if (!(await pathExists(backupPath))) await copyFileSafe(targetPath, backupPath)
        currentRecord.original = { type: 'file', backupRelativePath }
      } else {
        currentRecord.original = { type: 'absent' }
      }
    }

    currentRecord.owners = currentRecord.owners.filter((id: string) => id !== input.modId)
    currentRecord.owners.push(input.modId)
    stagedRecords.push([key, currentRecord])
    stagedWrites.push({ sourcePath, targetPath })
  }

  for (const item of stagedWrites) await copyFileSafe(item.sourcePath, item.targetPath)
  for (const [key, record] of stagedRecords) state.files[key] = record

  modRecord.installed = true
  modRecord.installedAt = new Date().toISOString()
  modRecord.lastGamePath = input.gamePath
  state.mods[input.modId] = modRecord
  await saveState(dirs, state)

  return {
    ok: true,
    conflicts: conflicts.sort((a, b) => a.localeCompare(b)),
    installedPaths: stagedWrites.length,
    mod: toSummary(modRecord, conflicts),
  }
}

// --- 卸载 ---

export async function uninstallManagedMod(app: Electron.App, input: UninstallInput, modsRootDir: string, backupsRootDir?: string) {
  const dirs = getGameDirs(app, input.gameName, modsRootDir, backupsRootDir)
  const state = await loadState(dirs, input.gameId, input.gameName)
  const modRecord = state.mods[input.modId]

  if (!modRecord) return { ok: false, error: '模组不存在', restoredPaths: 0 }

  assertManagedGamePath(state, input.gamePath)

  const manifestIndex = await getManifestIndexByModId(state, input.modId, new Map())
  if (!manifestIndex.manifest.files?.length) {
    modRecord.installed = false
    modRecord.installedAt = null
    state.mods[input.modId] = modRecord
    await saveState(dirs, state)
    return { ok: true, restoredPaths: 0, mod: toSummary(modRecord, []) }
  }

  const cache = new Map<string, ManifestIndex>([[input.modId, manifestIndex]])
  const stagedRecords: { key: string; record: any }[] = []
  let restoredPaths = 0

  for (const file of manifestIndex.manifest.files) {
    const key = String(file.relativePath || '').toLowerCase()
    const record = state.files[key]
    if (!record) continue
    await ensureRecordMatchesActiveFile(record, state, cache, input.gamePath)
    const nextRecord = deepClone(record)
    nextRecord.owners = Array.isArray(nextRecord.owners) ? nextRecord.owners.filter((id: string) => id !== input.modId) : []
    stagedRecords.push({ key, record: nextRecord })
  }

  for (const item of stagedRecords) {
    await restoreRecordToDisk(item.record, state, cache, dirs, input.gamePath)
    restoredPaths += 1
  }

  for (const item of stagedRecords) {
    if (item.record.owners.length === 0) delete state.files[item.key]
    else state.files[item.key] = item.record
  }

  modRecord.installed = false
  modRecord.installedAt = null
  modRecord.lastGamePath = input.gamePath
  state.mods[input.modId] = modRecord
  await saveState(dirs, state)

  const finalConflicts = await computeConflictPaths(state, modRecord, cache).catch(() => [] as string[])
  return { ok: true, restoredPaths, mod: toSummary(modRecord, finalConflicts) }
}
