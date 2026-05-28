import path from 'path'
import fsPromises from 'fs/promises'
import { listFilesRecursive, toRelativePosix, hashFile } from './utils'
import type { ModRecord, ModState, Manifest, ManifestIndex, ManifestFile } from './types'

export async function buildManifest(modRecord: ModRecord): Promise<Manifest> {
  const sourceDir = path.join(modRecord.libraryPath, 'source')
  const filePaths = await listFilesRecursive(sourceDir)
  const files: ManifestFile[] = []
  const seen = new Set<string>()

  for (const filePath of filePaths) {
    const relativePath = toRelativePosix(sourceDir, filePath)
    const key = relativePath.toLowerCase()
    if (seen.has(key)) throw new Error(`模组内存在重复文件路径: ${relativePath}`)
    seen.add(key)
    const stats = await fsPromises.stat(filePath)
    const sha256 = await hashFile(filePath)
    files.push({ relativePath, size: stats.size, sha256 })
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  return {
    id: modRecord.id,
    name: modRecord.name,
    gameId: modRecord.gameId,
    gameName: modRecord.gameName,
    folderName: modRecord.folderName,
    sourceType: modRecord.sourceType,
    importedAt: modRecord.importedAt,
    platformModId: modRecord.platformModId,
    platformVersionId: modRecord.platformVersionId,
    fileCount: files.length,
    files,
  }
}

export async function writeManifest(modDir: string, manifest: Manifest) {
  await fsPromises.writeFile(path.join(modDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
}

export async function readManifest(modRecord: ModRecord): Promise<Manifest> {
  const raw = await fsPromises.readFile(path.join(modRecord.libraryPath, 'manifest.json'), 'utf-8')
  return JSON.parse(raw)
}

export function indexManifest(manifest: Manifest): ManifestIndex {
  const filesByKey = new Map<string, ManifestFile>()
  for (const file of manifest.files || []) {
    filesByKey.set(String(file.relativePath || '').toLowerCase(), file)
  }
  return { manifest, filesByKey }
}

export async function getManifestIndexByModId(state: ModState, modId: string, cache: Map<string, ManifestIndex>): Promise<ManifestIndex> {
  const cached = cache.get(modId)
  if (cached) return cached
  const modRecord = state.mods[modId]
  if (!modRecord) throw new Error(`模组不存在: ${modId}`)
  const manifest = await readManifest(modRecord)
  const indexed = indexManifest(manifest)
  cache.set(modId, indexed)
  return indexed
}
