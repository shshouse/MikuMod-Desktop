import {
  Bell,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Mail,
  Search,
  Settings,
  User,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { fetchMyProfile, fetchUnreadNotifications } from "@/lib/api"
import { getDesktopSettings } from "@/lib/desktop-config"
import { supabase } from "@/lib/supabase"

interface TopBarEnhancedProps {
  activeTab: string
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  onNavigate: (tab: string) => void
  searchQuery: string
  onSearchChange: (value: string) => void
}

export function TopBarEnhanced({
  activeTab,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onNavigate,
  searchQuery,
  onSearchChange,
}: TopBarEnhancedProps) {
  const [userProfile, setUserProfile] = useState<{ username: string; avatar_url: string | null } | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)

  const loadNotifications = useCallback(async (isUnmounted = false) => {
    try {
      const count = await fetchUnreadNotifications()
      if (!isUnmounted) setUnreadCount(count || 0)
    } catch (error) {
      console.error(error)
    }
  }, [])

  useEffect(() => {
    let unmounted = false

    async function getUser() {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user || unmounted) {
        return
      }

      try {
        const profile = await fetchMyProfile(session.user.id)
        if (!unmounted) setUserProfile(profile)
      } catch (error) {
        console.error(error)
      }

      await loadNotifications(unmounted)
    }

    void getUser()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (unmounted) return
      if (event === "SIGNED_IN" && session?.user) {
        try {
          const profile = await fetchMyProfile(session.user.id)
          if (!unmounted) setUserProfile(profile)
          await loadNotifications(unmounted)
        } catch (error) {
          console.error(error)
        }
      } else if (event === "SIGNED_OUT") {
        if (!unmounted) {
          setUserProfile(null)
          setUnreadCount(0)
        }
      }
    })

    return () => {
      unmounted = true
      subscription.unsubscribe()
    }
  }, [loadNotifications])

  // Deep Link: handle auth callback from web login
  useEffect(() => {
    let unmounted = false

    const handler = async (url: string) => {
      if (unmounted || !url.startsWith("mikumod://auth-callback")) return
      
      try {
        const urlObj = new URL(url)
        const accessToken = urlObj.searchParams.get("access_token")
        const refreshToken = urlObj.searchParams.get("refresh_token")
        if (accessToken && refreshToken) {
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
        }
      } catch (error) {
        console.error("Auth callback error:", error)
      }
    }
    
    window.electronAPI?.onDeepLink?.(handler)

    return () => {
      unmounted = true
    }
  }, [])

  const handleLogin = async () => {
    const settings = getDesktopSettings()
    const loginUrl = `${settings.webBaseUrl}/login?redirect=desktop`
    // Prefer embedded login window; fall back to system browser
    if (window.electronAPI?.openLoginWindow) {
      await window.electronAPI.openLoginWindow(loginUrl)
    } else {
      await window.electronAPI?.openExternal(loginUrl)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  const openWebPath = async (path: string) => {
    const settings = getDesktopSettings()
    await window.electronAPI?.openExternal(`${settings.webBaseUrl}${path}`)
  }

  const placeholder =
    activeTab === "community" ? "搜索帖子标题..." : activeTab === "games" ? "搜索游戏..." : "搜索模组..."

  return (
    <>
      <div className="drag-region h-14 shrink-0 border-b border-border flex items-center justify-between pl-4 pr-[144px] gap-4 bg-background">
        <div className="flex items-center gap-2 no-drag">
          <button
            onClick={onBack}
            disabled={!canGoBack}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={onForward}
            disabled={!canGoForward}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <div className="relative ml-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder={placeholder}
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              className="w-64 h-8 pl-8 pr-3 rounded-full border border-border bg-muted/50 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring focus:bg-background transition-colors"
            />
          </div>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1 no-drag">
          <button
            onClick={() => onNavigate("notifications")}
            className="relative w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="打开通知中心"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-4 h-4 rounded-full bg-red-500 text-[10px] text-white px-1 flex items-center justify-center border border-background">
                {Math.min(unreadCount, 99)}
              </span>
            )}
          </button>

          <button
            onClick={() => openWebPath("/forum")}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="打开社区"
          >
            <Mail className="w-4 h-4" />
          </button>

          <button
            onClick={() => onNavigate("settings")}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="打开设置"
          >
            <Settings className="w-4 h-4" />
          </button>

          <div className="w-px h-5 bg-border mx-1" />

          <div className="flex items-center gap-2 group relative">
            <button
              onClick={() => {
                if (!userProfile) {
                  handleLogin()
                  return
                }
                void openWebPath("/settings")
              }}
              className="flex items-center gap-2 px-2 py-1.5 rounded-full hover:bg-muted transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shadow-sm overflow-hidden border border-blue-500/20">
                {userProfile?.avatar_url ? (
                  <img src={userProfile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-3.5 h-3.5 text-white" />
                )}
              </div>
              <span className="text-xs font-medium text-foreground/80 max-w-[100px] truncate">
                {userProfile?.username || "点击登录"}
              </span>
            </button>

            {userProfile && (
              <div className="absolute right-0 top-full mt-1 w-32 hidden group-hover:flex flex-col bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50">
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 text-xs text-destructive hover:bg-muted flex items-center gap-2 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
