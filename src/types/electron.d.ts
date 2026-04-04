export interface ElectronAPI {
  getAppDir: () => Promise<string>
  selectDirectory: () => Promise<string | null>
  openDirectory: (path: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  httpRequest: (url: string, options?: RequestInit) => Promise<{ ok: boolean; status: number; text: string }>
  fileExists: (path: string) => Promise<boolean>
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  scanDirectory: (path: string) => Promise<string[]>
  deleteFile: (path: string) => Promise<void>
  scanSteamGames: () => Promise<Array<{ appId: string; name: string; installPath: string }>>
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
