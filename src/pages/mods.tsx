import { Clock, Loader2, SlidersHorizontal, Star, TrendingUp } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { ModCard } from "@/components/mod/mod-card"
import { fetchMods } from "@/lib/api"
import type { SearchModSummary } from "@/lib/api"
import { getDesktopSettings } from "@/lib/desktop-config"
import { cn } from "@/lib/utils"
import { queueOneClickInstallByModNumber, showOneClickInstallError } from "@/lib/mod-install"

const categories = ["全部", "热门", "最新", "推荐"] as const

interface ModsPageProps {
  searchQuery: string
  localPaths: Record<string, string>
  onSetPath: (gameId: string) => Promise<string | null | undefined>
  onNavigate?: (tab: string) => void
}

export function ModsPage({ searchQuery, localPaths, onSetPath, onNavigate }: ModsPageProps) {
  const [activeCategory, setActiveCategory] = useState<(typeof categories)[number]>("全部")
  const [mods, setMods] = useState<SearchModSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [installingId, setInstallingId] = useState<string | null>(null)
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

  const startInstall = async (mod: SearchModSummary) => {
    if (!mod.mod_number) { openModDetail(mod.mod_number || mod.id); return }
    setInstallingId(mod.id)
    try {
      await queueOneClickInstallByModNumber({
        modNumber: mod.mod_number,
        resolveGamePath: async (gameId) => localPaths[gameId] || await onSetPath(gameId),
      })
    } catch (error) {
      showOneClickInstallError(error)
    } finally {
      setInstallingId(null)
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
                  <ModCard
                    key={mod.id}
                    mod={mod}
                    onDetail={() => openModDetail(mod.mod_number || mod.id)}
                    onInstall={() => void startInstall(mod)}
                    installing={installingId === mod.id}
                  />
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
