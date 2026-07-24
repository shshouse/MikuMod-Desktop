import { AlertTriangle, Archive, CheckCircle2, ExternalLink, FolderDown, FolderOpen, Gamepad2, Loader2, Package, Play, Plus, RefreshCw, Trash2, TrendingUp } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { fetchMods } from "@/lib/api"
import { importExternalMod, installManagedMod, listManagedMods, uninstallManagedMod, deleteManagedMod } from "@/lib/mod-manager"
import type { ManagedModSummary } from "@/lib/mod-manager"
import { queueOneClickInstallByModNumber, showOneClickInstallError } from "@/lib/mod-install"
import { showConfirm } from "@/lib/confirm"
import { useDownloadStore } from "@/store/download"

interface GameModManagerPageProps {
  gameId: string
  gameName: string
  coverImage?: string
  localPath: string | undefined
  onSetPath: (gameId: string) => Promise<string | null | undefined>
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

export function GameModManagerPage({ gameId, gameName, coverImage, localPath, onSetPath, onNavigate }: GameModManagerPageProps) {
  const [mods, setMods] = useState<PlatformLibraryMod[]>([])
  const [managedMods, setManagedMods] = useState<ManagedModSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isManagedLoading, setIsManagedLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null)
  const downloadTasks = useDownloadStore.useStore()

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
  const managedByPlatformId = useMemo(() => new Map(managedMods.filter((item) => item.platformModId).map((item) => [item.platformModId!, item])), [managedMods])
  const managedByModNumber = useMemo(() => new Map(managedMods.filter((item) => item.modNumber).map((item) => [String(item.modNumber), item])), [managedMods])
  const installedTaskSignature = useMemo(() => downloadTasks
    .filter((task) => task.installed && ((task.gameId && task.gameId === gameId) || task.game === gameName))
    .map((task) => `${task.id}:${task.managedModId || ""}:${task.platformModId || ""}:${task.platformVersionId || ""}`)
    .join("|"), [downloadTasks, gameId, gameName])

  useEffect(() => {
    if (!installedTaskSignature) return
    void loadManagedMods()
  }, [installedTaskSignature, loadManagedMods])

  const getLocalPlatformMod = (mod: PlatformLibraryMod) => {
    return managedByPlatformId.get(mod.id) || (mod.mod_number ? managedByModNumber.get(String(mod.mod_number)) : undefined)
  }

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

  const queueInstall = async (mod: PlatformLibraryMod) => {
    if (!mod.mod_number) { openModDetail(mod.mod_number || mod.id); return }
    try {
      await queueOneClickInstallByModNumber({
        modNumber: mod.mod_number,
        resolveGamePath: async (gid) => localPaths[gid] || localPath || await onSetPath(gid),
      })
    } catch (error) {
      showOneClickInstallError(error)
    }
  }

  const localPaths: Record<string, string> = localPath ? { [gameId]: localPath } : {}

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

  const handleDeleteManaged = async (modId: string) => {
    const mod = managedMods.find((m) => m.id === modId)
    const confirmed = await showConfirm({
      title: "删除本地模组",
      message: `确定要删除「${mod?.name || modId}」吗？\n这会同时删除本地库目录和模组记录，不可恢复。`,
      confirmText: "删除",
      cancelText: "取消",
    })
    if (!confirmed) return

    setBusyAction(`delete:${modId}`)
    try {
      const result = await deleteManagedMod({ gameId, gameName, modId })

      if (!result.ok) {
        setNotice({ tone: "error", text: result.error || "删除失败" })
        return
      }

      await loadManagedMods()
      setNotice({ tone: "success", text: "已删除本地模组记录及文件" })
    } catch (error) {
      setNotice({ tone: "error", text: getErrorMessage(error, "删除失败") })
    } finally {
      setBusyAction(null)
    }
  }

