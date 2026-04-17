import { MessageSquare, ThumbsUp, Eye, Clock, Loader2, User } from "lucide-react"
import { useState, useEffect } from "react"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import { fetchPosts as fetchPostsApi } from "@/lib/api"
import type { CommunityPostSummary } from "@/lib/api"

const categoryColors: Record<string, string> = {
  "默认": "bg-blue-500/10 text-blue-400",
  "讨论": "bg-blue-500/10 text-blue-400",
  "教程": "bg-green-500/10 text-green-400",
  "求助": "bg-amber-500/10 text-amber-400",
  "公告": "bg-purple-500/10 text-purple-400",
  "分享": "bg-pink-500/10 text-pink-400",
}

export function CommunityPage() {
  const [posts, setPosts] = useState<CommunityPostSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function fetchPosts() {
      setIsLoading(true)
      try {
        const data = await fetchPostsApi({ limit: 20 })
        setPosts(data.data || [])
      } catch (err) {
        console.error("Failed to fetch posts:", err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchPosts()
  }, [])

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border/50">
        <h2 className="text-xl font-semibold tracking-tight">社区</h2>
        <p className="text-sm text-muted-foreground mt-1">和其他玩家交流模组心得</p>
      </div>

      {/* Posts List */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">正在加载帖子...</p>
          </div>
        ) : posts.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
            <p className="text-sm">暂无数据</p>
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => {
              const dateStr = post.created_at
                ? formatDistanceToNow(new Date(post.created_at), { addSuffix: true, locale: zhCN })
                : "未知时间"

              return (
                <div
                  key={post.id}
                  className="group flex items-start gap-4 p-4 rounded-xl border border-border bg-card hover:border-blue-500/30 hover:shadow-md hover:shadow-blue-500/5 transition-all duration-200 cursor-pointer"
                >
                  <div className="shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/10 to-cyan-400/10 border border-blue-500/20 flex items-center justify-center overflow-hidden">
                    {post.author?.avatar_url ? (
                      <img src={post.author.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-5 h-5 text-blue-500/50" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${categoryColors[post.category || "默认"] || "bg-muted text-muted-foreground"}`}>
                        {post.category || "默认"}
                      </span>
                      <h3 className="text-sm font-medium text-foreground/90 group-hover:text-blue-400 transition-colors truncate">
                        {post.title}
                      </h3>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                      <span className="font-medium">{post.author?.username || "未知用户"}</span>
                      <span className="flex items-center gap-1.5 opacity-80">
                        <Clock className="w-3 h-3" />
                        {dateStr}
                      </span>
                      <span className="flex items-center gap-1.5 opacity-80">
                        <MessageSquare className="w-3 h-3" />
                        {post.reply_count || 0}
                      </span>
                      {/* Default placeholders for likes/views since they might need joined queries */}
                      <span className="flex items-center gap-1.5 opacity-80">
                        <ThumbsUp className="w-3 h-3" />
                        {Math.floor(Math.random() * 50)}
                      </span>
                      <span className="flex items-center gap-1.5 opacity-80">
                        <Eye className="w-3 h-3" />
                        {Math.floor(Math.random() * 500) + 100}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
