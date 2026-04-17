import {
  ExternalLink,
  LayoutDashboard,
  Loader2,
  Package,
  Plus,
} from "lucide-react"
import { useEffect, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabase"
import { getDesktopSettings } from "@/lib/desktop-config"

interface DashboardModSummary {
  id: string
  mod_number?: string
  title: string
  thumbnail_url?: string | null
  status: string
  download_count?: number | null
  view_count?: number | null
  created_at: string
  game?: {
    name?: string | null
  } | null
}

interface DashboardModRow {
  id: string
  mod_number?: string
  title: string
  thumbnail_url?: string | null
  status?: string | null
  download_count?: number | null
  view_count?: number | null
  created_at: string
  game?: Array<{
    id?: string
    name?: string | null
  }> | null
}

interface SessionUser {
  id: string
}

interface ModderDashboardProps {
  onNavigate: (tab: string) => void
}

export function ModderDashboard({ onNavigate }: ModderDashboardProps) {
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [myMods, setMyMods] = useState<DashboardModSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user || null
      setCurrentUser(user)
      if (user) loadMyMods(user.id)
      else setIsLoading(false)
    })
  }, [])

  const loadMyMods = async (userId: string) => {
    setIsLoading(true)
    try {
      const { data } = await supabase
        .from("mod")
        .select("id,mod_number,title,thumbnail_url,status,download_count,view_count,created_at,game:games(id,name)")
        .eq("author_id", userId)
        .order("created_at", { ascending: false })
      const normalizedMods = ((data as DashboardModRow[] | null) || []).map((mod) => ({
        id: mod.id,
        mod_number: mod.mod_number,
        title: mod.title,
        thumbnail_url: mod.thumbnail_url,
        status: mod.status || "draft",
        download_count: mod.download_count,
        view_count: mod.view_count,
        created_at: mod.created_at,
        game: Array.isArray(mod.game) ? (mod.game[0] || null) : (mod.game || null),
      }))
      setMyMods(normalizedMods)
    } catch {
      setMyMods([])
    } finally {
      setIsLoading(false)
    }
  }

  const openWebDashboard = () => {
    const settings = getDesktopSettings()
    void window.electronAPI?.openExternal(`${settings.webBaseUrl}/dashboard`)
  }

  const openUploadPage = () => {
    const settings = getDesktopSettings()
    void window.electronAPI?.openExternal(`${settings.webBaseUrl}/dashboard/upload`)
  }

  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
        <LayoutDashboard className="w-12 h-12 text-muted-foreground/20" />
        <p className="text-sm">请先登录以访问创作者中心</p>
      </div>
    )
  }

  const statusLabels: Record<string, { label: string; className: string }> = {
    approved: { label: "已通过", className: "bg-green-500/10 text-green-400" },
    pending: { label: "审核中", className: "bg-amber-500/10 text-amber-400" },
    rejected: { label: "已拒绝", className: "bg-red-500/10 text-red-400" },
    draft: { label: "草稿", className: "bg-secondary text-muted-foreground" },
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border/50 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">创作者中心</h2>
          <p className="text-sm text-muted-foreground mt-1">管理你发布的模组</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={openUploadPage}>
            <Plus className="w-3.5 h-3.5" />
            上传模组
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={openWebDashboard}>
            <ExternalLink className="w-3.5 h-3.5" />
            完整面板
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">正在加载...</p>
          </div>
        ) : myMods.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Package className="w-12 h-12 text-muted-foreground/20 mb-4" />
            <p className="text-sm text-foreground/80">你还没有发布过模组</p>
            <p className="text-xs text-muted-foreground mt-1">点击上方"上传模组"按钮开始创作</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Stats summary */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="rounded-xl border border-border bg-card p-4 text-center">
                <p className="text-2xl font-bold">{myMods.length}</p>
                <p className="text-xs text-muted-foreground mt-1">模组总数</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4 text-center">
                <p className="text-2xl font-bold">
                  {myMods.reduce((sum, m) => sum + (m.download_count || 0), 0).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground mt-1">总下载量</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4 text-center">
                <p className="text-2xl font-bold">
                  {myMods.reduce((sum, m) => sum + (m.view_count || 0), 0).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground mt-1">总浏览量</p>
              </div>
            </div>

            {/* Mod list */}
            {myMods.map((mod) => {
              const st = statusLabels[mod.status] || statusLabels.draft
              return (
                <button
                  key={mod.id}
                  className="w-full text-left flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:border-blue-500/30 transition-all group"
                  onClick={() => mod.mod_number && onNavigate(`mod:${mod.mod_number}`)}
                >
                  <div className="w-16 h-10 rounded-lg bg-gradient-to-br from-muted to-muted/30 overflow-hidden shrink-0">
                    {mod.thumbnail_url && (
                      <img src={mod.thumbnail_url} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold truncate group-hover:text-blue-400 transition-colors">
                      {mod.title}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${st.className}`}>
                        {st.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {mod.game?.name || ""} · {formatDistanceToNow(new Date(mod.created_at), { locale: zhCN, addSuffix: true })}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">{(mod.download_count || 0).toLocaleString()} 下载</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">{(mod.view_count || 0).toLocaleString()} 浏览</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
