import { AlertTriangle, Archive, CheckCircle2, ExternalLink, FolderDown, FolderOpen, Loader2, Package, Plus, RefreshCw, Trash2, TrendingUp } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { fetchMods, getDownloadToken } from "@/lib/api"
import { importExternalMod, installManagedMod, listManagedMods, uninstallManagedMod } from "@/lib/mod-manager"
import type { ManagedModSummary } from "@/lib/mod-manager"
import { useDownloadStore } from "@/store/download"

interface GameModManagerPageProps {
  gameId: string
  gameName: string
  localPath: string | undefined
  onSetPath: (gameId: string) => Promise<void> | void
  onNavigate: (tab: string) => void
}

interface PlatformLibraryMod {
  id: string
  title: string
  mod_number?: string
  game?: {
    id?: string
  }
  game_id?: string
  author?: {
    username?: string
  }
  media?: {
    thumbnail_url?: string | null
  } | null
  download_count?: number
  tags?: string[]
}

type NoticeTone = "default" | "success" | "error"
const PLATFORM_MOD_PAGE_SIZE = 48
const PLATFORM_MOD_MAX_PAGES = 5

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function formatDate(value?: string | null) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

export function GameModManagerPage({ gameId, gameName, localPath, onSetPath, onNavigate }: GameModManagerPageProps) {
  const [mods, setMods] = useState<PlatformLibraryMod[]>([])
  const [managedMods, setManagedMods] = useState<ManagedModSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isManagedLoading, setIsManagedLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null)

  const loadManagedMods = useCallback(async () => {
    setIsManagedLoading(true)
    try {
      const items = await listManagedMods(gameId, gameName)
      setManagedMods(items)
    } catch (error) {
      console.error("Failed to load managed mods:", error)
      setManagedMods([])
      setNotice({ tone: "error", text: getErrorMessage(error, "加载本地模组失败") })
    } finally {
      setIsManagedLoading(false)
    }
  }, [gameId, gameName])

  useEffect(() => {
    let isActive = true

    setIsLoading(true)
    async function loadPlatformMods() {
      const matched: PlatformLibraryMod[] = []

      for (let page = 0; page < PLATFORM_MOD_MAX_PAGES; page += 1) {
        const data = await fetchMods({ page, limit: PLATFORM_MOD_PAGE_SIZE })
        const all = ((data as { mods?: PlatformLibraryMod[] }).mods || [])
        matched.push(...all.filter((mod) => mod.game?.id === gameId || mod.game_id === gameId))
        if (all.length < PLATFORM_MOD_PAGE_SIZE || data.total <= (page + 1) * PLATFORM_MOD_PAGE_SIZE) {
          break
        }
      }

      return matched
    }

    loadPlatformMods()
      .then((filtered) => {
        if (!isActive) return
        setMods(filtered)
      })
      .catch((error) => {
        if (!isActive) return
        console.error("Failed to fetch mods:", error)
        setMods([])
      })
      .finally(() => {
        if (isActive) setIsLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [gameId])

  useEffect(() => {
    void loadManagedMods()
  }, [loadManagedMods])

  const installedManagedMods = useMemo(() => managedMods.filter((item) => item.installed), [managedMods])
  const availableManagedMods = useMemo(() => managedMods.filter((item) => !item.installed), [managedMods])

  const openModDetail = (modNumber: string) => {
    onNavigate(`mod:${modNumber}`)
  }

  const openGameFolder = async () => {
    if (localPath) {
      await window.electronAPI?.openDirectory(localPath)
      return
    }

    await onSetPath(gameId)
  }

  const queueDownload = async (mod: PlatformLibraryMod, autoInstall: boolean) => {
    try {
      const tokenInfo = await getDownloadToken(mod.id)
      await useDownloadStore.getState().addDownload({
        id: `dl-${Date.now()}`,
        name: mod.title,
        gameId,
        game: gameName,
        url: tokenInfo.url,
        fileName: tokenInfo.fileName,
        size: tokenInfo.fileSize ? `${(tokenInfo.fileSize / (1024 * 1024)).toFixed(2)} MB` : "未知",
        platformModId: mod.id,
        autoInstallGamePath: autoInstall ? localPath : undefined,
      })
      setNotice({ tone: "success", text: autoInstall ? "已加入下载队列，下载完成后会自动安装" : "已加入下载队列" })
    } catch (error) {
      setNotice({ tone: "error", text: `下载请求失败: ${getErrorMessage(error, "未知错误")}` })
    }
  }

  const handleImportArchive = async () => {
    const sourcePath = await window.electronAPI?.selectModFile()
    if (!sourcePath) {
      return
    }

    setBusyAction("import-archive")
    try {
      await importExternalMod({
        gameId,
        gameName,
        sourcePath,
        sourceType: "archive",
      })
      await loadManagedMods()
      setNotice({ tone: "success", text: "压缩包模组已导入" })
    } catch (error) {
      setNotice({ tone: "error", text: getErrorMessage(error, "导入压缩包失败") })
    } finally {
      setBusyAction(null)
    }
  }

  const handleImportFolder = async () => {
    const sourcePath = await window.electronAPI?.selectDirectory()
    if (!sourcePath) {
      return
    }

    setBusyAction("import-folder")
    try {
      await importExternalMod({
        gameId,
        gameName,
        sourcePath,
        sourceType: "folder",
      })
      await loadManagedMods()
      setNotice({ tone: "success", text: "文件夹模组已导入" })
    } catch (error) {
      setNotice({ tone: "error", text: getErrorMessage(error, "导入文件夹失败") })
    } finally {
      setBusyAction(null)
    }
  }

  const handleInstallManaged = async (modId: string) => {
    if (!localPath) {
      await onSetPath(gameId)
      setNotice({ tone: "default", text: "请先设置游戏目录后再安装模组" })
      return
    }

    setBusyAction(`install:${modId}`)
    try {
      const result = await installManagedMod({
        gameId,
        gameName,
        modId,
        gamePath: localPath,
      })

      if (!result.ok) {
        setNotice({ tone: "error", text: result.error || "安装失败" })
        return
      }

      await loadManagedMods()
      setNotice({
        tone: result.conflicts.length > 0 ? "default" : "success",
        text: result.conflicts.length > 0
          ? `安装完成，检测到 ${result.conflicts.length} 个冲突文件，已按后安装优先覆盖`
          : `安装完成，共部署 ${result.installedPaths} 个文件`,
      })
    } catch (error) {
      setNotice({ tone: "error", text: getErrorMessage(error, "安装失败") })
    } finally {
      setBusyAction(null)
    }
  }

  const handleUninstallManaged = async (modId: string) => {
    if (!localPath) {
      await onSetPath(gameId)
      setNotice({ tone: "default", text: "请先设置游戏目录后再卸载模组" })
      return
    }

    setBusyAction(`uninstall:${modId}`)
    try {
      const result = await uninstallManagedMod({
        gameId,
        gameName,
        modId,
        gamePath: localPath,
      })

      if (!result.ok) {
        setNotice({ tone: "error", text: result.error || "卸载失败" })
        return
      }

      await loadManagedMods()
      setNotice({ tone: "success", text: `卸载完成，已恢复 ${result.restoredPaths} 个路径` })
    } catch (error) {
      setNotice({ tone: "error", text: getErrorMessage(error, "卸载失败") })
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-6 pt-6 pb-4 flex items-center justify-between border-b border-border/50">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{gameName}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {localPath ? (
              <button className="flex items-center gap-1.5 text-green-500/90 hover:text-green-400 transition-colors" onClick={() => void openGameFolder()}>
                <FolderOpen className="w-3.5 h-3.5" />
                <span className="truncate max-w-[360px]" title={localPath}>{localPath}</span>
              </button>
            ) : (
              <button className="flex items-center gap-1.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors" onClick={() => void onSetPath(gameId)}>
                <FolderOpen className="w-3.5 h-3.5" />
                点击设置游戏目录
              </button>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-2 shadow-sm rounded-full px-4" onClick={() => void loadManagedMods()} disabled={isManagedLoading || busyAction === "refresh-managed"}>
            <RefreshCw className={`w-4 h-4 ${isManagedLoading ? "animate-spin" : ""}`} />
            刷新模组库
          </Button>
          <Button size="sm" variant="outline" className="gap-2 shadow-sm rounded-full px-4" onClick={() => void handleImportArchive()} disabled={busyAction === "import-archive"}>
            {busyAction === "import-archive" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
            导入压缩包
          </Button>
          <Button size="sm" variant="outline" className="gap-2 shadow-sm rounded-full px-4" onClick={() => void handleImportFolder()} disabled={busyAction === "import-folder"}>
            {busyAction === "import-folder" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderDown className="w-4 h-4" />}
            导入文件夹
          </Button>
          <Button size="sm" variant="outline" className="gap-2 shadow-sm rounded-full px-4" onClick={() => onNavigate("mods")}>
            <Plus className="w-4 h-4" />
            去模组库添加
          </Button>
          {localPath ? (
            <Button size="sm" variant="outline" className="gap-2 shadow-sm rounded-full px-4" onClick={() => void openGameFolder()}>
              <FolderOpen className="w-4 h-4" />
              打开目录
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-5">
        {notice ? (
          <div className={`mt-5 rounded-xl border px-4 py-3 text-sm flex items-start gap-2 ${
            notice.tone === "error"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : notice.tone === "success"
                ? "border-green-500/30 bg-green-500/10 text-green-400"
                : "border-blue-500/20 bg-blue-500/10 text-blue-400"
          }`}>
            {notice.tone === "error" ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
            <span>{notice.text}</span>
          </div>
        ) : null}

        <section className="pt-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold tracking-tight">本地模组库</h3>
              <p className="text-xs text-muted-foreground mt-1">所有受管模组都保存在桌面端安装目录同级的 mods\{gameName} 下</p>
            </div>
            <div className="text-xs text-muted-foreground">
              已安装 {installedManagedMods.length} 个
              <span className="mx-2 text-border">/</span>
              未安装 {availableManagedMods.length} 个
            </div>
          </div>

          {isManagedLoading ? (
            <div className="rounded-2xl bg-card p-8 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin" />
              <p className="text-sm">正在加载本地模组库...</p>
            </div>
          ) : managedMods.length === 0 ? (
            <div className="rounded-2xl bg-card p-8 flex flex-col items-center justify-center gap-4 text-muted-foreground text-center">
              <Package className="w-12 h-12 text-muted-foreground/30" />
              <div>
                <p className="text-sm font-medium text-foreground/80">还没有导入任何本地模组</p>
                <p className="text-xs mt-1">你可以导入压缩包、导入文件夹，或从 MikuMod 模组库下载后安装</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {managedMods.map((mod) => {
                const isInstalling = busyAction === `install:${mod.id}`
                const isUninstalling = busyAction === `uninstall:${mod.id}`

                return (
                  <div key={mod.id} className="rounded-2xl border border-border bg-card p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground/90">{mod.name}</h4>
                        <p className="text-xs text-muted-foreground mt-1">
                          来源 {mod.sourceType === "archive" ? "压缩包" : mod.sourceType === "folder" ? "文件夹" : "MikuMod 下载"}
                          <span className="mx-2 text-border">/</span>
                          文件 {mod.fileCount}
                          <span className="mx-2 text-border">/</span>
                          导入于 {formatDate(mod.importedAt)}
                        </p>
                      </div>
                      <div className={`text-[11px] px-2 py-1 rounded-full ${mod.installed ? "bg-green-500/10 text-green-400" : "bg-secondary text-secondary-foreground"}`}>
                        {mod.installed ? "已安装" : "未安装"}
                      </div>
                    </div>

                    {mod.conflictCount > 0 ? (
                      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-500 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>检测到 {mod.conflictCount} 个冲突文件</span>
                        </div>
                        <div className="text-yellow-500/80 line-clamp-2">{mod.conflicts.slice(0, 4).join("，")}</div>
                      </div>
                    ) : null}

                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span className="truncate" title={mod.libraryPath}>{mod.libraryPath}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <Button variant="outline" size="sm" className="h-8" onClick={() => void window.electronAPI?.openDirectory(mod.libraryPath)}>
                        <FolderOpen className="w-4 h-4" />
                        打开库目录
                      </Button>
                      {mod.installed ? (
                        <Button size="sm" variant="outline" className="h-8" onClick={() => void handleInstallManaged(mod.id)} disabled={!localPath || isInstalling || isUninstalling}>
                          {isInstalling ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                          重新安装
                        </Button>
                      ) : (
                        <Button size="sm" className="h-8" onClick={() => void handleInstallManaged(mod.id)} disabled={!localPath || isInstalling || isUninstalling}>
                          {isInstalling ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                          安装
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-8 text-destructive hover:text-destructive" onClick={() => void handleUninstallManaged(mod.id)} disabled={!localPath || isInstalling || isUninstalling || !mod.installed}>
                        {isUninstalling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        卸载
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold tracking-tight">MikuMod 模组库</h3>
              <p className="text-xs text-muted-foreground mt-1">支持仅下载入库，也支持下载完成后自动安装到当前游戏目录</p>
            </div>
            <div className="text-xs text-muted-foreground">已匹配 {mods.length} 个模组</div>
          </div>

          {isLoading ? (
            <div className="rounded-2xl bg-card p-8 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin" />
              <p className="text-sm">正在加载模组...</p>
            </div>
          ) : mods.length === 0 ? (
            <div className="rounded-2xl bg-card p-8 flex flex-col items-center justify-center gap-4 text-muted-foreground text-center">
              <Package className="w-12 h-12 text-muted-foreground/20" />
              <div>
                <p className="text-sm font-medium">暂无该游戏的模组</p>
                <p className="text-xs mt-1 text-muted-foreground/60">前往模组库浏览并下载模组</p>
              </div>
              <Button size="sm" className="gap-2 rounded-full px-5" onClick={() => onNavigate("mods")}>
                <Plus className="w-4 h-4" />
                去模组库添加
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {mods.map((mod) => (
                <div key={mod.id} className="group rounded-xl border border-border bg-card overflow-hidden hover:border-blue-500/30 hover:shadow-lg hover:shadow-blue-500/5 transition-all duration-200">
                  <button className="w-full text-left" onClick={() => openModDetail(mod.mod_number || mod.id)}>
                    <div className="aspect-[16/9] bg-gradient-to-br from-muted to-muted/30 relative overflow-hidden">
                      {mod.media?.thumbnail_url ? (
                        <img src={mod.media.thumbnail_url} alt={mod.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      ) : null}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    </div>
                  </button>

                  <div className="p-4 space-y-2">
                    <button className="w-full text-left" onClick={() => openModDetail(mod.mod_number || mod.id)}>
                      <h3 className="font-semibold text-sm leading-tight group-hover:text-blue-400 transition-colors line-clamp-2">{mod.title}</h3>
                    </button>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">by {mod.author?.username || "未知作者"}</span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        {(mod.download_count || 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {(mod.tags || []).slice(0, 3).map((tag: string) => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">{tag}</span>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" size="sm" className="h-8" onClick={() => openModDetail(mod.mod_number || mod.id)}>
                        <ExternalLink className="w-4 h-4" />
                        详情
                      </Button>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => void queueDownload(mod, false)}>
                        <Package className="w-4 h-4" />
                        仅下载
                      </Button>
                      <Button size="sm" className="col-span-2 h-8" onClick={() => void queueDownload(mod, true)} disabled={!localPath}>
                        <CheckCircle2 className="w-4 h-4" />
                        一键安装
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
