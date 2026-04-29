import { useSyncExternalStore } from "react"
import type { DownloadResumeData } from "@/types/electron"
import { getDesktopSettings } from "@/lib/desktop-config"
import { importDownloadedMod, installManagedMod } from "@/lib/mod-manager"
import { logger } from "@/lib/logger"

export interface DownloadTask {
  id: string
  name: string
  gameId?: string
  game: string
  url: string
  fileName?: string
  size: string
  status: "downloading" | "paused" | "done" | "error"
  progress: number
  speed?: string
  savePath?: string
  error?: string
  imported?: boolean
  managedModId?: string
  installed?: boolean
  installedPath?: string
  platformModId?: string
  platformVersionId?: string
  autoInstallGamePath?: string
  conflicts?: string[]
  installing?: boolean
  resumeData?: DownloadResumeData
  manuallyPaused?: boolean
}

const TASKS_STORAGE_KEY = "mikumod_desktop_download_tasks"

function normalizeResumeData(value: unknown): DownloadResumeData | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const candidate = value as Partial<DownloadResumeData>
  if (typeof candidate.path !== "string" || !Array.isArray(candidate.urlChain) || typeof candidate.offset !== "number" || typeof candidate.length !== "number") {
    return undefined
  }

  const urlChain = candidate.urlChain.filter((item): item is string => typeof item === "string" && item.length > 0)
  if (urlChain.length === 0) {
    return undefined
  }

  return {
    path: candidate.path,
    urlChain,
    offset: candidate.offset,
    length: candidate.length,
    mimeType: typeof candidate.mimeType === "string" ? candidate.mimeType : undefined,
    lastModified: typeof candidate.lastModified === "string" ? candidate.lastModified : undefined,
    eTag: typeof candidate.eTag === "string" ? candidate.eTag : undefined,
    startTime: typeof candidate.startTime === "number" ? candidate.startTime : undefined,
  }
}

function normalizePersistedTask(task: Partial<DownloadTask>): DownloadTask {
  const resumeData = normalizeResumeData(task.resumeData)
  const manuallyPaused = task.manuallyPaused === true
  const interrupted = task.status === "downloading" || task.status === "paused" || task.installing === true
  const recoverable = interrupted && !!resumeData
  return {
    id: task.id || "",
    name: task.name || "Unknown",
    gameId: task.gameId,
    game: task.game || "Unknown",
    url: task.url || "",
    fileName: task.fileName,
    size: task.size || "Unknown",
    status: recoverable ? "paused" : (interrupted ? "error" : (task.status === "done" || task.status === "error" ? task.status : "error")),
    progress: typeof task.progress === "number" ? task.progress : 0,
    speed: interrupted ? undefined : task.speed,
    savePath: typeof task.savePath === "string" ? task.savePath : resumeData?.path,
    error: recoverable ? undefined : (interrupted ? (task.error || "应用已重启，任务未自动恢复，请重新开始下载") : task.error),
    imported: task.imported,
    managedModId: task.managedModId,
    installed: task.installed,
    installedPath: task.installedPath,
    platformModId: task.platformModId,
    platformVersionId: task.platformVersionId,
    autoInstallGamePath: task.autoInstallGamePath,
    conflicts: Array.isArray(task.conflicts) ? task.conflicts.filter((item): item is string => typeof item === "string") : undefined,
    installing: false,
    resumeData,
    manuallyPaused: recoverable && manuallyPaused ? true : undefined,
  }
}

function persistTasks(tasks: DownloadTask[]) {
  if (typeof window === "undefined") {
    return
  }

  if (tasks.length === 0) {
    window.localStorage.removeItem(TASKS_STORAGE_KEY)
    return
  }

  window.localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks))
}

function recoverTasks(): DownloadTask[] {
  if (typeof window === "undefined") {
    return []
  }

  const storedTasks = window.localStorage.getItem(TASKS_STORAGE_KEY)
  if (!storedTasks) return []
  try {
    const parsed = JSON.parse(storedTasks)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .map((item) => normalizePersistedTask(item as Partial<DownloadTask>))
      .filter((item) => Boolean(item.id && item.url))
  } catch {
    return []
  }
}

