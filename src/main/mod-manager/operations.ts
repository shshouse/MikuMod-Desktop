import path from 'path'
import fs from 'fs'
import fsPromises from 'fs/promises'
import { SKIPPED_INSTALL_FILENAMES } from './constants'
import {
  sanitizeSegment, createId, createStableHash,
  pathExists, ensureDir, removePath, removeFileIfExists,
  copyFileSafe, copyDirectoryContents, listFilesRecursive,
  hashFile, extractArchive, resolveContentRoot, resolveDownloadedContentRoot,
  deepClone,
} from './utils'
import { getGameDirs, loadState, saveState, ensureGameDirs, getAppBaseDir } from './state'
import { buildManifest, writeManifest, getManifestIndexByModId } from './manifest'
import { resolveMiNameByGameName, getMiModsDirFromBase, getMiDirFromBase, type XxmiRuntimeName } from '../launcher/launcher-types'
import { importXxmiPackage } from '../launcher/xxmi-launcher'
import type { ModRecord, ModState, ModSummary, ManifestIndex, ImportInput, InstallInput, UninstallInput, DeleteInput, ListInput, GameDirs } from './types'

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
    // ponytail: 内容在 libraryPath/source/
    const sourcePath = path.join(activeMod.libraryPath, 'source', ...record.relativePath.split('/'))
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

// ponytail: 计算版本子目录名, 兜底 unknown
function resolveVersionFolder(versionString?: string): string {
  const v = sanitizeSegment(versionString)
  return v && v !== 'Unknown' ? v : 'unknown'
}

// ponytail: 计算压缩包原文件名 (保留作者上传的原名, 不改成 original.zip)
function resolveArchiveFileName(input: ImportInput): string | null {
  // 优先 archiveFileName (下载场景, 作者上传原名)
  if (input.archiveFileName) return sanitizeSegment(input.archiveFileName)
  // 自定义导入: 用 sourcePath 的 basename
  if (input.sourcePath) {
    const base = path.basename(input.sourcePath)
    if (base) return sanitizeSegment(base)
  }
  return null
}

