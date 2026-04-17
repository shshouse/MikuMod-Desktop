import { Download, FolderOpen, Loader2, LogOut, RefreshCcw, Server, Settings2, Sparkles } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { getDesktopSettings, saveDesktopSettings } from "@/lib/desktop-config"
import type { ElectronAPI } from "@/types/electron"
import { supabase } from "@/lib/supabase"
import { useDownloadStoreEnhanced } from "@/store/download-enhanced"

export function SettingsPageEnhanced() {
  const [settings, setSettings] = useState(() => getDesktopSettings())
  const [savedMessage, setSavedMessage] = useState("")

  // Auto-update state
  const [appVersion, setAppVersion] = useState("")
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "available" | "downloading" | "ready" | "not-available" | "error">("idle")
  const [updateInfo, setUpdateInfo] = useState<Awaited<ReturnType<ElectronAPI["updaterCheck"]>>["info"] | null>(null)
  const [updateProgress, setUpdateProgress] = useState(0)
  const [updateError, setUpdateError] = useState("")

  useEffect(() => {
    // Get app version
    window.electronAPI?.getAppVersion?.().then((v) => setAppVersion(v || "dev")).catch(() => setAppVersion("dev"))

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

  const updateSettings = (nextSettings: typeof settings) => {
    setSettings(nextSettings)
    saveDesktopSettings(nextSettings)
    setSavedMessage("设置已保存")
    window.setTimeout(() => setSavedMessage(""), 1500)
  }

  const changeDownloadDirectory = async () => {
    const selectedPath = await window.electronAPI?.selectDirectory()
    if (!selectedPath) {
      return
    }

    updateSettings({ ...settings, downloadDirectory: selectedPath })
  }

  const changeApiBaseUrl = () => {
    const nextApiBaseUrl = window.prompt("请输入 API 基础地址", settings.apiBaseUrl)
    if (!nextApiBaseUrl?.trim()) {
      return
    }

    const normalizedApiBaseUrl = nextApiBaseUrl.trim().replace(/\/+$/, "")
    const inferredWebBaseUrl = normalizedApiBaseUrl.endsWith("/api")
      ? normalizedApiBaseUrl.replace(/\/api$/, "")
      : settings.webBaseUrl

    updateSettings({
      ...settings,
      apiBaseUrl: normalizedApiBaseUrl,
      webBaseUrl: inferredWebBaseUrl,
    })
  }

  const clearLocalCache = () => {
    useDownloadStoreEnhanced.getState().reset()
    window.localStorage.removeItem("mikumod_local_paths")
    window.localStorage.removeItem("mikumod_desktop_custom_games")
    setSavedMessage("本地缓存已清理")
    window.setTimeout(() => setSavedMessage(""), 1500)
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setSavedMessage("已退出登录")
    window.setTimeout(() => setSavedMessage(""), 1500)
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-5 space-y-4">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">偏好设置</h2>
          {savedMessage && <span className="text-xs text-green-400">{savedMessage}</span>}
        </div>

        {/* General config card */}
        <div className="rounded-2xl bg-card overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-2 border-b border-border/50">
            <Settings2 className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-medium">通用配置</h3>
          </div>
          <div className="divide-y divide-border/50">
            <div className="p-4 flex items-center justify-between hover:bg-muted/10 transition-colors">
              <div className="flex gap-4 items-center">
                <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                  <FolderOpen className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground/90">默认下载目录</p>
                  <p className="text-xs text-muted-foreground mt-0.5">模组下载和缓存文件默认保存位置</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-muted-foreground bg-muted px-2.5 py-1.5 rounded-md border border-border max-w-80 truncate">
                  {settings.downloadDirectory}
                </span>
                <Button variant="outline" size="sm" className="h-8" onClick={() => void changeDownloadDirectory()}>
                  更改
                </Button>
              </div>
            </div>

            <div className="p-4 flex items-center justify-between hover:bg-muted/10 transition-colors">
              <div className="flex gap-4 items-center">
                <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                  <Server className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground/90">API 服务源</p>
                  <p className="text-xs text-muted-foreground mt-0.5">当前桌面端使用的社区站点地址</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-muted-foreground bg-muted px-2.5 py-1.5 rounded-md border border-border">
                  {settings.apiBaseUrl}
                </span>
                <Button variant="outline" size="sm" className="h-8" onClick={changeApiBaseUrl}>
                  更改
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Auto-update card */}
        <div className="rounded-2xl bg-card overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-2 border-b border-border/50">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-medium">应用更新</h3>
          </div>
          <div className="p-4">
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
