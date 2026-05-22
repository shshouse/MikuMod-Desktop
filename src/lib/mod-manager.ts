export type ManagedModSourceType = "archive" | "folder" | "download"

export interface ManagedModSummary {
  id: string
  name: string
  gameId: string
  gameName: string
  sourceType: ManagedModSourceType
  importedAt: string
  installed: boolean
  installedAt?: string | null
  fileCount: number
  conflictCount: number
  conflicts: string[]
  libraryPath: string
  folderName: string
  platformModId?: string | null
  platformVersionId?: string | null
  modNumber?: string | null
}

export interface ImportExternalModInput {
  gameId: string
  gameName: string
  sourcePath: string
  sourceType: Exclude<ManagedModSourceType, "download">
  modName?: string
  platformModId?: string
  platformVersionId?: string
  modNumber?: string
}

export interface ImportDownloadedModInput {
  gameId: string
  gameName: string
  sourcePath: string
  sourceType: "download"
  modName?: string
  platformModId?: string
  platformVersionId?: string
  modNumber?: string
  downloadId?: string
  fileName?: string
  archiveFileName?: string
}

export interface InstallManagedModInput {
  gameId: string
  gameName: string
  modId: string
  gamePath: string
}

export interface InstallManagedModResult {
  ok: boolean
  error?: string
  conflicts: string[]
  installedPaths: number
  mod?: ManagedModSummary
}

export interface UninstallManagedModInput {
  gameId: string
  gameName: string
  modId: string
  gamePath: string
}

export interface UninstallManagedModResult {
  ok: boolean
  error?: string
  restoredPaths: number
  mod?: ManagedModSummary
}

export async function listManagedMods(gameId: string, gameName: string) {
  return window.electronAPI.listManagedMods({ gameId, gameName })
}

export async function importExternalMod(input: ImportExternalModInput) {
  return window.electronAPI.importExternalMod(input)
}

export async function importDownloadedMod(input: ImportDownloadedModInput) {
  return window.electronAPI.importDownloadedMod(input)
}

export async function installManagedMod(input: InstallManagedModInput) {
  return window.electronAPI.installManagedMod(input)
}

export async function uninstallManagedMod(input: UninstallManagedModInput) {
  return window.electronAPI.uninstallManagedMod(input)
}
