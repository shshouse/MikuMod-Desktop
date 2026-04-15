import {
  ArrowLeft,
  Calendar,
  Download,
  Eye,
  FileText,
  Loader2,
  MessageSquare,
  Package,
  Star,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  User,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { fetchModDetail, getDownloadToken, submitModReview } from "@/lib/api"
import { useDownloadStoreEnhanced } from "@/store/download-enhanced"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"

interface ModDetailPageProps {
  modNumber: string
  onNavigate: (tab: string) => void
  onBack: () => void
}

export function ModDetailPage({ modNumber, onNavigate, onBack }: ModDetailPageProps) {
  const [data, setData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [activeTab, setActiveTab] = useState<"description" | "versions" | "reviews">("description")
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [downloading, setDownloading] = useState(false)

  // Review state
  const [reviewContent, setReviewContent] = useState("")
  const [reviewPositive, setReviewPositive] = useState(true)
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const [currentUser, setCurrentUser] = useState<any>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUser(session?.user || null)
    })
  }, [])

  useEffect(() => {
    setIsLoading(true)
    setError("")
    fetchModDetail(modNumber)
      .then((result) => {
        if (!result) {
          setError("模组不存在或未通过审核")
          return
        }
        setData(result)
        if (result.versions?.length > 0) {
          setSelectedVersionId(result.versions[0].id)
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false))
  }, [modNumber])

  const mod = data?.mod
  const versions = data?.versions || []
  const reviews = data?.reviews || []
  const selectedVersion = versions.find((v: any) => v.id === selectedVersionId) || versions[0]

  const screenshots = useMemo(() => {
    if (!mod) return []
    const urls: string[] = []
    if (mod.thumbnail_url) urls.push(mod.thumbnail_url)
    if (mod.screenshot_urls) urls.push(...mod.screenshot_urls)
    return urls
  }, [mod])

  const positiveCount = reviews.filter((r: any) => r.is_positive).length
  const negativeCount = reviews.filter((r: any) => !r.is_positive).length

  const startDownload = async () => {
    if (!mod) return
    setDownloading(true)
    try {
      const tokenInfo = await getDownloadToken(mod.mod_number, selectedVersionId || undefined)
      useDownloadStoreEnhanced.getState().addDownload({
        id: `dl-${Date.now()}`,
        name: mod.title,
        gameId: mod.game?.id || mod.game_id,
        game: mod.game?.name || "未知游戏",
        url: tokenInfo.url,
        fileName: tokenInfo.fileName,
        size: tokenInfo.fileSize ? `${(tokenInfo.fileSize / (1024 * 1024)).toFixed(2)} MB` : "未知",
        platformModId: mod.id,
        platformVersionId: selectedVersion?.id,
      })
    } catch (err: any) {
      alert(`下载失败: ${err.message}`)
    } finally {
      setDownloading(false)
    }
  }

  const handleSubmitReview = async () => {
    if (!reviewContent.trim() || !mod || reviewSubmitting) return
    setReviewSubmitting(true)
    try {
      await submitModReview(mod.mod_number, reviewContent, reviewPositive)
      // Refresh reviews
      const refreshed = await fetchModDetail(modNumber)
      if (refreshed) setData(refreshed)
      setReviewContent("")
    } catch (err: any) {
      alert(`评测提交失败: ${err.message}`)
    } finally {
      setReviewSubmitting(false)
    }
  }

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
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Hero / Gallery */}
      <div className="shrink-0 relative">
        <div className="aspect-[21/9] max-h-[320px] bg-gradient-to-br from-muted to-muted/30 overflow-hidden relative">
          {screenshots.length > 0 ? (
            <img
              src={screenshots[currentImageIndex]}
              alt={mod.title}
              className="w-full h-full object-cover"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

          {/* Thumbnails */}
          {screenshots.length > 1 && (
            <div className="absolute bottom-3 left-6 flex gap-2">
              {screenshots.map((url: string, i: number) => (
                <button
                  key={i}
                  onClick={() => setCurrentImageIndex(i)}
                  className={cn(
                    "w-16 h-10 rounded border-2 overflow-hidden transition-all",
                    i === currentImageIndex ? "border-blue-500 shadow-lg" : "border-white/20 opacity-60 hover:opacity-100"
                  )}
                >
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-5 flex gap-6">
        {/* Main */}
        <div className="flex-1 min-w-0 space-y-5">
          {/* Title & Meta */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-medium text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
                {mod.game?.name || "未知游戏"}
              </span>
              {mod.tags?.map((tag: string) => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                  {tag}
                </span>
              ))}
            </div>
            <h1 className="text-2xl font-bold tracking-tight mt-2">{mod.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{mod.summary}</p>
          </div>

          {/* Author */}
          <button
            className="flex items-center gap-3 hover:bg-muted/50 rounded-lg p-2 -ml-2 transition-colors"
            onClick={() => mod.author?.user_number && onNavigate(`user:${mod.author.user_number}`)}
          >
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center overflow-hidden">
              {mod.author?.avatar_url ? (
                <img src={mod.author.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <User className="w-4 h-4 text-white" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium">{mod.author?.username || "未知作者"}</p>
              <p className="text-xs text-muted-foreground">
                发布于 {formatDistanceToNow(new Date(mod.created_at), { locale: zhCN, addSuffix: true })}
              </p>
            </div>
          </button>

          {/* Stats bar */}
          <div className="flex gap-5 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4" />
              {(mod.download_count || 0).toLocaleString()} 下载
            </span>
            <span className="flex items-center gap-1.5">
              <Eye className="w-4 h-4" />
              {(mod.view_count || 0).toLocaleString()} 浏览
            </span>
            <span className="flex items-center gap-1.5">
              <ThumbsUp className="w-4 h-4" />
              {positiveCount} 好评
            </span>
            <span className="flex items-center gap-1.5">
              <ThumbsDown className="w-4 h-4" />
              {negativeCount} 差评
            </span>
          </div>

          {/* Tabs */}
          <div className="border-b border-border">
            <div className="flex gap-1">
              {([
                { key: "description", label: "描述", icon: FileText },
                { key: "versions", label: `版本 (${versions.length})`, icon: Package },
                { key: "reviews", label: `评测 (${reviews.length})`, icon: MessageSquare },
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
                    activeTab === tab.key
                      ? "border-blue-500 text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab Content */}
          {activeTab === "description" && (
            <div className="prose prose-invert prose-sm max-w-none">
              <div className="whitespace-pre-wrap text-sm text-foreground/80 leading-relaxed">
                {mod.description || mod.summary || "暂无详细描述"}
              </div>
            </div>
          )}

          {activeTab === "versions" && (
            <div className="space-y-3">
              {versions.map((version: any) => (
                <div
                  key={version.id}
                  className={cn(
                    "p-4 rounded-xl border transition-all cursor-pointer",
                    version.id === selectedVersionId
                      ? "border-blue-500/50 bg-blue-500/5"
                      : "border-border bg-card hover:border-blue-500/30"
                  )}
                  onClick={() => setSelectedVersionId(version.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">v{version.version_number}</span>
                      {version.id === versions[0]?.id && (
                        <span className="text-[10px] bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded">最新</span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(version.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {version.changelog && (
                    <p className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap">{version.changelog}</p>
                  )}
                  {version.file_size && (
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      大小: {(version.file_size / (1024 * 1024)).toFixed(2)} MB
                    </p>
                  )}
                </div>
              ))}
              {versions.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">暂无可用版本</p>
              )}
            </div>
          )}

          {activeTab === "reviews" && (
            <div className="space-y-4">
              {/* Submit review */}
              {currentUser && (
                <div className="p-4 rounded-xl border border-border bg-card space-y-3">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={reviewPositive ? "default" : "outline"}
                      onClick={() => setReviewPositive(true)}
                      className="gap-1"
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                      推荐
                    </Button>
                    <Button
                      size="sm"
                      variant={!reviewPositive ? "destructive" : "outline"}
                      onClick={() => setReviewPositive(false)}
                      className="gap-1"
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                      不推荐
                    </Button>
                  </div>
                  <textarea
                    value={reviewContent}
                    onChange={(e) => setReviewContent(e.target.value)}
                    placeholder="写下你的评测..."
                    className="w-full h-20 rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button size="sm" onClick={handleSubmitReview} disabled={reviewSubmitting || !reviewContent.trim()}>
                    {reviewSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "提交评测"}
                  </Button>
                </div>
              )}

              {reviews.map((review: any) => (
                <div key={review.id} className="p-4 rounded-xl border border-border bg-card">
                  <div className="flex items-center justify-between">
                    <button
                      className="flex items-center gap-2 hover:underline"
                      onClick={() => review.user?.user_number && onNavigate(`user:${review.user.user_number}`)}
                    >
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center overflow-hidden">
                        {review.user?.avatar_url ? (
                          <img src={review.user.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <User className="w-3 h-3 text-white" />
                        )}
                      </div>
                      <span className="text-sm font-medium">{review.user?.username || "用户"}</span>
                    </button>
                    <div className="flex items-center gap-2">
                      {review.is_positive ? (
                        <ThumbsUp className="w-4 h-4 text-green-400" />
                      ) : (
                        <ThumbsDown className="w-4 h-4 text-red-400" />
                      )}
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(review.created_at), { locale: zhCN, addSuffix: true })}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-foreground/80 mt-2 whitespace-pre-wrap">{review.content}</p>
                </div>
              ))}

              {reviews.length === 0 && !currentUser && (
                <p className="text-sm text-muted-foreground text-center py-8">暂无评测</p>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="w-72 shrink-0 space-y-4">
          {/* Download card */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <Button className="w-full gap-2" onClick={startDownload} disabled={downloading || versions.length === 0}>
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {downloading ? "准备下载..." : "下载模组"}
            </Button>

            {selectedVersion && (
              <div className="text-xs text-muted-foreground space-y-1.5">
                <div className="flex justify-between">
                  <span>版本</span>
                  <span className="text-foreground">v{selectedVersion.version_number}</span>
                </div>
                {selectedVersion.file_size && (
                  <div className="flex justify-between">
                    <span>大小</span>
                    <span className="text-foreground">{(selectedVersion.file_size / (1024 * 1024)).toFixed(2)} MB</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>更新时间</span>
                  <span className="text-foreground">{new Date(selectedVersion.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            )}
          </div>

          {/* Info card */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">模组信息</h3>
            <div className="text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">游戏</span>
                <span className="text-foreground">{mod.game?.name || "未知"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">模组编号</span>
                <span className="text-foreground">#{mod.mod_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">最新版本</span>
                <span className="text-foreground">{mod.latest_version || "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">总下载</span>
                <span className="text-foreground">{(mod.download_count || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">发布日期</span>
                <span className="text-foreground">{new Date(mod.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
