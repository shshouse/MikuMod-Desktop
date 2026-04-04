import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Loader2,
  LogOut,
  Mail,
  Search,
  Settings,
  User,
  X,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
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
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [loginError, setLoginError] = useState("")
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    async function getUser() {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        return
      }

      try {
        const profile = await fetchMyProfile(session.user.id)
        setUserProfile(profile)
      } catch (error) {
        console.error(error)
      }

      await loadNotifications()
    }

    void getUser()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        try {
          const profile = await fetchMyProfile(session.user.id)
          setUserProfile(profile)
          await loadNotifications()
        } catch (error) {
          console.error(error)
        }
        setShowLoginModal(false)
      } else if (event === "SIGNED_OUT") {
        setUserProfile(null)
        setUnreadCount(0)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const loadNotifications = async () => {
    try {
      const count = await fetchUnreadNotifications()
      setUnreadCount(count || 0)
    } catch (error) {
      console.error(error)
    }
  }

  const handleLoginSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsLoggingIn(true)
    setLoginError("")

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setIsLoggingIn(false)

    if (error) {
      setLoginError(error.message === "Invalid login credentials" ? "账号或密码错误" : error.message)
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
            onClick={() => openWebPath("/notifications")}
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
                  setShowLoginModal(true)
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

      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm no-drag">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl relative">
            <button
              onClick={() => setShowLoginModal(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-center mb-6">
              <h3 className="text-xl font-bold tracking-tight">通行证登录</h3>
              <p className="text-sm text-muted-foreground mt-1.5">登录 MikuMod 账号同步桌面端数据</p>
            </div>

            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div className="space-y-2">
                <input
                  type="email"
                  placeholder="邮箱"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:border-blue-500 transition-colors"
                />
                <input
                  type="password"
                  placeholder="密码"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              {loginError && (
                <div className="px-3 py-2 rounded-md bg-destructive/10 text-destructive text-xs font-medium border border-destructive/20">
                  {loginError}
                </div>
              )}

              <Button type="submit" className="w-full font-medium" disabled={isLoggingIn}>
                {isLoggingIn ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    登录中...
                  </>
                ) : (
                  "立即登录"
                )}
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
