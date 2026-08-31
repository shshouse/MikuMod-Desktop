import {
  Bell,
  BellOff,
  CheckCheck,
  type LucideIcon,
  Loader2,
  Package,
  MessageSquare,
  RefreshCw,
  Shield,
  Star,
} from "lucide-react"
import { useEffect, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { fetchNotifications, markNotificationsRead } from "@/lib/api"
import type { NotificationSummary } from "@/lib/api"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"

interface NotificationsPageProps {
  onNavigate: (tab: string) => void
}

const typeIcons: Record<string, LucideIcon> = {
  mod_approved: Package,
  mod_rejected: Package,
  mod_update: RefreshCw,
  review: MessageSquare,
  reply: MessageSquare,
  review_reply: MessageSquare,
  modder_approved: Shield,
  modder_rejected: Shield,
  new_review: Star,
  new_reply: MessageSquare,
  new_follower: Bell,
  system: Bell,
}

const typeLabels: Record<string, string> = {
  mod_approved: "模组已通过",
  mod_rejected: "模组被拒绝",
  mod_update: "模组更新",
  review: "新评测",
  reply: "新回复",
  review_reply: "评测回复",
  modder_approved: "创作者申请通过",
  modder_rejected: "创作者申请被拒",
  new_review: "新评测",
  new_reply: "新回复",
  new_follower: "新关注者",
  system: "系统通知",
}

export function NotificationsPage({ onNavigate }: NotificationsPageProps) {
  const [notifications, setNotifications] = useState<NotificationSummary[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session?.user)
      if (session?.user) loadNotifications()
      else setIsLoading(false)
    })
  }, [])

  const loadNotifications = async (offset = 0) => {
    if (offset === 0) setIsLoading(true)
    else setLoadingMore(true)
    try {
      const data = await fetchNotifications({ limit: 20, offset })
      if (offset === 0) {
        setNotifications(data.notifications || [])
      } else {
        setNotifications((prev) => [...prev, ...(data.notifications || [])])
      }
      setUnreadCount(data.unread_count || 0)
      setHasMore(data.has_more || false)
    } catch (err) {
      console.error("Failed to load notifications:", err)
    } finally {
      setIsLoading(false)
      setLoadingMore(false)
    }
  }

  const handleReadAll = async () => {
    try {
      await markNotificationsRead()
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
      setUnreadCount(0)
    } catch (error) {
      console.error("Failed to mark all notifications as read:", error)
    }
  }

  const handleReadOne = async (id: string) => {
    try {
      await markNotificationsRead([id])
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      )
      setUnreadCount((c) => Math.max(0, c - 1))
    } catch (error) {
      console.error("Failed to mark notification as read:", error)
    }
  }

  const getNotificationLink = (n: NotificationSummary): string | null => {
    if (n.related_mod?.mod_number) return `mod:${n.related_mod.mod_number}`
    if (n.related_post_id) return `post:${n.related_post_id}`
    return null
  }

  if (!isLoggedIn) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
        <BellOff className="w-12 h-12 text-muted-foreground/20" />
        <p className="text-sm">请先登录以查看通知</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm">正在加载通知...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-6 pt-6 pb-4 flex items-center justify-between border-b border-border/50">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">通知中心</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {unreadCount > 0 ? `${unreadCount} 条未读` : "所有通知已读"}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" className="gap-2" onClick={handleReadAll}>
            <CheckCheck className="w-3.5 h-3.5" />
            全部已读
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-2">
        {notifications.map((n) => {
          const Icon = typeIcons[n.type] || Bell
          const link = getNotificationLink(n)

          return (
            <div
              key={n.id}
              className={cn(
                "p-4 rounded-xl border transition-all",
                n.is_read
                  ? "border-border bg-card"
                  : "border-blue-500/30 bg-blue-500/5"
              )}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center shrink-0",
                  n.is_read ? "bg-secondary" : "bg-blue-500/10"
                )}>
                  <Icon className={cn("w-4 h-4", n.is_read ? "text-muted-foreground" : "text-blue-400")} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      {typeLabels[n.type] || n.type}
                    </span>
                    {!n.is_read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    )}
                  </div>
                  <p className="text-sm text-foreground/90 mt-0.5">{n.message || n.title}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(n.created_at), { locale: zhCN, addSuffix: true })}
                    </span>
                    {link && (
                      <button
                        className="text-[10px] text-blue-400 hover:underline"
                        onClick={() => {
                          if (!n.is_read) handleReadOne(n.id)
                          onNavigate(link)
                        }}
                      >
                        查看详情
                      </button>
                    )}
                    {!n.is_read && (
                      <button
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={() => handleReadOne(n.id)}
                      >
                        标为已读
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {hasMore && (
          <div className="text-center pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadNotifications(notifications.length)}
              disabled={loadingMore}
            >
              {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : "加载更多"}
            </Button>
          </div>
        )}

        {notifications.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Bell className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-sm text-foreground/80">暂无通知</p>
          </div>
        )}
      </div>
    </div>
  )
}