class DownloadStore {
  private tasks: DownloadTask[] = recoverTasks()
  private listeners = new Set<() => void>()
  private lastProgressMap = new Map<string, { bytes: number; time: number }>()

  private autoResumeRecoverableTasks() {
    if (typeof window === "undefined" || !window.electronAPI) {
      return
    }

    for (const task of this.tasks) {
      if (task.status === "paused" && task.resumeData && task.manuallyPaused !== true) {
        void window.electronAPI.resumeDownload(task.id, task.resumeData)
      }
    }
  }

  constructor() {
    if (typeof window !== "undefined" && window.electronAPI) {
      window.electronAPI.onDownloadEvent((data) => {
        const previous = this.tasks.find((item) => item.id === data.id)
        if (data.status !== "downloading") {
          this.lastProgressMap.delete(data.id)
        }

        this.updateTask(data.id, {
          status: data.status,
          progress: typeof data.percent === "number" ? data.percent : (previous?.progress || 0),
          savePath: data.savePath ?? previous?.savePath,
          error: data.status === "error" ? data.error : undefined,
          speed: data.status === "downloading" ? this.computeSpeed(data.id, data.receivedBytes) : undefined,
          resumeData: data.status === "done" ? undefined : (data.resumeData ?? previous?.resumeData),
          manuallyPaused: data.status === "paused"
            ? previous?.manuallyPaused === true
            : undefined,
        })

        if (data.status === "done" && previous?.autoInstallGamePath && !previous.installed && !previous.installing) {
          void this.installToGame(data.id, previous.autoInstallGamePath)
        }
      })

      this.autoResumeRecoverableTasks()
    }
  }