export async function importExternalMod(app: Electron.App, input: ImportInput, modsRootDir: string, backupsRootDir?: string): Promise<ModSummary> {
  // ponytail: mod_number=9 是 XXMI 框架包唯一标识, 不依赖 gameName
  // API 返回 mod_number 是数字, 必须用 String() 统一类型
  const isXxmiPackage = String(input.modNumber) === '9'
  const effectiveGameName = isXxmiPackage ? 'XXMI' : input.gameName
  const dirs = getGameDirs(app, effectiveGameName, modsRootDir, backupsRootDir)
  const state = await loadState(dirs, input.gameId, effectiveGameName)
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
      // ponytail: 内容统一放 source/, 清理旧的 source/ 和根目录散落文件
      sourceDir = path.join(modDir, 'source')
      await removePath(sourceDir)
      await removeFileIfExists(path.join(modDir, 'manifest.json')).catch(() => {})
      // 清理旧的原压缩包 (原名或 original.* 都清)
      const entries = await fsPromises.readdir(modDir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (entry.isFile() && (entry.name.startsWith('original.') || entry.name === 'manifest.json')) {
          await removeFileIfExists(path.join(modDir, entry.name))
        }
      }
    } else {
      // ponytail: XXMI 框架包走简化路径 - 直接 mods/XXMI/, 不存 source/ (避免和 frameworks/ 重复 149MB)
      // 只存 original.zip 供回滚/重部署, 不生成 manifest (XXMI 不走模组 manifest 系统)
      if (isXxmiPackage) {
        modDir = dirs.gameDir
        await ensureDir(modDir)
        // 不创建 source/ 目录 - frameworks/xxmi/ 就是解压后的运行时, 不需要副本
        sourceDir = path.join(modDir, 'source')
        // 仍然创建 sourceDir 以兼容后续的 rename 逻辑, 但会在之后删除
        const folderName = path.basename(modDir)
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
          miTargetDir: null,
        }
      } else {
        // ponytail: 普通平台下载目录结构 mods/<gameFolder>/<modNumber>/<versionString>/
        // - source/ 存解压内容
        // - <原压缩包名>.zip 存原文件 (保留原名)
        // - manifest.json 存清单
        const hasFixedPlatformFolder = input.sourceType === 'download' && input.modNumber && input.gameName !== 'USER'
        if (hasFixedPlatformFolder) {
          // 平台下载: mods/<game>/<modNumber>/<version>/
          const versionFolder = resolveVersionFolder(input.versionString)
          const modFolder = path.join(String(input.modNumber), versionFolder)
          modDir = path.join(dirs.gameDir, modFolder)
          await ensureDir(modDir)
        } else {
          // 自定义导入: mods/<game>/<uniqueName>/
          const preferredName = resolveImportName(input)
          const folderName = await ensureUniqueFolder(dirs.gameDir, preferredName)
          modDir = path.join(dirs.gameDir, folderName)
          await ensureDir(modDir)
        }
        sourceDir = path.join(modDir, 'source')
        await ensureDir(sourceDir)
        const folderName = path.basename(modDir)
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
          miTargetDir: null,
        }
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
      // ponytail: XXMI 用 original.<ext>, 其他保留原作者上传的原名
      const archiveName = isXxmiPackage
        ? `original${(path.extname(input.sourcePath) || '.zip').toLowerCase()}`
        : resolveArchiveFileName(input)
      if (archiveName) {
        const archivePath = path.join(modDir, archiveName)
        if (path.resolve(input.sourcePath) !== path.resolve(archivePath)) {
          await copyFileSafe(input.sourcePath, archivePath)
        }
        // ponytail: XXMI 框架包导入 mods/XXMI/ 后, 必须同步部署到 frameworks/xxmi/,
        // 否则后续 MI 模组安装会报 "XXMI EFMI 未安装"
        if (isXxmiPackage) {
          const xxmiResult = await importXxmiPackage(app, archivePath)
          if (!xxmiResult.success) {
            throw new Error(`XXMI 框架部署失败: ${xxmiResult.error || '未知错误'}`)
          }
          // 部署成功后删除 source/ 目录 (它只是 frameworks/ 的副本, 浪费 149MB)
          await removePath(sourceDir).catch(() => {})
        }
      }
    }

    if (existingForPlatform) {
      modRecord.name = resolveImportName(input) || modRecord.name
      modRecord.platformVersionId = input.platformVersionId || null
      modRecord.modNumber = input.modNumber || modRecord.modNumber || null
      modRecord.importedAt = new Date().toISOString()
    }

    // ponytail: XXMI 不需要 manifest (它不走模组哈希校验系统)
    if (!isXxmiPackage) {
      const manifest = await buildManifest(modRecord)
      modRecord.fileCount = manifest.fileCount
      await writeManifest(modDir, manifest)
    } else {
      modRecord.fileCount = 0
    }

    state.mods[modRecord.id] = modRecord
    await saveState(dirs, state)

    // ponytail: XXMI 没有 manifest, computeConflictPaths 会报 ENOENT, 跳过冲突检测
    if (isXxmiPackage) {
      return toSummary(modRecord, [])
    }

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
    versionString: input.versionString,
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

// 二游安装策略: 复制 mod 库目录到 XXMI MI Mods 目录
// ponytail: 不用 owners 栈/备份/冲突检测, XXMI 自己管 Mods/ 下的加载顺序
// 同名冲突改名: <folderName> 已存在则用 <folderName>_1, _2... (用户要并存不同 mod 的场景)
async function installToMiMods(
  app: Electron.App,
  modRecord: ModRecord,
  miName: XxmiRuntimeName,
  state: ModState,
  dirs: GameDirs,
): Promise<{ ok: boolean; error?: string; mod?: ModSummary }> {
  const appBaseDir = getAppBaseDir(app)
  const miDir = getMiDirFromBase(appBaseDir, miName)
  // ponytail: 和 getXxmiFrameworkInfo 的判断对齐: hasDll || hasCore
  // d3d11.dll 是运行时注入 DLL, Core/<miName> 是核心代码, 两者有其一即算已安装
  const hasDll = fs.existsSync(path.join(miDir, 'd3d11.dll'))
  const hasCore = fs.existsSync(path.join(miDir, 'Core', miName))
  if (!hasDll && !hasCore) {
    return { ok: false, error: `XXMI ${miName} 未安装，请先导入 XXMI 便携包` }
  }

  const modsDir = getMiModsDirFromBase(appBaseDir, miName)
  await ensureDir(modsDir)

  // 同名改名: 若目录已被其他 mod 占用, 找一个可用的名字
  let targetName = modRecord.folderName
  if (await pathExists(path.join(modsDir, targetName))) {
    let counter = 1
    while (await pathExists(path.join(modsDir, `${modRecord.folderName}_${counter}`))) {
      counter += 1
    }
    targetName = `${modRecord.folderName}_${counter}`
  }
  const targetDir = path.join(modsDir, targetName)

  // 若同一 mod 已装过 (miTargetDir 指向旧目录), 先清理旧的
  if (modRecord.miTargetDir && modRecord.miTargetDir !== targetDir) {
    await removePath(modRecord.miTargetDir).catch(() => {})
  }

  // ponytail: 内容在 libraryPath/source/, 从 source/ 复制到 MI Mods
  await copyDirectoryContents(path.join(modRecord.libraryPath, 'source'), targetDir)

  modRecord.installed = true
  modRecord.installedAt = new Date().toISOString()
  modRecord.miTargetDir = targetDir
  state.mods[modRecord.id] = modRecord
  await saveState(dirs, state)

  return { ok: true, mod: toSummary(modRecord, []) }
}

