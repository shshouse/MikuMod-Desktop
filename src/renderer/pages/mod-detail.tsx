import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  GitBranch,
  Loader2,
  MessageSquare,
  Package,
  ThumbsUp,
  Trash2,
  User,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { fetchModDetail, submitModReview } from "@/lib/api"
import type { ModDetailResponse, ModReviewSummary, ModVersionSummary } from "@/lib/api"
import { queueOneClickInstall, queueXxmiInstall, showOneClickInstallError } from "@/lib/mod-install"
import { listManagedMods, uninstallManagedMod } from "@/lib/mod-manager"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import { useDownloadStore } from "@/store/download"

const MOD_PRESELECT_VERSION_KEY = "mikumod_mod_preselect_version"
const XXMI_MOD_NUMBER = "9"

type ActiveTab = "description" | "versions" | "dependencies" | "reviews"

interface ModDetailPageProps {
  modNumber: string
  localPaths: Record<string, string>
  onSetPath: (gameId: string) => Promise<string | null | undefined>
  onNavigate: (tab: string) => void
  onBack: () => void
  onNavigateToSettings?: () => void
}

interface SessionUser {
  id: string
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误"
}

function formatNumber(num?: number | null): string {
  if (num == null) return "0"
  if (num >= 10000) return `${(num / 10000).toFixed(1)}w`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
  return num.toLocaleString()
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

export function ModDetailPage({ modNumber, localPaths, onSetPath, onNavigate, onBack, onNavigateToSettings }: ModDetailPageProps) {
  const [data, setData] = useState<ModDetailResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [activeTab, setActiveTab] = useState<ActiveTab>("description")
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const [showAllVersions, setShowAllVersions] = useState(false)

  const [reviewContent, setReviewContent] = useState("")
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)

  const [installed, setInstalled] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)

  const downloadTasks = useDownloadStore.useStore()

  const isXxmi = modNumber == XXMI_MOD_NUMBER

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUser(session?.user || null)
    })
  }, [])

  useEffect(() => {
    let isActive = true

    void fetchModDetail(modNumber)
      .then((result) => {
        if (!isActive) return
        if (!result) {
          setError("模组不存在或未通过审核")
          return
        }
        setData(result)
        if (result.versions.length > 0) {
          const preselectKey = `${MOD_PRESELECT_VERSION_KEY}:${modNumber}`
          const preselect = window.sessionStorage.getItem(preselectKey)
          window.sessionStorage.removeItem(preselectKey)
          const matched = preselect && result.versions.find((v) => v.id === preselect)
          setSelectedVersionId(matched ? matched.id : result.versions[0].id)
        }
      })
      .catch((fetchError) => {
        if (!isActive) return
        setError(getErrorMessage(fetchError))
      })
      .finally(() => {
        if (!isActive) return
        setIsLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [modNumber])

  const mod = data?.mod
  const versions: ModVersionSummary[] = data?.versions || []
  const reviews: ModReviewSummary[] = data?.reviews || []
  const dependencies = mod?.dependencies || []

  useEffect(() => {
    if (!mod) return
    const gameId = mod.game?.id || mod.game_id
    if (!gameId) return
    void (async () => {
      try {
        const managed = await listManagedMods(gameId, mod.game?.name || "未知游戏")
        const local = managed.find((m) => m.platformModId === mod.id)
        setInstalled(local?.installed ?? false)
      } catch { /* ignore */ }
    })()
  }, [mod])

  const screenshots = useMemo(() => {
    if (!mod) return []
    return Array.from(new Set([
      mod.media?.thumbnail_url,
      ...(mod.media?.image_urls || []),
    ].filter((url): url is string => !!url)))
  }, [mod])

  const displayedVersions = showAllVersions ? versions : versions.slice(0, 3)

  const startInstall = async () => {
    if (!mod || !data) return
    setDownloading(true)
    try {
      if (isXxmi) {
        await queueXxmiInstall({ detail: data, selectedVersionId })
      } else {
        await queueOneClickInstall({
          detail: data,
          selectedVersionId,
          resolveGamePath: async (gameId) => localPaths[gameId] || await onSetPath(gameId),
        })
      }
    } catch (err) {
      showOneClickInstallError(err)
    } finally {
      setDownloading(false)
    }
  }

  const handleUninstall = async () => {
    if (!mod) return
    const gameId = mod.game?.id || mod.game_id
    if (!gameId) return
    const gameName = mod.game?.name || "未知游戏"
    const gamePath = localPaths[gameId]
    if (!gamePath) return
    setUninstalling(true)
    try {
      const managed = await listManagedMods(gameId, gameName)
      const local = managed.find((m) => m.platformModId === mod.id)
      if (!local) return
      const result = await uninstallManagedMod({ gameId, gameName, modId: local.id, gamePath })
      if (result.ok) {
        setInstalled(false)
      }
    } catch { /* ignore */ } finally {
      setUninstalling(false)
    }
  }

  const handleSubmitReview = async () => {
    if (!reviewContent.trim() || !mod || reviewSubmitting) return
    setReviewSubmitting(true)
    try {
      await submitModReview(mod.id, reviewContent)
      const refreshed = await fetchModDetail(modNumber)
      if (refreshed) setData(refreshed)
      setReviewContent("")
    } catch (submitError) {
      alert(`评测提交失败: ${getErrorMessage(submitError)}`)
    } finally {
      setReviewSubmitting(false)
    }
  }

  const tabs: Array<{ key: ActiveTab; label: string; icon: typeof FileText; count?: number }> = [
    { key: "description", label: "描述", icon: FileText },
    { key: "versions", label: "版本", icon: GitBranch, count: versions.length },
    { key: "dependencies", label: "前置", icon: Package, count: dependencies.length },
    { key: "reviews", label: "评论", icon: MessageSquare, count: reviews.length },
  ]

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm">正在加载模组详情...</p>
      </div>
    )
  }

  if (error || !mod) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
        <Package className="w-12 h-12 text-muted-foreground/20" />
        <p className="text-sm">{error || "模组不存在"}</p>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
          返回
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Gallery + Tabs */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* Gallery */}
        <div className="p-6 pb-0">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="aspect-video bg-muted relative overflow-hidden">
              {screenshots.length > 0 ? (
                screenshots.map((url, idx) => (
                  <img
                    key={`${url}-${idx}`}
                    src={url}
                    alt={mod.title}
                    className={cn(
                      "absolute inset-0 w-full h-full object-contain transition-opacity duration-700",
                      idx === currentImageIndex ? "opacity-100" : "opacity-0",
                    )}
                  />
                ))
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Package className="w-12 h-12 text-muted-foreground" />
                </div>
              )}
            </div>

            {screenshots.length > 1 && (
              <div className="flex gap-2 overflow-x-auto border-t border-border p-3">
                {screenshots.map((url, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentImageIndex(i)}
                    className={cn(
                      "relative h-14 w-20 shrink-0 rounded-lg border-2 overflow-hidden transition-all",
                      i === currentImageIndex
                        ? "border-blue-500 ring-2 ring-blue-500/30"
                        : "border-transparent opacity-70 hover:opacity-100",
                    )}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tabs + Content */}
        <div className="px-6 py-5">
          <div className="border-b border-border mb-5">
            <div className="flex gap-1 overflow-x-auto">
              {tabs.map((tab) => {
                const Icon = tab.icon
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-3 text-sm border-b-2 -mb-px transition-colors",
                      activeTab === tab.key
                        ? "border-blue-500 text-blue-400"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {tab.label}
                    {tab.count !== undefined && (
                      <span className="text-xs">({" "}{tab.count})</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-6">
            {activeTab === "description" && (
              <div className="max-w-none">
                {mod.description ? (
                  <div className="whitespace-pre-wrap text-sm text-foreground/80 leading-relaxed">
                    {mod.description}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">暂无详细描述</p>
                )}
              </div>
            )}

            {activeTab === "versions" && (
              <div className="space-y-3">
                {versions.length > 0 ? (
                  <>
                    {displayedVersions.map((version, idx) => (
                      <div
                        key={version.id}
                        className={cn(
                          "p-4 rounded-lg border transition-colors",
                          version.id === selectedVersionId
                            ? "border-blue-500 bg-blue-500/5"
                            : "border-border hover:border-blue-500/30",
                        )}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-foreground">
                              v{version.version}
                            </span>
                            {idx === 0 && (
                              <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-[10px] rounded-full">
                                最新
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            {formatDate(version.created_at)}
                          </span>
                        </div>

                        {version.changelog && (
                          <p className="text-xs text-muted-foreground mb-3 whitespace-pre-wrap">
                            {version.changelog}
                          </p>
                        )}

                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          {version.file_size && (
                            <span>大小: {(version.file_size / (1024 * 1024)).toFixed(2)} MB</span>
                          )}
                        </div>
                      </div>
                    ))}

                    {versions.length > 3 && (
                      <button
                        onClick={() => setShowAllVersions(!showAllVersions)}
                        className="w-full py-2 text-blue-400 text-sm flex items-center justify-center gap-1 hover:text-blue-300"
                      >
                        {showAllVersions ? "收起" : `查看全部 ${versions.length} 个版本`}
                      </button>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">暂无版本</p>
                )}
              </div>
            )}

            {activeTab === "dependencies" && (
              <div className="space-y-3">
                {dependencies.length > 0 ? (
                  dependencies.map((dep) => (
                    <div
                      key={dep.mod_id}
                      className="flex items-center gap-4 p-3 rounded-lg border border-border hover:border-blue-500/30 transition-colors"
                    >
                      <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center">
                        {dep.thumbnail_url ? (
                          <img src={dep.thumbnail_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Package className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <button
                          className="text-sm font-medium text-foreground hover:text-blue-400 text-left"
                          onClick={() => dep.mod_number && onNavigate(`mod:${dep.mod_number}`)}
                        >
                          {dep.title || "未知模组"}
                        </button>
                        {dep.version_constraint && (
                          <div className="text-xs text-muted-foreground">版本: {dep.version_constraint}</div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">此模组没有前置依赖</p>
                )}
              </div>
            )}

            {activeTab === "reviews" && (
              <div className="space-y-4">
                {currentUser ? (
                  <div className="p-4 rounded-lg border border-border bg-muted/30">
                    <div className="text-sm font-medium text-foreground mb-2">发表评论</div>
                    <textarea
                      value={reviewContent}
                      onChange={(e) => setReviewContent(e.target.value)}
                      placeholder="分享你对这个模组的看法..."
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                      rows={3}
                    />
                    <div className="flex justify-end mt-2">
                      <Button
                        size="sm"
                        onClick={handleSubmitReview}
                        disabled={reviewSubmitting || !reviewContent.trim()}
                      >
                        {reviewSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                        发布
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-lg border border-border bg-muted/30 text-center text-muted-foreground text-sm">
                    登录后可发表评论
                  </div>
                )}

                {reviews.length > 0 ? (
                  reviews.map((review) => (
                    <div key={review.id} className="p-4 rounded-lg border border-border">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-full overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center">
                          {review.user?.avatar_url ? (
                            <img src={review.user.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <User className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <button
                              className="text-sm font-medium text-foreground hover:underline"
                              onClick={() => review.user?.user_number && onNavigate(`user:${review.user.user_number}`)}
                            >
                              {review.user?.username || "匿名用户"}
                            </button>
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(review.created_at), { locale: zhCN, addSuffix: true })}
                            </span>
                          </div>
                          <p className="text-sm text-foreground/80 whitespace-pre-wrap">{review.content}</p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">还没有评论，来说两句吧</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right: Info sidebar card (matches Web端 design) */}
      <aside className="w-72 shrink-0 overflow-y-auto p-5 flex justify-center">
        <div className="w-full max-w-64">
          <div className="bg-card border border-border rounded-xl p-5 space-y-5">
            {/* Title */}
            <h1 className="text-xl font-bold text-foreground">{mod.title}</h1>

            {/* Game chip */}
            <button
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg text-xs text-foreground hover:text-blue-400 transition-colors"
              onClick={() => mod.game?.game_number && onNavigate(`game:${mod.game.game_number}`)}
            >
              <span className="text-[10px] font-medium text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
                {mod.game?.name || "未知游戏"}
              </span>
            </button>

            {/* Stats grid (3-col, matches Web端) */}
            <div className="grid grid-cols-3 gap-4 py-4 border-y border-border">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 text-base font-bold text-foreground">
                  <Download className="w-4 h-4 text-blue-400" />
                  {formatNumber(mod.download_count)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">下载</div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 text-base font-bold text-foreground">
                  <Eye className="w-4 h-4 text-blue-400" />
                  {formatNumber(mod.view_count)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">浏览</div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 text-base font-bold text-foreground">
                  <ThumbsUp className="w-4 h-4 text-blue-400" />
                  {formatNumber(mod.like_count)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">点赞</div>
              </div>
            </div>

            {/* Smart install button */}
            {(() => {
              const hasActiveDownload = downloadTasks.some(
                (t) => t.platformModId === mod.id && (t.status === "downloading" || t.status === "paused")
              )
              const isBusy = downloading || hasActiveDownload

              if (installed) {
                if (isXxmi) {
                  return (
                    <Button
                      className="w-full gap-2"
                      size="lg"
                      onClick={() => { onNavigateToSettings?.(); }}
                    >
                      <Package className="w-4 h-4" />
                      前往 XXMI 设置
                    </Button>
                  )
                }
                return (
                  <Button
                    className="w-full gap-2"
                    size="lg"
                    variant="destructive"
                    onClick={handleUninstall}
                    disabled={uninstalling}
                  >
                    {uninstalling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    {uninstalling ? "卸载中..." : "卸载"}
                  </Button>
                )
              }

              return (
                <Button
                  className="w-full gap-2"
                  size="lg"
                  onClick={() => {
                    if (!mod || !data) return
                    if (isBusy) return
                    void startInstall()
                  }}
                  disabled={isBusy || versions.length === 0}
                >
                  {isBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  {hasActiveDownload ? "下载中..." : (downloading ? "准备中..." : "一键安装")}
                </Button>
              )
            })()}

            {/* Author */}
            {mod.author && (
              <div className="pt-4 border-t border-border">
                <div className="text-[10px] text-muted-foreground mb-2">作者</div>
                <button
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted transition-colors w-full text-left"
                  onClick={() => mod.author?.user_number && onNavigate(`user:${mod.author.user_number}`)}
                >
                  <div className="w-9 h-9 rounded-full overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center">
                    {mod.author.avatar_url ? (
                      <img src={mod.author.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {mod.author.username || "匿名"}
                    </div>
                    {mod.author.bio && (
                      <div className="text-[11px] text-muted-foreground line-clamp-1">{mod.author.bio}</div>
                    )}
                  </div>
                </button>
              </div>
            )}

            {/* Tags */}
            {mod.tags && mod.tags.length > 0 && (
              <div className="pt-4 border-t border-border">
                <div className="text-[10px] text-muted-foreground mb-2">标签</div>
                <div className="flex flex-wrap gap-1.5">
                  {mod.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-1 bg-muted text-muted-foreground text-[11px] rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Time info */}
            <div className="pt-4 border-t border-border text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>发布时间</span>
                <span>{formatDate(mod.created_at)}</span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