  getSnapshot = () => this.tasks

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    this.tasks = [...this.tasks]
    persistTasks(this.tasks)
    this.listeners.forEach((listener) => listener())
  }

  private computeSpeed(id: string, receivedBytes?: number) {
    if (!receivedBytes) {
      return undefined
    }

    const now = Date.now()
    const previous = this.lastProgressMap.get(id)
    this.lastProgressMap.set(id, { bytes: receivedBytes, time: now })

    if (!previous || now <= previous.time) {
      return undefined
    }

    const diffBytes = receivedBytes - previous.bytes
    const diffSeconds = (now - previous.time) / 1000
    if (diffBytes <= 0 || diffSeconds <= 0) {
      return undefined
    }

    const speedKb = diffBytes / diffSeconds / 1024
    return speedKb >= 1024 ? `${(speedKb / 1024).toFixed(2)} MB/s` : `${speedKb.toFixed(0)} KB/s`
  }

  async addDownload(task: Partial<DownloadTask> & { id: string; url: string }) {
    if (this.tasks.some((item) => item.url === task.url && item.status !== "error")) {
      return
    }

    this.tasks.push({
      id: task.id,
      name: task.name || "Unknown",
      gameId: task.gameId,
      game: task.game || "Unknown",
      url: task.url,
      fileName: task.fileName,
      size: task.size || "Unknown",
      status: "downloading",
      progress: 0,
      platformModId: task.platformModId,
      platformVersionId: task.platformVersionId,
      autoInstallGamePath: task.autoInstallGamePath,
      resumeData: task.resumeData,
      manuallyPaused: task.manuallyPaused,
    })
    this.emit()

    if (typeof window !== "undefined" && window.electronAPI) {
      const gameName = (task.game || "Unknown").replace(/[\\/:*?"<>|]/g, "_")
      let saveDir: string
      const settings = getDesktopSettings()
      try {
        if (settings.downloadDirectory) {
          await window.electronAPI.authorizeDirectory(settings.downloadDirectory)
          saveDir = `${settings.downloadDirectory}\\mods\\${gameName}`
        } else {
          const modsDir = await window.electronAPI.getAppModsDir()
          saveDir = `${modsDir}\\${gameName}\\_system\\downloads`
        }
      } catch {
        saveDir = `${settings.downloadDirectory || "downloads"}\\mods\\${gameName}`
      }
      void window.electronAPI.startDownload(task.url, task.id, task.fileName, saveDir)
    }
  }

  updateTask(id: string, updates: Partial<DownloadTask>) {
    const index = this.tasks.findIndex((item) => item.id === id)
    if (index === -1) {
      return
    }

    this.tasks[index] = { ...this.tasks[index], ...updates }
    this.emit()
  }

  pause(id: string) {
    this.lastProgressMap.delete(id)
    this.updateTask(id, { status: "paused", speed: undefined, manuallyPaused: true })
    void window.electronAPI?.pauseDownload(id)
  }

  resume(id: string) {
    const task = this.tasks.find((item) => item.id === id)
    this.updateTask(id, { status: "downloading", error: undefined, manuallyPaused: undefined })
    void window.electronAPI?.resumeDownload(id, task?.resumeData)
  }

  cancel(id: string) {
    void window.electronAPI?.cancelDownload(id)
    this.lastProgressMap.delete(id)
    this.tasks = this.tasks.filter((item) => item.id !== id)
    this.emit()
  }

  clearDone() {
    for (const task of this.tasks) {
      if (task.status === "done") {
        this.lastProgressMap.delete(task.id)
      }
    }

    this.tasks = this.tasks.filter((item) => item.status !== "done")
    this.emit()
  }

  toggleAll(pause: boolean) {
    for (const task of this.tasks) {
      if (pause && task.status === "downloading") {
        this.pause(task.id)
      }
      if (!pause && task.status === "paused") {
        this.resume(task.id)
      }
    }
  }

  async openFolder(id: string) {
    const task = this.tasks.find((item) => item.id === id)
    if (!task?.savePath) {
      return
    }

    const folderPath = task.savePath.replace(/[\\/][^\\/]+$/, "")
    await window.electronAPI?.openDirectory(folderPath)
  }

  async installToGame(id: string, gamePath: string) {
    const task = this.tasks.find((item) => item.id === id)
    if (!task?.savePath || task.status !== "done") return false

    try {
      const exists = await window.electronAPI?.fileExists(task.savePath)
      if (!exists) {
        this.updateTask(id, { status: "error", installing: false, error: "下载文件不存在" })
        return false
      }

      const gameId = task.gameId || `custom:${task.game}`
      this.updateTask(id, { installing: true, error: undefined })

      const imported = task.managedModId
        ? { id: task.managedModId }
        : await importDownloadedMod({
            gameId,
            gameName: task.game,
            sourcePath: task.savePath,
            sourceType: "download",
            modName: task.name,
            platformModId: task.platformModId,
            platformVersionId: task.platformVersionId,
            downloadId: task.id,
            fileName: task.fileName,
          })

      const result = await installManagedMod({
        gameId,
        gameName: task.game,
        modId: imported.id,
        gamePath,
      })

      if (!result.ok) {
        this.updateTask(id, { installing: false, error: result.error || "安装失败" })
        return false
      }

      this.updateTask(id, {
        installing: false,
        imported: true,
        managedModId: imported.id,
        installed: true,
        installedPath: gamePath,
        conflicts: result.conflicts,
        error: undefined,
      })
      this.emit()
      return true
    } catch (err) {
      logger.error("installToGame failed", {
        code: "DL-1001",
        download_id: id,
        game_id: task.gameId || `custom:${task.game}`,
        game_name: task.game,
        game_path: gamePath,
        save_path: task.savePath,
      }, err)
      this.updateTask(id, { installing: false, error: err instanceof Error ? err.message : "安装失败" })
      return false
    }
  }

  reset() {
    this.tasks = []
    this.lastProgressMap.clear()
    this.emit()
  }
}

const store = new DownloadStore()

export const useDownloadStore = {
  getState: () => store,
  useStore: () => useSyncExternalStore(store.subscribe, store.getSnapshot),
}
