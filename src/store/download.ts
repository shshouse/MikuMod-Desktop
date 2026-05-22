import { useSyncExternalStore } from "react"
import type { DownloadResumeData } from "@/types/electron"
import { getDesktopSettings, persistKey } from "@/lib/desktop-config"
import { importDownloadedMod, installManagedMod, listManagedMods, uninstallManagedMod } from "@/lib/mod-manager"
import { logger } from "@/lib/logger"

export interface DownloadTask {
  id: string
  name: string
  gameId?: string
  game: string
  url: string
  fileName?: string
  archiveFileName?: string
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
  modNumber?: string
  modStorageId?: string
  autoInstallGamePath?: string
  autoInstallAfterTaskIds?: string[]
  conflicts?: string[]
  installing?: boolean
  resumeData?: DownloadResumeData
  manuallyPaused?: boolean
}

const TASKS_STORAGE_KEY = "mikumod_desktop_download_tasks"
const MOD_STORAGE_ID_PATTERN = /^[A-Za-z0-9]{12}$/
const ARCHIVE_EXTENSION_PATTERN = /\.(zip|rar|7z)$/i

function sanitizeSegment(value: unknown, fallback = "Unknown") {
  const normalized = String(value || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 80)

  return normalized || fallback
}

function normalizeModStorageId(value: unknown) {
  const raw = String(value || "").trim()
  const stem = raw.replace(ARCHIVE_EXTENSION_PATTERN, "")
  return MOD_STORAGE_ID_PATTERN.test(stem) ? stem : undefined
}

function extractModFolderFromPath(pathname: string) {
  let normalizedPath = pathname
  try {
    normalizedPath = decodeURIComponent(pathname)
  } catch {
    normalizedPath = pathname
  }

  const segments = normalizedPath.replace(/^\/+/, "").split("/").filter(Boolean)
  const modsIndex = segments.findIndex((segment) => segment === "mods")
  if (modsIndex === -1) return undefined
  return normalizeModStorageId(segments[modsIndex + 1])
}

function extractModFolderFromUrl(value: unknown) {
  if (typeof value !== "string" || !value) return undefined
  try { return extractModFolderFromPath(new URL(value).pathname) } catch { return extractModFolderFromPath(value) }
}

