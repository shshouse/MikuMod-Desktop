import { useSyncExternalStore } from "react"
import { getDesktopSettings } from "@/lib/desktop-config"
import { importDownloadedMod, installManagedMod } from "@/lib/mod-manager"

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
}

class DownloadStoreEnhanced {
  private tasks: DownloadTask[] = []
  private listeners = new Set<() => void>()
  private lastProgressMap = new Map<string, { bytes: number; time: number }>()

  constructor() {
    if (typeof window !== "undefined" && window.electronAPI) {
      window.electronAPI.onDownloadEvent((data) => {
        const previous = this.tasks.find((item) => item.id === data.id)
        this.updateTask(data.id, {
          status: data.status,
          progress: data.percent || 0,
          savePath: data.savePath,
          error: data.error,
          speed: this.computeSpeed(data.id, data.receivedBytes),
        })

        if (data.status === "done" && previous?.autoInstallGamePath && !previous.installed && !previous.installing) {
          void this.installToGame(data.id, previous.autoInstallGamePath)
        }
      })
    }
  }

  getSnapshot = () => this.tasks

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    this.tasks = [...this.tasks]
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
    })
    this.emit()

    if (typeof window !== "undefined" && window.electronAPI) {
      const gameName = (task.game || "Unknown").replace(/[\\/:*?"<>|]/g, "_")
      let saveDir: string
      try {
        const appDir = await window.electronAPI.getAppDir()
        saveDir = `${appDir}\\mods\\${gameName}\\_system\\downloads`
      } catch {
        saveDir = `${getDesktopSettings().downloadDirectory}\\mods\\${gameName}`
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
    void window.electronAPI?.pauseDownload(id)
  }

  resume(id: string) {
    void window.electronAPI?.resumeDownload(id)
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
        this.updateTask(id, { error: "下载文件不存在" })
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
      console.error("installToGame error:", err)
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

const store = new DownloadStoreEnhanced()

export const useDownloadStoreEnhanced = {
  getState: () => store,
  useStore: () => useSyncExternalStore(store.subscribe, store.getSnapshot),
}
