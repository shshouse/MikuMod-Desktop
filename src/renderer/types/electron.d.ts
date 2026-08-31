import type {
  ImportExternalModInput,
  ImportDownloadedModInput,
  InstallManagedModInput,
  InstallManagedModResult,
  ManagedModSummary,
  UninstallManagedModInput,
  UninstallManagedModResult,
  DeleteManagedModInput,
  DeleteManagedModResult,
} from "@/lib/mod-manager"

import type {
  DownloadResumeData,
  MultiDownloadSegment,
  AcceleratorProxyMode,
  UpdaterInfo,
  UpdaterProgress,
  UpdateChannel,
} from '@shared/electron-api'

export type {
  DownloadResumeData,
  MultiDownloadSegment,
  AcceleratorProxyMode,
  UpdaterInfo,
  UpdaterProgress,
  UpdateChannel,
}

export interface ElectronAPI {
  getAppDir: () => Promise<string>
  getAppDataDir: () => Promise<string>
  getAppModsDir: () => Promise<string>
  getAppBackupsDir: () => Promise<string>
  authorizeDirectory: (path: string) => Promise<boolean>
  selectDirectory: () => Promise<string | null>
  selectModFile: () => Promise<string | null>
  openDirectory: (path: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  httpRequest: (url: string, options?: RequestInit & { timeoutMs?: number }) => Promise<{ ok: boolean; status: number; text: string; headers?: Record<string, string> }>
  fileExists: (path: string) => Promise<boolean>
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  scanDirectory: (path: string) => Promise<string[]>
  deleteFile: (path: string) => Promise<void>
  scanSteamGames: () => Promise<Array<{ appId: string; name: string; installPath: string }>>
  detectEndfield: () => Promise<Array<{ gameId: string; name: string; installPath: string; exePath: string }>>
  openLoginWindow: (url: string) => Promise<void>

  updaterCheck: () => Promise<{ available: boolean; info?: UpdaterInfo; reason?: string }>
  updaterDownload: () => Promise<boolean>
  updaterInstall: () => void
  updaterGetChannel: () => Promise<UpdateChannel>
  updaterSetChannel: (channel: UpdateChannel) => Promise<{ success: boolean }>
  getAppVersion: () => Promise<string>
  onUpdaterEvent: (callback: (data: { type: string; info?: UpdaterInfo; progress?: UpdaterProgress; error?: string }) => void) => void

  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onDeepLink: (callback: (url: string) => void) => () => void
  onDownloadEvent: (callback: (data: {
    id: string
    status: "downloading" | "paused" | "done" | "error"
    receivedBytes?: number
    totalBytes?: number
    percent?: number
    savePath?: string
    error?: string
    resumeData?: DownloadResumeData
  }) => void) => void
  startDownload: (url: string, downloadId: string, fileName?: string, saveDir?: string) => Promise<void>
  pauseDownload: (id: string) => Promise<void>
  resumeDownload: (id: string, resumeData?: DownloadResumeData) => Promise<void>
  cancelDownload: (id: string) => Promise<void>

  listManagedMods: (input: { gameId: string; gameName: string }) => Promise<ManagedModSummary[]>
  importExternalMod: (input: ImportExternalModInput) => Promise<ManagedModSummary>
  importDownloadedMod: (input: ImportDownloadedModInput) => Promise<ManagedModSummary>
  installManagedMod: (input: InstallManagedModInput) => Promise<InstallManagedModResult>
  uninstallManagedMod: (input: UninstallManagedModInput) => Promise<UninstallManagedModResult>
  deleteManagedMod: (input: DeleteManagedModInput) => Promise<DeleteManagedModResult>

  acceleratorStatus: () => Promise<{ running: boolean; resolved: Record<string, string>; activeDomains?: string[]; mode?: AcceleratorProxyMode; pacUrl?: string | null }>
  acceleratorSetDomains: (domains: unknown[]) => Promise<{ success: boolean }>
  acceleratorGetDomains: () => Promise<unknown[]>
  acceleratorResolve: (domain: string) => Promise<string | null>
  acceleratorResolveAll: (domains: unknown[]) => Promise<Record<string, string>>
  acceleratorStart: (enabledDomains: unknown[]) => Promise<{ success: boolean; error?: string; warning?: string; hostsMap?: Record<string, string>; mode?: AcceleratorProxyMode; pacUrl?: string }>
  acceleratorStop: () => Promise<{ success: boolean; error?: string; warning?: string }>
  acceleratorRepair: () => Promise<{ success: boolean; error?: string; warning?: string }>
  acceleratorCheckHosts: () => Promise<boolean>
  acceleratorPing: (ip: string) => Promise<number | null>
  acceleratorPingBoth: (domain: string, ip: string) => Promise<{ before: number | null, after: number | null }>

  // XXMI Launcher
  xxmiImportPackage: (zipPath: string) => Promise<{ success: boolean; launcherPath: string | null; version: string | null; importedMiNames: string[]; error?: string }>
  xxmiGetFrameworkInfo: () => Promise<{ installed: boolean; version: string | null; launcherExe: string | null; frameworksDir: string; miStatuses: Array<{ runtimeName: string; gameName: string; installed: boolean; modsCount: number; modsDir: string | null }> }>
  xxmiWriteGameFolder: (gameName: string, gameFolderPath: string) => Promise<{ success: boolean; error?: string }>
  xxmiGetGameFolder: (gameName: string) => Promise<string | null>
  xxmiLaunchGame: (gameName: string, gameExePath?: string) => Promise<{ success: boolean; error?: string }>
  xxmiGetModsDir: (miName: string) => Promise<string | null>
  xxmiGetAllModsDirs: () => Promise<Record<string, string | null>>
  xxmiUninstall: () => Promise<{ ok: boolean }>
  xxmiCreateShortcut: (gameName: string, miName: string, gameExePath: string) => Promise<{ success: boolean; shortcutPath: string | null; error?: string }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