function resolveDownloadModFolder(task: Partial<DownloadTask> & { url: string }) {
  if (task.modNumber) return sanitizeSegment(task.modNumber)
  return extractModFolderFromUrl(task.url)
    || normalizeModStorageId(task.modStorageId)
    || sanitizeSegment(task.name || task.platformModId)
}

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
    archiveFileName: task.archiveFileName,
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
    modNumber: task.modNumber,
    modStorageId: task.modStorageId,
    autoInstallGamePath: task.autoInstallGamePath,
    autoInstallAfterTaskIds: Array.isArray(task.autoInstallAfterTaskIds) ? task.autoInstallAfterTaskIds.filter((v): v is string => typeof v === "string" && v.length > 0) : undefined,
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
    persistKey(TASKS_STORAGE_KEY, "[]")
    return
  }

  const json = JSON.stringify(tasks)
  window.localStorage.setItem(TASKS_STORAGE_KEY, json)
  persistKey(TASKS_STORAGE_KEY, json)
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
  private autoInstallQueueRunning = false

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

        if (data.status === "done") {
          this.runAutoInstallQueue()
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

  private isAutoInstallReady(task: DownloadTask) {
    if (!task.autoInstallGamePath || task.status !== "done" || task.installed || task.installing) return false
    return (task.autoInstallAfterTaskIds || []).every((id) => this.tasks.find((t) => t.id === id)?.installed === true)
  }

  private runAutoInstallQueue() {
    if (this.autoInstallQueueRunning) return
    this.autoInstallQueueRunning = true
    void (async () => {
      try {
        let progressed = false
        do {
          progressed = false
          for (const task of [...this.tasks]) {
            if (!this.isAutoInstallReady(task)) continue
            const ok = await this.installToGame(task.id, task.autoInstallGamePath!)
            if (!ok) this.updateTask(task.id, { autoInstallGamePath: undefined })
            progressed = ok || progressed
          }
        } while (progressed)
      } finally {
        this.autoInstallQueueRunning = false
        if (this.tasks.some((t) => this.isAutoInstallReady(t))) this.runAutoInstallQueue()
      }
    })()
  }

  private isSameModTask(a: DownloadTask, b: Partial<DownloadTask>) {
    if (!a.platformModId || !b.platformModId || a.platformModId !== b.platformModId) return false
    return !b.platformVersionId || a.platformVersionId === b.platformVersionId
  }

  async addDownload(task: Partial<DownloadTask> & { id: string; url: string }) {
    const existing = this.tasks.find((t) => t.status !== "error" && (t.url === task.url || this.isSameModTask(t, task)))
    if (existing) {
      const merged = {
        autoInstallGamePath: task.autoInstallGamePath || existing.autoInstallGamePath,
        autoInstallAfterTaskIds: [...new Set([...(existing.autoInstallAfterTaskIds || []), ...(task.autoInstallAfterTaskIds || [])])].filter(Boolean) as string[] | undefined,
        platformModId: task.platformModId || existing.platformModId,
        platformVersionId: task.platformVersionId || existing.platformVersionId,
        modNumber: task.modNumber || existing.modNumber,
        archiveFileName: task.archiveFileName || existing.archiveFileName,
      }
      if (merged.autoInstallAfterTaskIds && merged.autoInstallAfterTaskIds.length === 0) merged.autoInstallAfterTaskIds = undefined
      this.updateTask(existing.id, merged)
      this.runAutoInstallQueue()
      return { added: false as const, taskId: existing.id }
    }

    const newTask: DownloadTask = {
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
      modNumber: task.modNumber,
      archiveFileName: task.archiveFileName,
      modStorageId: task.modStorageId,
      autoInstallGamePath: task.autoInstallGamePath,
      autoInstallAfterTaskIds: task.autoInstallAfterTaskIds,
      resumeData: task.resumeData,
      manuallyPaused: task.manuallyPaused,
    }
    this.tasks.push(newTask)
    this.emit()

    if (typeof window !== "undefined" && window.electronAPI) {
      const gameName = sanitizeSegment(task.game)
      const modFolder = resolveDownloadModFolder(task)
      let saveDir: string
      const settings = getDesktopSettings()
      try {
        if (settings.downloadDirectory) {
          await window.electronAPI.authorizeDirectory(settings.downloadDirectory)
          saveDir = `${settings.downloadDirectory}\\mods\\${gameName}\\${modFolder}`
        } else {
          const modsDir = await window.electronAPI.getAppModsDir()
          saveDir = `${modsDir}\\${gameName}\\${modFolder}`
        }
      } catch {
        saveDir = `${settings.downloadDirectory || "downloads"}\\mods\\${gameName}\\${modFolder}`
      }
      void window.electronAPI.startDownload(task.url, task.id, task.fileName, saveDir)
    }
    return { added: true as const, taskId: task.id }
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

      let shouldInstall = true
      if (!task.managedModId && task.platformModId) {
        const managed = await listManagedMods(gameId, task.game)
        const prior = managed.find((m) => m.platformModId === task.platformModId)
        if (prior) {
          if (prior.platformVersionId === task.platformVersionId) {
            shouldInstall = !prior.installed
          } else if (prior.installed) {
            const uninstallResult = await uninstallManagedMod({ gameId, gameName: task.game, modId: prior.id, gamePath })
            if (!uninstallResult.ok) {
              this.updateTask(id, { installing: false, error: uninstallResult.error || "旧版本卸载失败" })
              return false
            }
          }
        }
      }

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
            modNumber: task.modNumber,
            downloadId: task.id,
            fileName: task.fileName,
            archiveFileName: task.archiveFileName,
          })

      if (!shouldInstall) {
        this.updateTask(id, { installing: false, imported: true, managedModId: imported.id, installed: true, installedPath: gamePath, error: undefined })
        this.emit()
        return true
      }

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
