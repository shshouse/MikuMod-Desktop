import { Download, ExternalLink, FolderOpen, Loader2, LogOut, Play, RefreshCcw, Sparkles, Trash2 } from "lucide-react"
import { useEffect, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import type { ElectronAPI } from "@/types/electron"
import { signOutDesktop } from "@/lib/supabase"
import { showToast } from "@/lib/toast"
import { useDownloadStore } from "@/store/download"

type XxmiFrameworkInfo = {
  installed: boolean
  version: string | null
  launcherExe: string | null
  frameworksDir: string
  miStatuses: Array<{
    runtimeName: string
    gameName: string
    installed: boolean
    modsCount: number
    modsDir: string | null
  }>
}

type XxmiGameBinding = {
  gameName: string
  miName: string
  gameExePath: string
  gameRootDir: string
}

const MI_LABELS: Record<string, { label: string; game: string }> = {
  GIMI: { label: 'GIMI', game: 'Genshin Impact' },
  SRMI: { label: 'SRMI', game: 'Honkai: Star Rail' },
  WWMI: { label: 'WWMI', game: 'Wuthering Waves' },
  ZZMI: { label: 'ZZMI', game: 'Zenless Zone Zero' },
  EFMI: { label: 'EFMI', game: 'Endfield' },
  HIMI: { label: 'HIMI', game: 'Honkai Impact 3rd' },
}

interface SettingsPageProps {
  onNavigate: (tab: string) => void
}

export function SettingsPage({ onNavigate }: SettingsPageProps) {
  const [savedMessage, setSavedMessage] = useState("")

  // Auto-update state
  const [appVersion, setAppVersion] = useState("")
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "available" | "downloading" | "ready" | "not-available" | "error">("idle")
  const [updateInfo, setUpdateInfo] = useState<Awaited<ReturnType<ElectronAPI["updaterCheck"]>>["info"] | null>(null)
  const [updateProgress, setUpdateProgress] = useState(0)
  const [updateError, setUpdateError] = useState("")

  // XXMI state
  const [xxmiInfo, setXxmiInfo] = useState<XxmiFrameworkInfo | null>(null)
  const [xxmiLoading, setXxmiLoading] = useState(false)
  const [xxmiBindings, setXxmiBindings] = useState<Record<string, XxmiGameBinding>>({})
  const [xxmiUninstallConfirm, setXxmiUninstallConfirm] = useState(false)

  const refreshXxmiInfo = useCallback(async () => {
    if (!window.electronAPI?.xxmiGetFrameworkInfo) return
    setXxmiLoading(true)
    try {
      const info = await window.electronAPI.xxmiGetFrameworkInfo()
      setXxmiInfo(info)
      // Load bindings for each game
      const bindings: Record<string, XxmiGameBinding> = {}
      for (const mi of info.miStatuses) {
        if (mi.installed) {
          const binding = await window.electronAPI.xxmiGetBinding?.(mi.gameName)
          if (binding) bindings[mi.gameName] = binding
        }
      }
      setXxmiBindings(bindings)
    } catch (e) {
      console.error('Failed to get XXMI info:', e)
    } finally {
      setXxmiLoading(false)
    }
  }, [])

  useEffect(() => {
    // Get app version
    window.electronAPI?.getAppVersion?.().then((v) => setAppVersion(v || "dev")).catch(() => setAppVersion("dev"))

    // Load XXMI info
    refreshXxmiInfo()

    // Listen for updater events
    window.electronAPI?.onUpdaterEvent?.((data) => {
      switch (data.type) {
        case "update-available":
          setUpdateStatus("available")
          setUpdateInfo(data.info)
          break
        case "update-not-available":
          setUpdateStatus("not-available")
          break
        case "download-progress":
          setUpdateStatus("downloading")
          setUpdateProgress(data.progress?.percent || 0)
          break
        case "update-downloaded":
          setUpdateStatus("ready")
          break
        case "error":
          setUpdateStatus("error")
          setUpdateError(data.error || "未知错误")
          break
      }
    })
  }, [])

  const clearLocalCache = () => {
    useDownloadStore.getState().reset()
    window.localStorage.removeItem("mikumod_local_paths")
    window.localStorage.removeItem("mikumod_desktop_custom_games")
    setSavedMessage("本地缓存已清理")
    showToast({ message: "本地缓存已清理 (ﾉ>ω<)ﾉ", type: "success" })
    window.setTimeout(() => setSavedMessage(""), 1500)
  }

  const logout = async () => {
    showToast({ message: "退出登录中 (づ｡◕‿‿◕｡)づ", type: "info", duration: 1200 })
    await signOutDesktop()
    showToast({ message: "已退出登录 (｀・ω・´)", type: "success" })
    onNavigate("mods")
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-5 space-y-4">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">偏好设置</h2>
          {savedMessage && <span className="text-xs text-green-400">{savedMessage}</span>}
        </div>

        {/* Auto-update card */}
        <div className="rounded-2xl bg-card overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-2 border-b border-border/50">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-medium">应用更新</h3>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground/90">当前版本</p>
                <p className="text-xs text-muted-foreground mt-0.5">v{appVersion || "..."}</p>
              </div>

              {updateStatus === "idle" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-2 rounded-lg"
                  onClick={async () => {
                    setUpdateStatus("checking")
                    setUpdateError("")
                    const result = await window.electronAPI?.updaterCheck?.()
                    if (result && !result.available && result.reason !== undefined) {
                      if (result.reason === "updater-not-available") {
                        setUpdateStatus("not-available")
                      } else {
                        setUpdateStatus("error")
                        setUpdateError(result.reason || "检查失败")
                      }
                    }
                    // If available, the updater-event listener will handle it
                  }}
                >
                  <RefreshCcw className="w-3.5 h-3.5" />
                  检查更新
                </Button>
              )}
              {updateStatus === "checking" && (
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  正在检查...
                </span>
              )}
              {updateStatus === "not-available" && (
                <span className="text-xs text-green-400">已是最新版本</span>
              )}
              {updateStatus === "available" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-2 rounded-lg"
                  onClick={async () => {
                    setUpdateStatus("downloading")
                    await window.electronAPI?.updaterDownload?.()
                  }}
                >
                  <Download className="w-3.5 h-3.5" />
                  下载更新 {updateInfo?.version ? `v${updateInfo.version}` : ""}
                </Button>
              )}
              {updateStatus === "downloading" && (
                <div className="flex items-center gap-3">
                  <div className="w-32 h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full bg-purple-500 transition-all" style={{ width: `${updateProgress}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground">{Math.round(updateProgress)}%</span>
                </div>
              )}
              {updateStatus === "ready" && (
                <Button
                  size="sm"
                  className="h-8 gap-2 rounded-lg"
                  onClick={() => window.electronAPI?.updaterInstall?.()}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  立即重启安装
                </Button>
              )}
              {updateStatus === "error" && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-destructive">{updateError}</span>
                  <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg" onClick={() => setUpdateStatus("idle")}>
                    重试
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* XXMI Launcher card */}
        <div className="rounded-2xl bg-card overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-2 border-b border-border/50">
            <Play className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-medium">XXMI Launcher</h3>
            {xxmiInfo?.version && <span className="text-xs text-muted-foreground ml-2">v{xxmiInfo.version}</span>}
          </div>
          <div className="p-4 space-y-4">
            {xxmiLoading && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!xxmiLoading && !xxmiInfo?.installed && (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground mb-3">尚未导入 XXMI Launcher</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-2 rounded-lg"
                  onClick={async () => {
                    const zipPath = await window.electronAPI?.selectModFile?.()
                    if (!zipPath) return
                    setXxmiLoading(true)
                    try {
                      const result = await window.electronAPI?.xxmiImportPackage?.(zipPath)
                      if (result?.success) {
                        showToast({ message: `XXMI ${result.version ?? ''} 导入成功`, type: 'success' })
                        await refreshXxmiInfo()
                      } else {
                        showToast({ message: result?.error || '导入失败', type: 'error' })
                      }
                    } catch (e: any) {
                      showToast({ message: e.message || '导入失败', type: 'error' })
                    } finally {
                      setXxmiLoading(false)
                    }
                  }}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  导入 XXMI 便携包
                </Button>
              </div>
            )}
            {!xxmiLoading && xxmiInfo?.installed && (
              <>
                <div className="space-y-2">
                  {xxmiInfo.miStatuses.filter(mi => mi.installed).map(mi => {
                    const binding = xxmiBindings[mi.gameName]
                    return (
                      <div key={mi.runtimeName} className="flex items-center justify-between p-2 rounded-lg bg-secondary/50">
                        <div>
                          <p className="text-sm font-medium">{MI_LABELS[mi.runtimeName]?.game || mi.gameName}</p>
                          <p className="text-xs text-muted-foreground">{mi.modsCount} Mods</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {binding && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1.5 rounded-lg text-xs"
                              onClick={async () => {
                                const result = await window.electronAPI?.xxmiCreateShortcut?.(mi.gameName, mi.runtimeName, binding.gameExePath)
                                if (result?.success) {
                                  showToast({ message: `快捷方式已创建`, type: 'success' })
                                } else {
                                  showToast({ message: result?.error || '创建失败', type: 'error' })
                                }
                              }}
                            >
                              <ExternalLink className="w-3 h-3" />
                              创建快捷方式
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 rounded-lg text-xs"
                            onClick={async () => {
                              if (!binding) {
                                const gameExe = await window.electronAPI?.selectModFile?.()
                                if (!gameExe) return
                                await window.electronAPI?.xxmiBindGame?.(mi.gameName, mi.runtimeName, gameExe)
                                await refreshXxmiInfo()
                                showToast({ message: '游戏已绑定', type: 'success' })
                              } else {
                                const result = await window.electronAPI?.xxmiLaunchGame?.(mi.gameName, binding.gameExePath)
                                if (result?.success) {
                                  showToast({ message: '游戏已启动', type: 'success' })
                                } else {
                                  showToast({ message: result?.error || '启动失败', type: 'error' })
                                }
                              }
                            }}
                          >
                            <Play className="w-3 h-3" />
                            {binding ? '启动' : '绑定游戏'}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="pt-2 border-t border-border/50">
                  <Button
                    variant={xxmiUninstallConfirm ? "destructive" : "outline"}
                    size="sm"
                    className="h-7 gap-1.5 rounded-lg text-xs"
                    onClick={async () => {
                      if (!xxmiUninstallConfirm) {
                        setXxmiUninstallConfirm(true)
                        return
                      }
                      setXxmiLoading(true)
                      try {
                        await window.electronAPI?.xxmiUninstall?.()
                        showToast({ message: 'XXMI 已卸载', type: 'success' })
                        setXxmiUninstallConfirm(false)
                        await refreshXxmiInfo()
                      } catch (e: any) {
                        showToast({ message: e.message || '卸载失败', type: 'error' })
                      } finally {
                        setXxmiLoading(false)
                      }
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                    {xxmiUninstallConfirm ? '确认卸载?' : '卸载 XXMI'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Danger zone card */}
        <div className="rounded-2xl bg-destructive/5 border border-destructive/20 overflow-hidden">
          <div className="px-4 py-3 border-b border-destructive/10">
            <h3 className="text-sm font-medium text-destructive/80">危险操作</h3>
          </div>
          <div className="divide-y divide-destructive/10">
            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground/90">清理本地缓存</p>
                <p className="text-xs text-muted-foreground mt-0.5">清理下载队列、本地路径缓存和手动添加的游戏</p>
              </div>
              <Button variant="outline" size="sm" className="h-8 gap-2 rounded-lg border-destructive/20 hover:bg-destructive/10 hover:text-destructive" onClick={clearLocalCache}>
                <RefreshCcw className="w-3.5 h-3.5" />
                清理
              </Button>
            </div>

            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground/90">退出登录</p>
                <p className="text-xs text-muted-foreground mt-0.5">断开当前账号与桌面端的会话</p>
              </div>
              <Button variant="destructive" size="sm" className="h-8 gap-2 rounded-lg" onClick={() => void logout()}>
                <LogOut className="w-3.5 h-3.5" />
                退出账号
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
