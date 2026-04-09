import { Clock, ExternalLink, Image as ImageIcon, Loader2, MessageSquare, ThumbsUp, User } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { fetchPosts } from "@/lib/api"
import { getDesktopSettings } from "@/lib/desktop-config"

interface CommunityFeedProps {
  searchQuery: string
  onNavigate?: (tab: string) => void
}

const categoryColors: Record<string, string> = {
  默认: "bg-blue-500/10 text-blue-400",
  discussion: "bg-blue-500/10 text-blue-400",
  讨论: "bg-blue-500/10 text-blue-400",
  教程: "bg-green-500/10 text-green-400",
  feedback: "bg-amber-500/10 text-amber-400",
  求助: "bg-amber-500/10 text-amber-400",
  公告: "bg-purple-500/10 text-purple-400",
  share: "bg-pink-500/10 text-pink-400",
  分享: "bg-pink-500/10 text-pink-400",
}

export function CommunityFeed({ searchQuery, onNavigate }: CommunityFeedProps) {
  const [posts, setPosts] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const PAGE_SIZE = 20

  useEffect(() => {
    loadPosts(1)
  }, [])

  async function loadPosts(p: number) {
    if (p === 1) setIsLoading(true)
    else setLoadingMore(true)
    try {
      const data = await fetchPosts({ limit: PAGE_SIZE, page: p })
      const items = data.data || []
      if (p === 1) {
        setPosts(items)
      } else {
        setPosts((prev) => [...prev, ...items])
      }
      setTotal(data.total || 0)
      setPage(p)
    } catch (error) {
      console.error("Failed to fetch posts:", error)
      if (p === 1) setPosts([])
    } finally {
      setIsLoading(false)
      setLoadingMore(false)
    }
  }

  const filteredPosts = useMemo(() => {
    if (!searchQuery.trim()) {
      return posts
    }

    const normalized = searchQuery.trim().toLowerCase()
    return posts.filter((post) => {
      const title = String(post.title || "").toLowerCase()
      const authorName = String(post.user?.username || post.author?.username || "").toLowerCase()
      return title.includes(normalized) || authorName.includes(normalized)
    })
  }, [posts, searchQuery])

  const openPost = (postId: string | number) => {
    if (onNavigate) {
      onNavigate(`post:${postId}`)
    } else {
      const settings = getDesktopSettings()
      void window.electronAPI?.openExternal(`${settings.webBaseUrl}/forum/${postId}`)
    }
  }

  const hasMore = page * PAGE_SIZE < total

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border/50 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">社区</h2>
          <p className="text-sm text-muted-foreground mt-1">浏览讨论、教程、求助与分享</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void openPost("new")}>
          <ExternalLink className="w-4 h-4" />
          去网页发帖
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">正在加载帖子...</p>
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
            <p className="text-sm">没有匹配的帖子</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredPosts.map((post) => {
              const author = post.user || post.author
              const coverImage = Array.isArray(post.image_urls) && post.image_urls.length > 0 ? post.image_urls[0] : null
              const dateStr = post.created_at
                ? formatDistanceToNow(new Date(post.created_at), { addSuffix: true, locale: zhCN })
                : "未知时间"

              return (
                <div
                  key={post.id}
                  className="group flex items-start gap-4 p-4 rounded-xl border border-border bg-card hover:border-blue-500/30 hover:shadow-md hover:shadow-blue-500/5 transition-all duration-200"
                >
                  <div className="shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/10 to-cyan-400/10 border border-blue-500/20 flex items-center justify-center overflow-hidden">
                    {author?.avatar_url ? (
                      <img src={author.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-5 h-5 text-blue-500/50" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${categoryColors[post.category] || "bg-muted text-muted-foreground"}`}>
                        {post.category || "默认"}
                      </span>
                      <button className="text-left min-w-0" onClick={() => void openPost(post.id)}>
                        <h3 className="text-sm font-medium text-foreground/90 group-hover:text-blue-400 transition-colors truncate">
                          {post.title}
                        </h3>
                      </button>
                    </div>

                    <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
                      <span className="font-medium">{author?.username || "未知用户"}</span>
                      <span className="flex items-center gap-1.5 opacity-80">
                        <Clock className="w-3 h-3" />
                        {dateStr}
                      </span>
                      <span className="flex items-center gap-1.5 opacity-80">
                        <MessageSquare className="w-3 h-3" />
                        {post.reply_count || 0}
                      </span>
                      <span className="flex items-center gap-1.5 opacity-80">
                        <ThumbsUp className="w-3 h-3" />
                        {post.like_count || 0}
                      </span>
                    </div>

                    {coverImage ? (
                      <button
                        className="mt-3 block w-full max-w-xs overflow-hidden rounded-lg border border-border/70 bg-muted/30"
                        onClick={() => void openPost(post.id)}
                      >
                        <img src={coverImage} alt={post.title || "post image"} className="h-32 w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
                      </button>
                    ) : (
                      <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
                        <ImageIcon className="w-3.5 h-3.5" />
                        无图片
                      </div>
                    )}
                  </div>

                  <Button variant="ghost" size="sm" onClick={() => openPost(post.id)}>
                    查看
                  </Button>
                </div>
              )
            })}

            {hasMore && (
              <div className="text-center py-6">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadPosts(page + 1)}
                  disabled={loadingMore}
                >
                  {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : `加载更多 (${posts.length}/${total})`}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
