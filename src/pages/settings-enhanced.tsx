import { FolderOpen, LogOut, RefreshCcw, Server, Settings2 } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { DEFAULT_SETTINGS, getDesktopSettings, saveDesktopSettings } from "@/lib/desktop-config"
import { supabase } from "@/lib/supabase"
import { useDownloadStoreEnhanced } from "@/store/download-enhanced"

export function SettingsPageEnhanced() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [savedMessage, setSavedMessage] = useState("")

  useEffect(() => {
    setSettings(getDesktopSettings())
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
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border/50">
        <h2 className="text-xl font-semibold tracking-tight">偏好设置</h2>
        <p className="text-sm text-muted-foreground mt-1">配置下载目录、接口来源和本地状态</p>
        {savedMessage && <p className="text-xs text-green-400 mt-2">{savedMessage}</p>}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <section className="space-y-4">
          <h3 className="text-sm font-medium flex items-center gap-2 text-foreground/80">
            <Settings2 className="w-4 h-4 text-blue-400" />
            通用配置
          </h3>

          <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
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
        </section>

        <section className="space-y-4 pt-4">
          <h3 className="text-sm font-medium text-destructive/80 pl-1">危险操作</h3>

          <div className="rounded-xl border border-destructive/20 bg-destructive/5 overflow-hidden divide-y divide-destructive/10">
            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground/90">清理本地缓存</p>
                <p className="text-xs text-muted-foreground mt-0.5">清理下载队列、本地路径缓存和手动添加的游戏</p>
              </div>
              <Button variant="outline" size="sm" className="h-8 gap-2 border-destructive/20 hover:bg-destructive/10 hover:text-destructive" onClick={clearLocalCache}>
                <RefreshCcw className="w-3.5 h-3.5" />
                清理
              </Button>
            </div>

            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground/90">退出登录</p>
                <p className="text-xs text-muted-foreground mt-0.5">断开当前账号与桌面端的会话</p>
              </div>
              <Button variant="destructive" size="sm" className="h-8 gap-2" onClick={() => void logout()}>
                <LogOut className="w-3.5 h-3.5" />
                退出账号
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
