import {
  ChevronLeft,
  ChevronRight,
  Search,
  Bell,
  Settings,
  Mail,
  User,
  X,
  Loader2,
  LogOut
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fetchMyProfile, fetchUnreadNotifications } from "@/lib/api"
import { Button } from "@/components/ui/button"

interface TopBarProps {
  onNavigate?: (tab: string) => void
}

export function TopBar({ onNavigate }: TopBarProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [userProfile, setUserProfile] = useState<{ username: string; avatar_url: string | null } | null>(null)
  
  // Login State
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [loginError, setLoginError] = useState("")

  // Notification State
  const [unreadCount, setUnreadCount] = useState(0)

  const loadNotifications = useCallback(async () => {
    try {
      const count = await fetchUnreadNotifications()
      setUnreadCount(count || 0)
    } catch (error) {
      console.error(error)
    }
  }, [])

  useEffect(() => {
    async function getUser() {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        try {
          const profile = await fetchMyProfile(session.user.id)
          setUserProfile(profile)
        } catch (e) {
          console.error(e)
        }
        void loadNotifications()
      }
    }
    
    getUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        try {
          const profile = await fetchMyProfile(session.user.id)
          setUserProfile(profile)
        } catch (e) {
          console.error(e)
        }
        void loadNotifications()
        setShowLoginModal(false)
      } else if (event === "SIGNED_OUT") {
        setUserProfile(null)
        setUnreadCount(0)
      }
    })

    return () => subscription.unsubscribe()
  }, [loadNotifications])

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoggingIn(true)
    setLoginError("")
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    setIsLoggingIn(false)
    if (error) {
      setLoginError(error.message === "Invalid login credentials" ? "账号或密码错误" : error.message)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  return (
    <>
      <div className="drag-region h-12 shrink-0 border-b border-border flex items-center justify-between pl-4 pr-[144px] gap-4 bg-background">
        {/* 左侧：导航箭头 + 搜索 */}
        <div className="flex items-center gap-2 no-drag">
          <button className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <ChevronRight className="w-4 h-4" />
          </button>

          <div className="relative ml-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索模组、游戏..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-56 h-8 pl-8 pr-3 rounded-full border border-border bg-muted/50 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring focus:bg-background transition-colors"
            />
          </div>
        </div>

        {/* 中间空白拖拽区 */}
        <div className="flex-1" />

        {/* 右侧：功能按钮 + 头像 */}
        <div className="flex items-center gap-1 no-drag">
          {/* 通知 */}
          <button className="relative w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-red-500 border border-background" />
            )}
          </button>

          {/* 邮件/消息 */}
          <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <Mail className="w-4 h-4" />
          </button>

          {/* 设置 */}
          <button
            onClick={() => onNavigate?.("settings")}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* 分隔线 */}
          <div className="w-px h-5 bg-border mx-1" />

          {/* 头像 + 用户名 */}
          <div className="flex items-center gap-2 group relative">
            <button 
              onClick={() => !userProfile && setShowLoginModal(true)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-full hover:bg-muted transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shadow-sm overflow-hidden border border-blue-500/20">
                {userProfile?.avatar_url ? (
                  <img src={userProfile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-3.5 h-3.5 text-white" />
                )}
              </div>
              <span className="text-xs font-medium text-foreground/80 max-w-[80px] truncate">
                {userProfile?.username || "点击登录"}
              </span>
            </button>
            
            {/* 鼠标悬浮菜单 (如果已登录) */}
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

      {/* Login Modal */}
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
              <p className="text-sm text-muted-foreground mt-1.5">登录 MikuMod 账户同步您的数据</p>
            </div>

            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div className="space-y-2">
                <input
                  type="email"
                  placeholder="邮箱"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:border-blue-500 transition-colors"
                />
                <input
                  type="password"
                  placeholder="密码"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
