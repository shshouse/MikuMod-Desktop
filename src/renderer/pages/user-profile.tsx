import {
  Calendar,
  FileText,
  Loader2,
  MessageSquare,
  Package,
  Star,
  User,
} from "lucide-react"
import { useEffect, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import { fetchUserProfile } from "@/lib/api"
import type { UserProfileModSummary, UserProfilePostSummary, UserProfileResponse, UserProfileReviewSummary } from "@/lib/api"
import { cn } from "@/lib/utils"

interface UserProfilePageProps {
  userNumber: string
  onNavigate: (tab: string) => void
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "加载用户资料失败"
}

export function UserProfilePage({ userNumber, onNavigate }: UserProfilePageProps) {
  const [data, setData] = useState<UserProfileResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let isActive = true
    fetchUserProfile(userNumber)
      .then((result) => {
        if (!isActive) {
          return
        }
        setData(result)
      })
      .catch((err) => {
        if (!isActive) {
          return
        }
        setError(getErrorMessage(err))
      })
      .finally(() => {
        if (!isActive) {
          return
        }
        setIsLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [userNumber])

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm">正在加载用户资料...</p>
      </div>
    )
  }

  if (error || !data?.profile) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
        <User className="w-12 h-12 text-muted-foreground/20" />
        <p className="text-sm">{error || "用户不存在"}</p>
      </div>
    )
  }

  const {
    profile,
    stats,
    recentPosts = [],
    recentReviews = [],
    recentMods = [],
  } = data

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-6 py-6 space-y-6">
        {/* Profile header */}
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-5">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center overflow-hidden border-2 border-blue-500/20 shadow-lg">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <User className="w-8 h-8 text-white" />
              )}
            </div>
            <div>
              <h1 className="text-2xl font-bold">{profile.username}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                #{profile.user_number} · 加入于{" "}
                {formatDistanceToNow(new Date(profile.created_at), { locale: zhCN, addSuffix: true })}
              </p>
              {profile.bio && (
                <p className="text-sm text-foreground/70 mt-2">{profile.bio}</p>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-4 mt-5 pt-5 border-t border-border">
            {[
              { label: "发帖", value: stats.posts, icon: FileText },
              { label: "回复", value: stats.replies, icon: MessageSquare },
              { label: "评测", value: stats.reviews, icon: Star },
              { label: "模组", value: stats.mods, icon: Package },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                  <s.icon className="w-3.5 h-3.5" />
                  <span className="text-xs">{s.label}</span>
                </div>
                <p className="text-lg font-bold">{s.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Mods */}
        {recentMods?.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
              <Package className="w-4 h-4" />
              发布的模组
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {recentMods.map((mod: UserProfileModSummary) => (
                <button
                  key={mod.id}
                  className="rounded-xl border border-border bg-card overflow-hidden hover:border-blue-500/30 transition-all text-left group"
                  onClick={() => onNavigate(`mod:${mod.mod_number}`)}
                >
                  <div className="aspect-[16/9] bg-gradient-to-br from-muted to-muted/30 overflow-hidden">
                    {mod.media?.thumbnail_url && (
                      <img
                        src={mod.media.thumbnail_url}
                        alt={mod.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    )}
                  </div>
                  <div className="p-3">
                    <h4 className="text-sm font-semibold line-clamp-1 group-hover:text-blue-400 transition-colors">
                      {mod.title}
                    </h4>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {mod.game?.name || ""} · {new Date(mod.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recent Posts */}
        {recentPosts?.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              最近帖子
            </h3>
            <div className="space-y-2">
              {recentPosts.map((post: UserProfilePostSummary) => (
                <button
                  key={post.id}
                  className="w-full text-left p-3 rounded-xl border border-border bg-card hover:border-blue-500/30 transition-all flex items-center justify-between"
                  onClick={() => onNavigate(`post:${post.id}`)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn(
                      "text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0",
                      "bg-blue-500/10 text-blue-400"
                    )}>
                      {post.category}
                    </span>
                    <span className="text-sm truncate">{post.title}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0 ml-2 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {new Date(post.created_at).toLocaleDateString()}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recent Reviews */}
        {recentReviews?.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
              <Star className="w-4 h-4" />
              最近评测
            </h3>
            <div className="space-y-2">
              {recentReviews.map((review: UserProfileReviewSummary) => (
                <button
                  key={review.id}
                  className="w-full text-left p-4 rounded-xl border border-border bg-card hover:border-blue-500/30 transition-all"
                  onClick={() => review.mod?.mod_number && onNavigate(`mod:${review.mod.mod_number}`)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-muted-foreground">{review.mod?.title}</span>
                  </div>
                  <p className="text-sm text-foreground/80 line-clamp-2">{review.content}</p>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    {formatDistanceToNow(new Date(review.created_at), { locale: zhCN, addSuffix: true })}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
