import {
  ArrowLeft,
  Heart,
  Loader2,
  MessageSquare,
  Send,
  User,
} from "lucide-react"
import { useEffect, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import {
  fetchPostDetail,
  fetchPostReplies,
  fetchPostLikeStatus,
  togglePostLike,
  submitPostReply,
} from "@/lib/api"
import type { PostDetailSummary, PostLikeStatus, PostReplySummary } from "@/lib/api"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"

interface PostDetailPageProps {
  postId: string
  onNavigate: (tab: string) => void
  onBack: () => void
}

interface SessionUser {
  id: string
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误"
}

const categoryColors: Record<string, string> = {
  讨论: "bg-blue-500/10 text-blue-400",
  discussion: "bg-blue-500/10 text-blue-400",
  教程: "bg-green-500/10 text-green-400",
  求助: "bg-amber-500/10 text-amber-400",
  feedback: "bg-amber-500/10 text-amber-400",
  公告: "bg-purple-500/10 text-purple-400",
  分享: "bg-pink-500/10 text-pink-400",
  share: "bg-pink-500/10 text-pink-400",
}

export function PostDetailPage({ postId, onNavigate, onBack }: PostDetailPageProps) {
  const [post, setPost] = useState<PostDetailSummary | null>(null)
  const [replies, setReplies] = useState<PostReplySummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")

  const [likeCount, setLikeCount] = useState(0)
  const [liked, setLiked] = useState(false)
  const [likeLoading, setLikeLoading] = useState(false)

  const [replyContent, setReplyContent] = useState("")
  const [replyTo, setReplyTo] = useState<{ id: string | number; username: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [replyNotice, setReplyNotice] = useState("")
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUser(session?.user || null)
    })
  }, [])

  useEffect(() => {
    let isActive = true

    void Promise.all([
      fetchPostDetail(postId).catch(() => null),
      fetchPostReplies(postId).catch(() => [] as PostReplySummary[]),
      fetchPostLikeStatus(postId).catch((): PostLikeStatus => ({ count: 0, liked: false })),
    ])
      .then(([postData, repliesData, likeData]) => {
        if (!isActive) return
        if (!postData) {
          setError("帖子不存在或已被删除")
          return
        }
        setPost(postData)
        setReplies(repliesData)
        setLikeCount(likeData.count || 0)
        setLiked(likeData.liked || false)
      })
      .finally(() => {
        if (!isActive) return
        setIsLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [postId])

  const handleLike = async () => {
    if (!currentUser || likeLoading) return
    setLikeLoading(true)
    try {
      const result = await togglePostLike(postId)
      setLiked(result.liked)
      setLikeCount(result.count)
    } catch (error) {
      console.error("Failed to toggle post like:", error)
    }
    finally { setLikeLoading(false) }
  }

  const handleSubmitReply = async () => {
    if (!replyContent.trim() || submitting) return
    setSubmitting(true)
    try {
      const result = await submitPostReply(postId, replyContent, replyTo?.id)
      setReplyContent("")
      setReplyTo(null)
      if (result._needsReview) {
        setReplyNotice(result._reviewReason ? `回复已提交审核：${result._reviewReason}` : "回复已提交审核，通过后会展示")
        return
      }
      setReplyNotice("")
      // Refresh replies
      const refreshed = await fetchPostReplies(postId).catch(() => [])
      setReplies(refreshed)
    } catch (submitError) {
      alert(`回复失败: ${getErrorMessage(submitError)}`)
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm">正在加载帖子...</p>
      </div>
    )
  }

  if (error || !post) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
        <MessageSquare className="w-12 h-12 text-muted-foreground/20" />
        <p className="text-sm">{error || "帖子不存在"}</p>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
          返回
        </Button>
      </div>
    )
  }

  const catClass = categoryColors[post.category || "讨论"] || "bg-blue-500/10 text-blue-400"

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-6 py-6 space-y-6">
        {/* Header */}
        <div>
          <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
            返回社区
          </button>

          <div className="flex items-center gap-2 mb-2">
            <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded", catClass)}>
              {post.category}
            </span>
            {post.game?.name && (
              <span className="text-[10px] text-muted-foreground/60 bg-secondary px-1.5 py-0.5 rounded">
                {post.game.name}
              </span>
            )}
          </div>

          <h1 className="text-xl font-bold tracking-tight">{post.title}</h1>

          {/* Author meta */}
          <div className="flex items-center gap-3 mt-3">
            <button
              className="flex items-center gap-2 hover:underline"
              onClick={() => post.user?.user_number && onNavigate(`user:${post.user.user_number}`)}
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center overflow-hidden">
                {post.user?.avatar_url ? (
                  <img src={post.user.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-3.5 h-3.5 text-white" />
                )}
              </div>
              <span className="text-sm font-medium">{post.user?.username || "匿名用户"}</span>
            </button>
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(post.created_at), { locale: zhCN, addSuffix: true })}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="text-sm text-foreground/85 whitespace-pre-wrap leading-relaxed">
            {post.content}
          </div>

          {/* Images */}
          {Array.isArray(post.image_urls) && post.image_urls.length > 0 && (
            <div className="flex flex-wrap gap-3 mt-4">
              {post.image_urls.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt=""
                  className="max-h-60 rounded-lg border border-border object-cover"
                />
              ))}
            </div>
          )}

          {/* Like */}
          <div className="flex items-center gap-4 mt-5 pt-4 border-t border-border">
            <button
              onClick={handleLike}
              disabled={likeLoading || !currentUser}
              className={cn(
                "flex items-center gap-1.5 text-sm transition-colors",
                liked ? "text-pink-500" : "text-muted-foreground hover:text-pink-500"
              )}
            >
              <Heart className={cn("w-4 h-4", liked && "fill-current")} />
              {likeCount}
            </button>
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MessageSquare className="w-4 h-4" />
              {replies.length} 回复
            </span>
          </div>
        </div>

        {/* Reply form */}
        {currentUser && (
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            {replyNotice && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                {replyNotice}
              </div>
            )}
            {replyTo && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>回复 @{replyTo.username}</span>
                <button onClick={() => setReplyTo(null)} className="text-destructive hover:underline">取消</button>
              </div>
            )}
            <div className="flex gap-3">
              <textarea
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder="写下你的回复..."
                className="flex-1 h-16 rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                size="sm"
                onClick={handleSubmitReply}
                disabled={submitting || !replyContent.trim()}
                className="self-end gap-1"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                发送
              </Button>
            </div>
          </div>
        )}

        {/* Replies */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">
            全部回复 ({replies.length})
          </h3>
          {replies.map((reply) => (
            <div key={reply.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <button
                  className="flex items-center gap-2 hover:underline"
                  onClick={() => reply.user?.user_number && onNavigate(`user:${reply.user.user_number}`)}
                >
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center overflow-hidden">
                    {reply.user?.avatar_url ? (
                      <img src={reply.user.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-3 h-3 text-white" />
                    )}
                  </div>
                  <span className="text-xs font-medium">{reply.user?.username || "匿名"}</span>
                </button>
                <span className="text-[10px] text-muted-foreground">
                  {formatDistanceToNow(new Date(reply.created_at), { locale: zhCN, addSuffix: true })}
                </span>
              </div>
              {reply.parent_reply_id && reply.reply_to_user && (
                <p className="text-[10px] text-muted-foreground mt-1">回复 @{reply.reply_to_user?.username}</p>
              )}
              <p className="text-sm text-foreground/80 mt-2 whitespace-pre-wrap">{reply.content}</p>
              {currentUser && (
                <button
                  onClick={() => setReplyTo({ id: reply.id, username: reply.user?.username || "用户" })}
                  className="text-[10px] text-muted-foreground hover:text-foreground mt-2 transition-colors"
                >
                  回复
                </button>
              )}
            </div>
          ))}
          {replies.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">暂无回复，来抢个沙发吧</p>
          )}
        </div>
      </div>
    </div>
  )
}