  const handleLaunchGame = async () => {
    setBusyAction("launch")
    try {
      const binding = await window.electronAPI?.xxmiGetBinding?.(gameName)
      if (!binding) {
        setNotice({ tone: "default", text: "请先在「设置 -> XXMI Launcher」绑定游戏" })
        return
      }
      const result = await window.electronAPI?.xxmiLaunchGame?.(gameName, binding.gameExePath)
      if (!result?.success) {
        setNotice({ tone: "error", text: result?.error || "启动失败" })
        return
      }
      setNotice({ tone: "success", text: "游戏已启动 (XXMI 模式)" })
    } catch (error) {
      setNotice({ tone: "error", text: getErrorMessage(error, "启动失败") })
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Steam 风格 hero banner */}
      <div className="relative h-[360px] w-full shrink-0 overflow-hidden">
        {coverImage ? (
          <img
            src={coverImage}
            alt={gameName}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-blue-900 via-slate-900 to-black flex items-center justify-center">
            <Gamepad2 className="w-20 h-20 text-white/10" />
          </div>
        )}
        {/* 渐变遮罩 */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/50 to-[#0f1419]/95" />
        {/* hero 内容 */}
        <div className="absolute bottom-0 left-0 right-0 p-8">
          <div className="max-w-[1200px] mx-auto">
            <h1 className="text-3xl font-bold text-white mb-4 drop-shadow-lg tracking-tight">{gameName}</h1>
            <div className="flex items-center gap-4 flex-wrap">
              <Button
                size="lg"
                className="gap-2 px-6 shadow-lg rounded-lg"
                onClick={() => void handleLaunchGame()}
                disabled={busyAction === "launch"}
              >
                {busyAction === "launch" ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                启动游戏
              </Button>
              {localPath ? (
                <button
                  className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition-colors cursor-pointer"
                  onClick={() => void openGameFolder()}
                >
                  <FolderOpen className="w-4 h-4" />
                  <span className="truncate max-w-[360px]" title={localPath}>{localPath}</span>
                </button>
              ) : (
                <Button
                  variant="outline"
                  className="gap-2 border-white/30 text-white hover:bg-white/10 hover:text-white"
                  onClick={() => void onSetPath(gameId)}
                >
                  <FolderOpen className="w-4 h-4" />
                  设置游戏目录
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 操作栏 */}
      <div className="sticky top-0 z-10 border-b border-border/50 bg-card/95 backdrop-blur px-6 py-3">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">本地模组库</span>
            <span className="text-xs text-muted-foreground">
              已安装 {installedManagedMods.length} / 未安装 {availableManagedMods.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5 rounded-lg" onClick={() => void loadManagedMods()} disabled={isManagedLoading}>
              <RefreshCw className={`w-3.5 h-3.5 ${isManagedLoading ? "animate-spin" : ""}`} />
              刷新
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 rounded-lg" onClick={() => void handleImportArchive()} disabled={busyAction === "import-archive"}>
              {busyAction === "import-archive" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
              导入压缩包
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 rounded-lg" onClick={() => void handleImportFolder()} disabled={busyAction === "import-folder"}>
              {busyAction === "import-folder" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderDown className="w-3.5 h-3.5" />}
              导入文件夹
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 rounded-lg" onClick={() => onNavigate("mods")}>
              <Plus className="w-3.5 h-3.5" />
              去模组库
            </Button>
            {localPath ? (
              <Button size="sm" variant="outline" className="gap-1.5 rounded-lg" onClick={() => void openGameFolder()}>
                <FolderOpen className="w-3.5 h-3.5" />
                打开目录
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 px-6 pb-6">
        <div className="max-w-[1200px] mx-auto space-y-6 pt-6">
          {notice ? (
            <div className={`rounded-xl border px-4 py-3 text-sm flex items-start gap-2 ${
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

          {/* 本地模组库 */}
          <section className="space-y-4">
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
                  const isDeleting = busyAction === `delete:${mod.id}`

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
                        <Button variant="outline" size="sm" className="h-8" onClick={() => void window.electronAPI?.openDirectory(mod.libraryPath)} disabled={isDeleting}>
                          <FolderOpen className="w-4 h-4" />
                          打开库目录
                        </Button>
                        {mod.installed ? (
                          <Button size="sm" variant="outline" className="h-8" onClick={() => void handleInstallManaged(mod.id)} disabled={!localPath || isInstalling || isUninstalling || isDeleting}>
                            {isInstalling ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                            重新安装
                          </Button>
                        ) : (
                          <Button size="sm" className="h-8" onClick={() => void handleInstallManaged(mod.id)} disabled={!localPath || isInstalling || isUninstalling || isDeleting}>
                            {isInstalling ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                            安装
                          </Button>
                        )}
                        {mod.installed ? (
                          <Button size="sm" variant="outline" className="h-8 text-destructive hover:text-destructive" onClick={() => void handleUninstallManaged(mod.id)} disabled={!localPath || isInstalling || isUninstalling || isDeleting}>
                            {isUninstalling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            卸载
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className="h-8 text-destructive hover:text-destructive" onClick={() => void handleDeleteManaged(mod.id)} disabled={isInstalling || isUninstalling || isDeleting}>
                            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            删除
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* 平台模组库 */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold tracking-tight">MikuMod 模组库</h3>
                <p className="text-xs text-muted-foreground mt-1">一键安装模组到当前游戏目录，自动处理前置依赖</p>
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
                {mods.map((mod) => {
                  const localMod = getLocalPlatformMod(mod)

                  return (
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
                        <Button size="sm" className="h-8" onClick={() => localMod && !localMod.installed ? void handleInstallManaged(localMod.id) : void queueInstall(mod)} disabled={localMod?.installed}>
                          <CheckCircle2 className="w-4 h-4" />
                          {localMod?.installed ? "已安装" : localMod ? "安装" : "一键安装"}
                        </Button>
                      </div>
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
