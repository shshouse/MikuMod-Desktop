import { Clock, ExternalLink, Loader2, SlidersHorizontal, Star, TrendingUp } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { fetchMods, getDownloadToken } from "@/lib/api"
import { getDesktopSettings } from "@/lib/desktop-config"
import { cn } from "@/lib/utils"
import { useDownloadStoreEnhanced } from "@/store/download-enhanced"

const categories = ["全部", "热门", "最新", "推荐"] as const

interface ModsPageEnhancedProps {
  searchQuery: string
}

export function ModsPageEnhanced({ searchQuery }: ModsPageEnhancedProps) {
  const [activeCategory, setActiveCategory] = useState<(typeof categories)[number]>("全部")
  const [mods, setMods] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadMods() {
      setIsLoading(true)
      try {
        const data = await fetchMods({ q: searchQuery || undefined, limit: 24 })
        setMods(data.mods || [])
      } catch (error) {
        console.error("Failed to fetch mods:", error)
        setMods([])
      } finally {
        setIsLoading(false)
      }
    }

    void loadMods()
  }, [searchQuery])

  const filteredMods = useMemo(() => {
    switch (activeCategory) {
      case "热门":
        return [...mods].sort((a, b) => (b.download_count || 0) - (a.download_count || 0))
      case "最新":
        return [...mods].sort((a, b) => +new Date(b.created_at || 0) - +new Date(a.created_at || 0))
      case "推荐":
        return mods.filter((mod) => (mod.tags || []).includes("精选") || (mod.tags || []).includes("推荐"))
      default:
        return mods
    }
  }, [activeCategory, mods])

  const startDownload = async (mod: any) => {
    try {
      const tokenInfo = await getDownloadToken(mod.id)
      useDownloadStoreEnhanced.getState().addDownload({
        id: `dl-${Date.now()}`,
        name: mod.title,
        game: mod.game?.name || "未知游戏",
        url: tokenInfo.url,
        fileName: tokenInfo.fileName,
        size: tokenInfo.fileSize ? `${(tokenInfo.fileSize / (1024 * 1024)).toFixed(2)} MB` : "未知",
      })
    } catch (error: any) {
      alert(`下载请求失败: ${error.message}`)
    }
  }

  const openModDetail = async (modId: string) => {
    const settings = getDesktopSettings()
    await window.electronAPI?.openExternal(`${settings.webBaseUrl}/mods/${modId}`)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-6 pt-6 pb-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">模组库</h2>
            <p className="text-sm text-muted-foreground">发现、筛选并下载社区模组</p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setActiveCategory("全部")}>
            <SlidersHorizontal className="w-3.5 h-3.5" />
            重置筛选
          </Button>
        </div>

        <div className="flex gap-1">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                activeCategory === category
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      <div className="shrink-0 px-6 pb-4 flex gap-4">
        {[
          { icon: TrendingUp, label: "当前展示", value: filteredMods.length || "-" },
          { icon: Clock, label: "最新上架", value: filteredMods[0]?.created_at ? new Date(filteredMods[0].created_at).toLocaleDateString() : "-" },
          { icon: Star, label: "精选推荐", value: mods.filter((mod) => (mod.tags || []).includes("精选")).length || "-" },
        ].map((stat) => (
          <div key={stat.label} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border">
            <stat.icon className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="text-sm font-semibold">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">正在加载模组...</p>
          </div>
        ) : filteredMods.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
            <p className="text-sm">没有符合条件的模组</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMods.map((mod) => (
              <div
                key={mod.id}
                className="group rounded-xl border border-border bg-card overflow-hidden hover:border-blue-500/30 hover:shadow-lg hover:shadow-blue-500/5 transition-all duration-200"
              >
                <button className="w-full text-left" onClick={() => void openModDetail(mod.id)}>
                  <div className="aspect-[16/9] bg-gradient-to-br from-muted to-muted/30 relative overflow-hidden">
                    {mod.thumbnail_url ? (
                      <img
                        src={mod.thumbnail_url}
                        alt={mod.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : null}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    <div className="absolute bottom-3 left-3 right-3">
                      <span className="text-[10px] font-medium text-white/70 bg-white/10 backdrop-blur-sm rounded px-1.5 py-0.5">
                        {mod.game?.name || "未知游戏"}
                      </span>
                    </div>
                  </div>
                </button>

                <div className="p-4 space-y-2">
                  <button className="w-full text-left" onClick={() => void openModDetail(mod.id)}>
                    <h3 className="font-semibold text-sm leading-tight group-hover:text-blue-400 transition-colors line-clamp-2">
                      {mod.title}
                    </h3>
                  </button>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">by {mod.author?.username || "未知作者"}</span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      {(mod.download_count || 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex gap-1 flex-wrap mb-2">
                    {(mod.tags || []).slice(0, 3).map((tag: string) => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => void openModDetail(mod.id)}>
                      <ExternalLink className="w-4 h-4" />
                      详情
                    </Button>
                    <Button size="sm" className="flex-1" onClick={() => void startDownload(mod)}>
                      下载
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