// 二游卸载策略: 从 MI Mods 目录删除
async function uninstallFromMiMods(
  modRecord: ModRecord,
  state: ModState,
  dirs: GameDirs,
): Promise<{ ok: boolean; error?: string; mod?: ModSummary }> {
  // miTargetDir 不存在 (XXMI 被删/mod 目录被手动清理) -> 当作已卸载, 清 state
  if (modRecord.miTargetDir) {
    await removePath(modRecord.miTargetDir).catch(() => {})
  }
  modRecord.installed = false
  modRecord.installedAt = null
  modRecord.miTargetDir = null
  state.mods[modRecord.id] = modRecord
  await saveState(dirs, state)

  return { ok: true, mod: toSummary(modRecord, []) }
}

export async function installManagedMod(app: Electron.App, input: InstallInput, modsRootDir: string, backupsRootDir?: string) {
  const dirs = getGameDirs(app, input.gameName, modsRootDir, backupsRootDir)
  const state = await loadState(dirs, input.gameId, input.gameName)
  const modRecord = state.mods[input.modId]

  if (!modRecord) return { ok: false, error: '模组不存在', conflicts: [], installedPaths: 0 }

  // 分流: 二游走 MI Mods 策略, 其他走 overlay 覆盖策略
  const miName = resolveMiNameByGameName(input.gameName)
  if (miName) {
    const result = await installToMiMods(app, modRecord, miName, state, dirs)
    if (!result.ok) return { ok: false, error: result.error, conflicts: [], installedPaths: 0 }
    return { ok: true, conflicts: [], installedPaths: 1, mod: result.mod }
  }

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
    // ponytail: 内容在 libraryPath/source/
    const sourcePath = path.join(modRecord.libraryPath, 'source', ...file.relativePath.split('/'))
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

  // 分流: 二游走 MI Mods 卸载, 其他走 overlay 回滚
  const miName = resolveMiNameByGameName(input.gameName)
  if (miName) {
    const result = await uninstallFromMiMods(modRecord, state, dirs)
    if (!result.ok) return { ok: false, error: result.error, restoredPaths: 0 }
    return { ok: true, restoredPaths: 1, mod: result.mod }
  }

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

// --- 删除 ---

export async function deleteManagedMod(app: Electron.App, input: DeleteInput, modsRootDir: string, backupsRootDir?: string): Promise<{ ok: boolean; error?: string }> {
  const dirs = getGameDirs(app, input.gameName, modsRootDir, backupsRootDir)
  const state = await loadState(dirs, input.gameId, input.gameName)
  const modRecord = state.mods[input.modId]

  if (!modRecord) return { ok: false, error: '模组不存在' }
  if (modRecord.installed) return { ok: false, error: '请先卸载后再删除' }

  // ponytail: 清理 state.files 中该模组的所有权记录, 避免留下孤儿引用
  for (const key of Object.keys(state.files)) {
    const record = state.files[key]
    if (record && Array.isArray(record.owners)) {
      record.owners = record.owners.filter(id => id !== input.modId)
      if (record.owners.length === 0) delete state.files[key]
    }
  }

  // 删除模组库目录
  await removePath(modRecord.libraryPath)

  // 删除记录
  delete state.mods[input.modId]
  await saveState(dirs, state)

  return { ok: true }
}
