const path = require('path')
const fs = require('fs')
const fsPromises = require('fs/promises')
const crypto = require('crypto')
const { spawn } = require('child_process')

const STATE_VERSION = 1
const JUNK_NAMES = new Set(['Thumbs.db', 'desktop.ini', '.DS_Store'])

function getAppBaseDir(app) {
  return app.isPackaged ? path.dirname(app.getPath('exe')) : path.resolve(__dirname, '..')
}

function sanitizeSegment(value) {
  const normalized = String(value || 'Unknown')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80)

  if (!normalized || normalized === '_system') {
    return 'Unknown'
  }

  return normalized
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
}

function createStableHash(value) {
  return crypto.createHash('sha1').update(value).digest('hex')
}

async function pathExists(targetPath) {
  try {
    await fsPromises.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function ensureDir(dirPath) {
  await fsPromises.mkdir(dirPath, { recursive: true })
}

async function removePath(targetPath) {
  await fsPromises.rm(targetPath, { recursive: true, force: true })
}

async function removeFileIfExists(filePath) {
  try {
    await fsPromises.unlink(filePath)
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }
}

async function copyFileSafe(srcPath, destPath) {
  await ensureDir(path.dirname(destPath))
  await fsPromises.copyFile(srcPath, destPath)
}

async function copyDirectoryContents(srcDir, destDir) {
  await ensureDir(destDir)
  const entries = await fsPromises.readdir(srcDir, { withFileTypes: true })

  for (const entry of entries) {
    if (JUNK_NAMES.has(entry.name) || entry.name === '__MACOSX') {
      continue
    }

    const srcPath = path.join(srcDir, entry.name)
    const destPath = path.join(destDir, entry.name)

    if (entry.isDirectory()) {
      await copyDirectoryContents(srcPath, destPath)
      continue
    }

    if (entry.isFile()) {
      await copyFileSafe(srcPath, destPath)
    }
  }
}

async function listFilesRecursive(rootDir, currentDir = rootDir, files = []) {
  const entries = await fsPromises.readdir(currentDir, { withFileTypes: true })

  for (const entry of entries) {
    if (JUNK_NAMES.has(entry.name) || entry.name === '__MACOSX') {
      continue
    }

    const entryPath = path.join(currentDir, entry.name)

    if (entry.isDirectory()) {
      await listFilesRecursive(rootDir, entryPath, files)
      continue
    }

    if (entry.isFile()) {
      files.push(entryPath)
    }
  }

  return files
}

function toRelativePosix(rootDir, filePath) {
  const relativePath = path.relative(rootDir, filePath)
  const normalized = relativePath.split(path.sep).join('/')

  if (!normalized || normalized.startsWith('..') || path.isAbsolute(normalized) || normalized.includes('../')) {
    throw new Error(`非法文件路径: ${filePath}`)
  }

  return normalized
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)

    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stderr = ''

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code}`))
    })
  })
}

async function extractArchive(sourcePath, destDir) {
  await ensureDir(destDir)

  try {
    await runCommand('tar', ['-xf', sourcePath, '-C', destDir])
    return
  } catch (error) {
    const ext = path.extname(sourcePath).toLowerCase()
    if (ext !== '.zip') {
      throw new Error(`不支持的压缩包或解压失败: ${error.message}`)
    }
  }

  const escapedSource = sourcePath.replace(/'/g, "''")
  const escapedDest = destDir.replace(/'/g, "''")
  const command = `Expand-Archive -LiteralPath '${escapedSource}' -DestinationPath '${escapedDest}' -Force`
  await runCommand('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command])
}

async function resolveContentRoot(extractDir) {
  let currentDir = extractDir

  for (let index = 0; index < 6; index += 1) {
    const entries = (await fsPromises.readdir(currentDir, { withFileTypes: true }))
      .filter((entry) => !JUNK_NAMES.has(entry.name) && entry.name !== '__MACOSX')

    const files = entries.filter((entry) => entry.isFile())
    const directories = entries.filter((entry) => entry.isDirectory())

    if (files.length === 0 && directories.length === 1) {
      currentDir = path.join(currentDir, directories[0].name)
      continue
    }

    break
  }

  return currentDir
}

function getGameDirs(app, gameName, modsRootDir) {
  const rootDir = path.resolve(modsRootDir || path.join(getAppBaseDir(app), 'mods'))
  const gameFolder = sanitizeSegment(gameName)
  const gameDir = path.join(rootDir, gameFolder)
  const systemDir = path.join(gameDir, '_system')

  return {
    rootDir,
    gameFolder,
    gameDir,
    systemDir,
    backupsDir: path.join(systemDir, 'backups'),
    tempDir: path.join(systemDir, 'temp'),
    statePath: path.join(systemDir, 'state.json'),
    stateBackupPath: path.join(systemDir, 'state.last-good.json'),
  }
}

async function ensureGameDirs(dirs) {
  await Promise.all([
    ensureDir(dirs.rootDir),
    ensureDir(dirs.gameDir),
    ensureDir(dirs.systemDir),
    ensureDir(dirs.backupsDir),
    ensureDir(dirs.tempDir),
  ])
}

function createEmptyState(gameId, gameName) {
  return {
    version: STATE_VERSION,
    gameId,
    gameName,
    mods: {},
    files: {},
  }
}

function normalizeState(parsed, gameId, gameName) {
  return {
    version: parsed?.version || STATE_VERSION,
    gameId: parsed?.gameId || gameId,
    gameName: parsed?.gameName || gameName,
    mods: parsed?.mods || {},
    files: parsed?.files || {},
  }
}

async function readStateFile(filePath, gameId, gameName) {
  const raw = await fsPromises.readFile(filePath, 'utf-8')
  const parsed = JSON.parse(raw)
  return normalizeState(parsed, gameId, gameName)
}

async function replaceStateFile(tempPath, targetPath) {
  try {
    await fsPromises.rename(tempPath, targetPath)
    return
  } catch (error) {
    if (!error || (error.code !== 'EEXIST' && error.code !== 'EPERM')) {
      throw error
    }
  }

  await removeFileIfExists(targetPath)
  await fsPromises.rename(tempPath, targetPath)
}

async function loadState(dirs, gameId, gameName) {
  await ensureGameDirs(dirs)

  if (await pathExists(dirs.statePath)) {
    try {
      return await readStateFile(dirs.statePath, gameId, gameName)
    } catch {
    }
  }

  if (await pathExists(dirs.stateBackupPath)) {
    try {
      const recoveredState = await readStateFile(dirs.stateBackupPath, gameId, gameName)
      await copyFileSafe(dirs.stateBackupPath, dirs.statePath)
      return recoveredState
    } catch {
    }
  }

  return createEmptyState(gameId, gameName)
}

async function saveState(dirs, state) {
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

async function ensureUniqueFolder(gameDir, preferredName) {
  const baseName = sanitizeSegment(preferredName)
  let candidate = baseName
  let counter = 2

  while (await pathExists(path.join(gameDir, candidate))) {
    candidate = `${baseName}-${counter}`
    counter += 1
  }

  return candidate
}

async function buildManifest(modRecord) {
  const sourceDir = path.join(modRecord.libraryPath, 'source')
  const filePaths = await listFilesRecursive(sourceDir)
  const files = []
  const seen = new Set()

  for (const filePath of filePaths) {
    const relativePath = toRelativePosix(sourceDir, filePath)
    const key = relativePath.toLowerCase()
    if (seen.has(key)) {
      throw new Error(`模组内存在重复文件路径: ${relativePath}`)
    }

    seen.add(key)
    const stats = await fsPromises.stat(filePath)
    const sha256 = await hashFile(filePath)
    files.push({ relativePath, size: stats.size, sha256 })
  }

  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))

  return {
    id: modRecord.id,
    name: modRecord.name,
    gameId: modRecord.gameId,
    gameName: modRecord.gameName,
    folderName: modRecord.folderName,
    sourceType: modRecord.sourceType,
    importedAt: modRecord.importedAt,
    platformModId: modRecord.platformModId || null,
    platformVersionId: modRecord.platformVersionId || null,
    fileCount: files.length,
    files,
  }
}

async function writeManifest(modDir, manifest) {
  const manifestPath = path.join(modDir, 'manifest.json')
  await fsPromises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
}

async function readManifest(modRecord) {
  const manifestPath = path.join(modRecord.libraryPath, 'manifest.json')
  const raw = await fsPromises.readFile(manifestPath, 'utf-8')
  return JSON.parse(raw)
}

function indexManifest(manifest) {
  const filesByKey = new Map()

  for (const file of manifest.files || []) {
    filesByKey.set(String(file.relativePath || '').toLowerCase(), file)
  }

  return {
    manifest,
    filesByKey,
  }
}

async function getManifestIndexByModId(state, modId, cache) {
  if (cache.has(modId)) {
    return cache.get(modId)
  }

  const modRecord = state.mods[modId]
  if (!modRecord) {
    throw new Error(`模组不存在: ${modId}`)
  }

  const manifest = await readManifest(modRecord)
  const indexed = indexManifest(manifest)
  cache.set(modId, indexed)
  return indexed
}

function listModRecords(state) {
  return Object.values(state.mods || {})
}

async function computeConflictPaths(state, modRecord, cache) {
  const indexedManifest = await getManifestIndexByModId(state, modRecord.id, cache)
  const conflicts = []

  for (const file of indexedManifest.manifest.files || []) {
    const key = String(file.relativePath || '').toLowerCase()
    const record = state.files[key]
    if (!record || !Array.isArray(record.owners) || record.owners.length === 0) {
      continue
    }

    const otherOwners = record.owners.filter((ownerId) => ownerId !== modRecord.id)
    if (otherOwners.length === 0) {
      continue
    }

    const topOwnerId = otherOwners[otherOwners.length - 1]
    const topManifest = await getManifestIndexByModId(state, topOwnerId, cache)
    const topFile = topManifest.filesByKey.get(key)

    if (!topFile || topFile.sha256 !== file.sha256) {
      conflicts.push(file.relativePath)
    }
  }

  return conflicts.sort((left, right) => left.localeCompare(right))
}

function toSummary(modRecord, conflicts) {
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
  }
}

function resolveImportName(input) {
  if (input.modName && String(input.modName).trim()) {
    return String(input.modName).trim()
  }

  const baseName = path.basename(input.sourcePath)
  const ext = path.extname(baseName)
  return ext ? baseName.slice(0, -ext.length) : baseName
}

async function importExternalMod(app, input, modsRootDir) {
  const dirs = getGameDirs(app, input.gameName, modsRootDir)
  const state = await loadState(dirs, input.gameId, input.gameName)
  const isArchive = input.sourceType === 'archive' || input.sourceType === 'download'

  if (!(await pathExists(input.sourcePath))) {
    throw new Error('导入源不存在')
  }

  if (input.sourceType === 'download' && input.platformModId) {
    const existing = listModRecords(state).find((modRecord) => {
      if (modRecord.sourceType !== 'download' || modRecord.platformModId !== input.platformModId) {
        return false
      }

      if (input.platformVersionId) {
        return modRecord.platformVersionId === input.platformVersionId
      }

      return true
    })

    if (existing) {
      const cache = new Map()
      const conflicts = await computeConflictPaths(state, existing, cache)
      return toSummary(existing, conflicts)
    }
  }

  const tempRoot = path.join(dirs.tempDir, createId('import'))
  const tempSourceDir = path.join(tempRoot, 'source')
  const tempExtractDir = path.join(tempRoot, 'extract')

  try {
    await ensureDir(tempRoot)

    if (isArchive) {
      await extractArchive(input.sourcePath, tempExtractDir)
      const contentRoot = await resolveContentRoot(tempExtractDir)
      await copyDirectoryContents(contentRoot, tempSourceDir)
    } else {
      await copyDirectoryContents(input.sourcePath, tempSourceDir)
    }

    const importedFiles = await listFilesRecursive(tempSourceDir)
    if (importedFiles.length === 0) {
      throw new Error('导入源中未找到可安装文件')
    }

    const folderName = await ensureUniqueFolder(dirs.gameDir, resolveImportName(input))
    const modDir = path.join(dirs.gameDir, folderName)
    const sourceDir = path.join(modDir, 'source')
    await ensureDir(modDir)
    await fsPromises.rename(tempSourceDir, sourceDir)

    if (isArchive) {
      const ext = path.extname(input.sourcePath) || '.zip'
      await copyFileSafe(input.sourcePath, path.join(modDir, `original${ext}`))
    }

    const modRecord = {
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
      lastGamePath: null,
    }

    const manifest = await buildManifest(modRecord)
    modRecord.fileCount = manifest.fileCount
    await writeManifest(modDir, manifest)

    state.mods[modRecord.id] = modRecord
    await saveState(dirs, state)

    const cache = new Map()
    const conflicts = await computeConflictPaths(state, modRecord, cache)
    return toSummary(modRecord, conflicts)
  } finally {
    await removePath(tempRoot)
  }
}

 async function listManagedMods(app, input, modsRootDir) {
   const dirs = getGameDirs(app, input.gameName, modsRootDir)
   const state = await loadState(dirs, input.gameId, input.gameName)
   const cache = new Map()
   const summaries = []

  for (const modRecord of listModRecords(state)) {
    try {
      const conflicts = await computeConflictPaths(state, modRecord, cache)
      summaries.push(toSummary(modRecord, conflicts))
    } catch {
      summaries.push(toSummary(modRecord, []))
    }
  }

   return summaries.sort((left, right) => {
     if (left.installed !== right.installed) {
       return left.installed ? -1 : 1
     }
 

    return right.importedAt.localeCompare(left.importedAt)
  })
}

function resolveGamePathTarget(gamePath, relativePath) {
  const absoluteGamePath = path.resolve(gamePath)
  const targetPath = path.resolve(absoluteGamePath, ...relativePath.split('/'))

  if (targetPath !== absoluteGamePath && !targetPath.startsWith(`${absoluteGamePath}${path.sep}`)) {
    throw new Error(`非法目标路径: ${relativePath}`)
  }

  return targetPath
}

function assertManagedGamePath(state, gamePath) {
  const normalized = path.resolve(gamePath)
  const installedMods = Object.values(state.mods || {}).filter((modRecord) => modRecord.installed && modRecord.lastGamePath)
  const mismatch = installedMods.find((modRecord) => path.resolve(modRecord.lastGamePath) !== normalized)

  if (mismatch) {
    throw new Error('检测到当前游戏目录与已记录的安装目录不一致。为避免错误恢复文件，请先切回原目录后再安装或卸载。')
  }
}

async function ensureRecordMatchesActiveFile(record, state, cache, gamePath) {
  if (!record || !Array.isArray(record.owners) || record.owners.length === 0) {
    return
  }

  const activeModId = record.owners[record.owners.length - 1]
  const manifestIndex = await getManifestIndexByModId(state, activeModId, cache)
  const expectedFile = manifestIndex.filesByKey.get(String(record.relativePath || '').toLowerCase())

  if (!expectedFile) {
    return
  }

  const targetPath = resolveGamePathTarget(gamePath, record.relativePath)
  if (!(await pathExists(targetPath))) {
    throw new Error(`检测到游戏文件已丢失: ${record.relativePath}`)
  }

  const currentHash = await hashFile(targetPath)
  if (currentHash !== expectedFile.sha256) {
    throw new Error(`检测到游戏文件已被外部修改: ${record.relativePath}`)
  }
}

 async function restoreRecordToDisk(record, state, cache, dirs, gamePath) {
   const targetPath = resolveGamePathTarget(gamePath, record.relativePath)

   if (Array.isArray(record.owners) && record.owners.length > 0) {
     const activeModId = record.owners[record.owners.length - 1]
     const activeMod = state.mods[activeModId]
     if (!activeMod) {
       throw new Error(`缺少模组记录: ${activeModId}`)
     }

     const sourcePath = path.join(activeMod.libraryPath, 'source', ...record.relativePath.split('/'))
     await copyFileSafe(sourcePath, targetPath)
     return
   }

   if (record.original?.type === 'file' && record.original.backupRelativePath) {
     const backupPath = path.join(dirs.backupsDir, record.original.backupRelativePath)
     await copyFileSafe(backupPath, targetPath)
     return
   }

   if (record.original?.type === 'absent') {
     await removeFileIfExists(targetPath)
   }
 }

 async function installManagedMod(app, input, modsRootDir) {
   const dirs = getGameDirs(app, input.gameName, modsRootDir)
   const state = await loadState(dirs, input.gameId, input.gameName)
   const modRecord = state.mods[input.modId]

   if (!modRecord) {
     return { ok: false, error: '模组不存在', conflicts: [], installedPaths: 0 }
   }

   assertManagedGamePath(state, input.gamePath)

   const manifestIndex = await getManifestIndexByModId(state, input.modId, new Map())
   if (!manifestIndex.manifest.files?.length) {
     return { ok: false, error: '模组文件清单为空', conflicts: [], installedPaths: 0 }
   }

   const cache = new Map([[input.modId, manifestIndex]])
   const stagedRecords = []
   const stagedWrites = []
   const conflicts = []

   for (const file of manifestIndex.manifest.files) {
     const key = String(file.relativePath || '').toLowerCase()
     const targetPath = resolveGamePathTarget(input.gamePath, file.relativePath)
     const sourcePath = path.join(modRecord.libraryPath, 'source', ...file.relativePath.split('/'))
     const currentRecord = state.files[key] ? JSON.parse(JSON.stringify(state.files[key])) : {
       relativePath: file.relativePath,
       owners: [],
       original: null,
     }

     if (currentRecord.owners.length > 0) {
       await ensureRecordMatchesActiveFile(currentRecord, state, cache, input.gamePath)
       const previousOwnerId = currentRecord.owners[currentRecord.owners.length - 1]
       if (previousOwnerId !== input.modId) {
         const previousManifest = await getManifestIndexByModId(state, previousOwnerId, cache)
         const previousFile = previousManifest.filesByKey.get(key)
         if (!previousFile || previousFile.sha256 !== file.sha256) {
           conflicts.push(file.relativePath)
         }
       }
     } else {
       const targetExists = await pathExists(targetPath)
       if (targetExists) {
         const backupRelativePath = `${createStableHash(file.relativePath)}${path.extname(file.relativePath)}`
         const backupPath = path.join(dirs.backupsDir, backupRelativePath)
         if (!(await pathExists(backupPath))) {
           await copyFileSafe(targetPath, backupPath)
         }
         currentRecord.original = { type: 'file', backupRelativePath }
       } else {
         currentRecord.original = { type: 'absent' }
       }
     }

     currentRecord.owners = currentRecord.owners.filter((ownerId) => ownerId !== input.modId)
     currentRecord.owners.push(input.modId)
     stagedRecords.push([key, currentRecord])
     stagedWrites.push({ sourcePath, targetPath })
   }

   for (const item of stagedWrites) {
     await copyFileSafe(item.sourcePath, item.targetPath)
   }

   for (const [key, record] of stagedRecords) {
     state.files[key] = record
   }

   modRecord.installed = true
   modRecord.installedAt = new Date().toISOString()
   modRecord.lastGamePath = input.gamePath
   state.mods[input.modId] = modRecord
   await saveState(dirs, state)

   return {
     ok: true,
     conflicts: conflicts.sort((left, right) => left.localeCompare(right)),
     installedPaths: stagedWrites.length,
     mod: toSummary(modRecord, conflicts),
   }
 }

 async function uninstallManagedMod(app, input, modsRootDir) {
   const dirs = getGameDirs(app, input.gameName, modsRootDir)
   const state = await loadState(dirs, input.gameId, input.gameName)
   const modRecord = state.mods[input.modId]

   if (!modRecord) {
     return { ok: false, error: '模组不存在', restoredPaths: 0 }
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

   const cache = new Map([[input.modId, manifestIndex]])
   const stagedRecords = []
   let restoredPaths = 0

   for (const file of manifestIndex.manifest.files) {
     const key = String(file.relativePath || '').toLowerCase()
     const record = state.files[key]
     if (!record) {
       continue
     }

     await ensureRecordMatchesActiveFile(record, state, cache, input.gamePath)
     const nextRecord = JSON.parse(JSON.stringify(record))
     nextRecord.owners = Array.isArray(nextRecord.owners) ? nextRecord.owners.filter((ownerId) => ownerId !== input.modId) : []
     stagedRecords.push({ key, record: nextRecord })
   }

   for (const item of stagedRecords) {
     await restoreRecordToDisk(item.record, state, cache, dirs, input.gamePath)
     restoredPaths += 1
   }

   for (const item of stagedRecords) {
     if (item.record.owners.length === 0) {
       delete state.files[item.key]
     } else {
       state.files[item.key] = item.record
     }
   }

   modRecord.installed = false
   modRecord.installedAt = null
   modRecord.lastGamePath = input.gamePath
   state.mods[input.modId] = modRecord
   await saveState(dirs, state)

   const conflicts = await computeConflictPaths(state, modRecord, cache).catch(() => [])
   return {
     ok: true,
     restoredPaths,
     mod: toSummary(modRecord, conflicts),
   }
 }

 async function importDownloadedArchive(app, input, modsRootDir) {
   return importExternalMod(app, {
     gameId: input.gameId,
     gameName: input.gameName,
     sourcePath: input.sourcePath,
     sourceType: 'download',
     modName: input.modName,
     platformModId: input.platformModId,
     platformVersionId: input.platformVersionId,
   }, modsRootDir)
 }

 module.exports = {
   getGameDirs,
   listManagedMods,
   importExternalMod,
   importDownloadedArchive,
   installManagedMod,
   uninstallManagedMod,
 }
