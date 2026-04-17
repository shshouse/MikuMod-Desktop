import { Clock, Loader2, SlidersHorizontal, Star, TrendingUp } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { fetchMods, getDownloadToken } from "@/lib/api"
import type { SearchModSummary } from "@/lib/api"
import { getDesktopSettings } from "@/lib/desktop-config"
import { cn } from "@/lib/utils"
import { useDownloadStoreEnhanced } from "@/store/download-enhanced"

const categories = ["全部", "热门", "最新", "推荐"] as const

interface ModsPageEnhancedProps {
  searchQuery: string
  onNavigate?: (tab: string) => void
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误"
}

export function ModsPageEnhanced({ searchQuery, onNavigate }: ModsPageEnhancedProps) {
  const [activeCategory, setActiveCategory] = useState<(typeof categories)[number]>("全部")
  const [mods, setMods] = useState<SearchModSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const PAGE_SIZE = 24

  const loadMods = useCallback(async (p: number) => {
    if (p === 0) setIsLoading(true)
    else setLoadingMore(true)
    try {
      const data = await fetchMods({ q: searchQuery || undefined, page: p, limit: PAGE_SIZE })
      if (p === 0) {
        setMods(data.mods || [])
      } else {
        setMods((prev) => [...prev, ...(data.mods || [])])
      }
      setTotal(data.total || 0)
      setPage(p)
    } catch (error) {
      console.error("Failed to fetch mods:", error)
      if (p === 0) setMods([])
    } finally {
      setIsLoading(false)
      setLoadingMore(false)
    }
  }, [PAGE_SIZE, searchQuery])

  useEffect(() => {
    setPage(0)
    setMods([])
    void loadMods(0)
  }, [loadMods])

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

  const startDownload = async (mod: SearchModSummary) => {
    try {
      const tokenInfo = await getDownloadToken(mod.id)
      await useDownloadStoreEnhanced.getState().addDownload({
        id: `dl-${Date.now()}`,
        name: mod.title,
        gameId: mod.game?.id || mod.game_id,
        game: mod.game?.name || "未知游戏",
        url: tokenInfo.url,
        fileName: tokenInfo.fileName,
        size: tokenInfo.fileSize ? `${(tokenInfo.fileSize / (1024 * 1024)).toFixed(2)} MB` : "未知",
        platformModId: mod.id,
      })
    } catch (error) {
      alert(`下载请求失败: ${getErrorMessage(error)}`)
    }
  }

  const openModDetail = (modNumber: string) => {
    if (onNavigate) {
      onNavigate(`mod:${modNumber}`)
    } else {
      const settings = getDesktopSettings()
      void window.electronAPI?.openExternal(`${settings.webBaseUrl}/mods/${modNumber}`)
    }
  }

  const hasMore = (page + 1) * PAGE_SIZE < total

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-5 space-y-4">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">模组库</h2>
          <div className="flex items-center gap-2">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  activeCategory === category
                    ? "bg-blue-500/15 text-blue-400"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {category}
              </button>
            ))}
            <Button variant="outline" size="sm" className="gap-1.5 rounded-lg ml-1" onClick={() => setActiveCategory("全部")}>
              <SlidersHorizontal className="w-3.5 h-3.5" />
              重置
            </Button>
          </div>
        </div>

        {/* Stats cards row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: TrendingUp, label: "当前展示", value: filteredMods.length || "-" },
            { icon: Clock, label: "最新上架", value: filteredMods[0]?.created_at ? new Date(filteredMods[0].created_at).toLocaleDateString() : "-" },
            { icon: Star, label: "精选推荐", value: mods.filter((mod) => (mod.tags || []).includes("精选")).length || "-" },
          ].map((stat) => (
            <div key={stat.label} className="flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-card">
              <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                <stat.icon className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">{stat.label}</p>
                <p className="text-base font-semibold">{stat.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Mod grid section */}
        <div className="rounded-2xl bg-card p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium">模组列表</h3>
            <span className="text-xs text-muted-foreground">{total} 个模组</span>
          </div>

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
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {filteredMods.map((mod) => (
                  <div
                    key={mod.id}
                    className="group rounded-xl border border-border/50 bg-background overflow-hidden hover:border-blue-500/30 transition-all duration-200"
                  >
                    <button className="w-full text-left" onClick={() => openModDetail(mod.mod_number || mod.id)}>
                      <div className="aspect-[16/9] bg-muted relative overflow-hidden">
                        {mod.thumbnail_url ? (
                          <img
                            src={mod.thumbnail_url}
                            alt={mod.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                        ) : null}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                        <div className="absolute bottom-2 left-2.5">
                          <span className="text-[10px] font-medium text-white/80 bg-white/10 backdrop-blur-sm rounded-md px-1.5 py-0.5">
                            {mod.game?.name || "未知游戏"}
                          </span>
                        </div>
                      </div>
                    </button>

                    <div className="p-3 space-y-1.5">
                      <button className="w-full text-left" onClick={() => openModDetail(mod.mod_number || mod.id)}>
                        <h3 className="font-medium text-sm leading-tight group-hover:text-blue-400 transition-colors line-clamp-1">
                          {mod.title}
                        </h3>
                      </button>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{mod.author?.username || "未知作者"}</span>
                        <span className="flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" />
                          {(mod.download_count || 0).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {(mod.tags || []).slice(0, 2).map((tag: string) => (
                          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-md bg-secondary text-secondary-foreground">
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-1.5 pt-1">
                        <Button variant="outline" size="sm" className="flex-1 h-7 text-[11px] rounded-lg" onClick={() => openModDetail(mod.mod_number || mod.id)}>
                          详情
                        </Button>
                        <Button size="sm" className="flex-1 h-7 text-[11px] rounded-lg" onClick={() => void startDownload(mod)}>
                          下载
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {hasMore && (
                <div className="text-center pt-5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    onClick={() => loadMods(page + 1)}
                    disabled={loadingMore}
                  >
                    {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : `加载更多 (${mods.length}/${total})`}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
