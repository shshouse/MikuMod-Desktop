import type {
  ImportExternalModInput,
  ImportDownloadedModInput,
  InstallManagedModInput,
  InstallManagedModResult,
  ManagedModSummary,
  UninstallManagedModInput,
  UninstallManagedModResult,
} from "@/lib/mod-manager"

interface UpdaterInfo {
  version?: string
  releaseName?: string
  releaseNotes?: string | string[]
  [key: string]: unknown
}

interface UpdaterProgress {
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  [key: string]: unknown
}

export interface ElectronAPI {
  getAppDir: () => Promise<string>
  selectDirectory: () => Promise<string | null>
  selectModFile: () => Promise<string | null>
  openDirectory: (path: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  httpRequest: (url: string, options?: RequestInit) => Promise<{ ok: boolean; status: number; text: string }>
  fileExists: (path: string) => Promise<boolean>
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  scanDirectory: (path: string) => Promise<string[]>
  deleteFile: (path: string) => Promise<void>
  copyFile: (src: string, dest: string) => Promise<boolean>
  scanSteamGames: () => Promise<Array<{ appId: string; name: string; installPath: string }>>
  openLoginWindow: (url: string) => Promise<void>

  // 自动更新
  updaterCheck: () => Promise<{ available: boolean; info?: UpdaterInfo; reason?: string }>
  updaterDownload: () => Promise<boolean>
  updaterInstall: () => void
  getAppVersion: () => Promise<string>
  onUpdaterEvent: (callback: (data: { type: string; info?: UpdaterInfo; progress?: UpdaterProgress; error?: string }) => void) => void

  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onDeepLink: (callback: (url: string) => void) => void
  onDownloadEvent: (callback: (data: {
    id: string
    status: "downloading" | "paused" | "done" | "error"
    receivedBytes?: number
    totalBytes?: number
    percent?: number
    savePath?: string
    error?: string
  }) => void) => void
  startDownload: (url: string, downloadId: string, fileName?: string, saveDir?: string) => Promise<void>
  pauseDownload: (id: string) => Promise<void>
  resumeDownload: (id: string) => Promise<void>
  cancelDownload: (id: string) => Promise<void>

  listManagedMods: (input: { gameId: string; gameName: string }) => Promise<ManagedModSummary[]>
  importExternalMod: (input: ImportExternalModInput) => Promise<ManagedModSummary>
  importDownloadedMod: (input: ImportDownloadedModInput) => Promise<ManagedModSummary>
  installManagedMod: (input: InstallManagedModInput) => Promise<InstallManagedModResult>
  uninstallManagedMod: (input: UninstallManagedModInput) => Promise<UninstallManagedModResult>

  // 加速器
  acceleratorStatus: () => Promise<{ running: boolean; resolved: Record<string, string>; enabledGroups: string[] }>
  acceleratorSetDomains: (domains: unknown[]) => Promise<{ success: boolean }>
  acceleratorGetDomains: () => Promise<unknown[]>
  acceleratorResolve: (domain: string) => Promise<string | null>
  acceleratorResolveAll: (domains: unknown[]) => Promise<Record<string, string>>
  acceleratorStart: (enabledDomains: unknown[]) => Promise<{ success: boolean; error?: string; hostsMap?: Record<string, string> }>
  acceleratorStop: () => Promise<{ success: boolean; error?: string }>
  acceleratorCheckHosts: () => Promise<boolean>
  acceleratorPing: (ip: string) => Promise<number | null>
  acceleratorPingBoth: (domain: string, ip: string) => Promise<{ before: number | null, after: number | null }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
