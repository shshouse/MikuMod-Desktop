import { useSyncExternalStore } from "react"
import { getDesktopSettings } from "@/lib/desktop-config"

export interface DownloadTask {
  id: string
  name: string
  game: string
  url: string
  fileName?: string
  size: string
  status: "downloading" | "paused" | "done" | "error"
  progress: number
  speed?: string
  savePath?: string
  error?: string
}

class DownloadStoreEnhanced {
  private tasks: DownloadTask[] = []
  private listeners = new Set<() => void>()
  private lastProgressMap = new Map<string, { bytes: number; time: number }>()

  constructor() {
    if (typeof window !== "undefined" && window.electronAPI) {
      window.electronAPI.onDownloadEvent((data) => {
        this.updateTask(data.id, {
          status: data.status,
          progress: data.percent || 0,
          savePath: data.savePath,
          error: data.error,
          speed: this.computeSpeed(data.id, data.receivedBytes),
        })
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
      game: task.game || "Unknown",
      url: task.url,
      fileName: task.fileName,
      size: task.size || "Unknown",
      status: "downloading",
      progress: 0,
    })
    this.emit()

    if (typeof window !== "undefined" && window.electronAPI) {
      // 按游戏名分子目录：{appDir}/game/{gameName}/
      const gameName = (task.game || "Unknown").replace(/[\\/:*?"<>|]/g, "_")
      let saveDir: string
      try {
        const appDir = await window.electronAPI.getAppDir()
        saveDir = `${appDir}\\mods\\${gameName}`
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
