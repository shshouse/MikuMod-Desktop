import { useSyncExternalStore } from 'react'

export interface DownloadTask {
  id: string
  name: string
  game: string
  url: string
  fileName?: string
  size: string
  status: 'downloading' | 'paused' | 'done' | 'error'
  progress: number
  speed?: string
  savePath?: string
  error?: string
}

class DownloadStore {
  private tasks: DownloadTask[] = []
  private listeners: Set<() => void> = new Set()

  constructor() {
    // Listen to IPC events 
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      (window as any).electronAPI.onDownloadEvent((data: any) => {
        this.updateTask(data.id, {
          status: data.status,
          progress: data.percent || 0,
          savePath: data.savePath,
          error: data.error,
          // Calculate speed later or pass from main process
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
    this.listeners.forEach(l => l())
  }

  addDownload(task: Partial<DownloadTask> & { id: string; url: string }) {
    this.tasks.push({
      id: task.id,
      name: task.name || 'Unknown',
      game: task.game || 'Unknown',
      url: task.url,
      fileName: task.fileName,
      size: task.size || '未知',
      status: 'downloading',
      progress: 0,
    })
    this.emit()

    // Start IPC download
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      (window as any).electronAPI.startDownload(task.url, task.id, task.fileName)
    }
  }

  updateTask(id: string, updates: Partial<DownloadTask>) {
    const idx = this.tasks.findIndex(t => t.id === id)
    if (idx !== -1) {
      this.tasks[idx] = { ...this.tasks[idx], ...updates }
      this.emit()
    }
  }

  pause(id: string) {
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      (window as any).electronAPI.pauseDownload(id)
    }
  }

  resume(id: string) {
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      (window as any).electronAPI.resumeDownload(id)
    }
  }

  cancel(id: string) {
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      (window as any).electronAPI.cancelDownload(id)
    }
    this.tasks = this.tasks.filter(t => t.id !== id)
    this.emit()
  }

  clearDone() {
    this.tasks = this.tasks.filter(t => t.status !== 'done')
    this.emit()
  }
}

const store = new DownloadStore()

export const useDownloadStore = {
  getState: () => store,
  useStore: () => useSyncExternalStore(store.subscribe, store.getSnapshot)
}
