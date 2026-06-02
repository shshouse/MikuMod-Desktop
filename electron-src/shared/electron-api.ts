export interface DownloadResumeData {
  path: string
  urlChain: string[]
  mimeType?: string
  offset: number
  length: number
  lastModified?: string
  eTag?: string
  startTime?: number
}

export interface DownloadEvent {
  id: string
  status: 'downloading' | 'paused' | 'done' | 'error'
  receivedBytes?: number
  totalBytes?: number
  percent?: number
  savePath?: string
  error?: string
  resumeData?: DownloadResumeData
}

export type AcceleratorProxyMode = 'system' | 'hosts' | null

export interface UpdaterInfo {
  version?: string
  releaseName?: string
  releaseNotes?: string | string[]
  [key: string]: unknown
}

export interface UpdaterProgress {
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  [key: string]: unknown
}

export type UpdateChannel = 'stable' | 'beta' | 'alpha'

export interface SteamGame {
  appId: string
  name: string
  installPath: string
}
