export interface GameDirs {
  rootDir: string
  gameFolder: string
  gameDir: string
  systemDir: string
  backupsDir: string
  tempDir: string
  statePath: string
  stateBackupPath: string
}

export interface FileRecord {
  relativePath: string
  owners: string[]
  original: { type: 'file'; backupRelativePath: string } | { type: 'absent' } | null
}

export interface ModRecord {
  id: string
  name: string
  gameId: string
  gameName: string
  sourceType: string
  importedAt: string
  installed: boolean
  installedAt: string | null
  fileCount: number
  libraryPath: string
  folderName: string
  platformModId: string | null
  platformVersionId: string | null
  modNumber: string | null
  lastGamePath: string | null
  // ponytail: 二游 mod 走 XXMI 安装策略时, 记录实际落地目录 (<xxmiDir>/<miName>/Mods/<modName>/)
  // 用于卸载时定位; overlay 策略不用此字段 (走 owners 栈)
  miTargetDir: string | null
}

export interface ModState {
  version: number
  gameId: string
  gameName: string
  mods: Record<string, ModRecord>
  files: Record<string, FileRecord>
}

export interface ManifestFile {
  relativePath: string
  size: number
  sha256: string
}

export interface Manifest {
  id: string
  name: string
  gameId: string
  gameName: string
  folderName: string
  sourceType: string
  importedAt: string
  platformModId: string | null
  platformVersionId: string | null
  fileCount: number
  files: ManifestFile[]
}

export interface ManifestIndex {
  manifest: Manifest
  filesByKey: Map<string, ManifestFile>
}

export interface ModSummary {
  id: string
  name: string
  gameId: string
  gameName: string
  sourceType: string
  importedAt: string
  installed: boolean
  installedAt: string | null
  fileCount: number
  conflictCount: number
  conflicts: string[]
  libraryPath: string
  folderName: string
  platformModId: string | null
  platformVersionId: string | null
  modNumber: string | null
}

export interface ImportInput {
  gameId: string
  gameName: string
  sourcePath: string
  sourceType: string
  modName?: string
  platformModId?: string
  platformVersionId?: string
  modNumber?: string
  archiveFileName?: string
  // ponytail: 版本号, 用于版本分层目录 mods/<game>/<modNumber>/<versionString>/
  versionString?: string
}

export interface InstallInput {
  gameId: string
  gameName: string
  modId: string
  gamePath: string
}

export interface UninstallInput {
  gameId: string
  gameName: string
  modId: string
  gamePath: string
}

export interface DeleteInput {
  gameId: string
  gameName: string
  modId: string
}

export interface ListInput {
  gameId: string
  gameName: string
}
