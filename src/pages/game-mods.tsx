import { ExternalLink, FolderOpen, Loader2, Package, Plus, TrendingUp } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { fetchMods, getDownloadToken } from "@/lib/api"

import { useDownloadStoreEnhanced } from "@/store/download-enhanced"

interface GameModsPageProps {
  gameId: string
  gameName: string
  localPath: string | undefined
  onSetPath: (gameId: string) => void
  onNavigate: (tab: string) => void
}

export function GameModsPage({ gameId, gameName, localPath, onSetPath, onNavigate }: GameModsPageProps) {
  const [mods, setMods] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    setIsLoading(true)
    fetchMods({ limit: 48 })
      .then((data) => {
        const all: any[] = data.mods || []
        // 按 game.id 或 game_id 字段筛选当前游戏
        const filtered = all.filter((m) => m.game?.id === gameId || m.game_id === gameId)
        setMods(filtered)
      })
      .catch(() => setMods([]))
      .finally(() => setIsLoading(false))
  }, [gameId])

  const openModDetail = (modNumber: string) => {
    onNavigate(`mod:${modNumber}`)
  }

  const startDownload = async (mod: any) => {
    try {
      const tokenInfo = await getDownloadToken(mod.id)
      useDownloadStoreEnhanced.getState().addDownload({
        id: `dl-${Date.now()}`,
        name: mod.title,
        game: gameName,
        url: tokenInfo.url,
        fileName: tokenInfo.fileName,
        size: tokenInfo.fileSize ? `${(tokenInfo.fileSize / (1024 * 1024)).toFixed(2)} MB` : "未知",
      })
    } catch (error: any) {
      alert(`下载请求失败: ${error.message}`)
    }
  }

  const openGameFolder = async () => {
    if (localPath) {
      await window.electronAPI?.openDirectory(localPath)
    } else {
      await onSetPath(gameId)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 flex items-center justify-between border-b border-border/50">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{gameName}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {localPath ? (
              <button
                className="flex items-center gap-1.5 text-green-500/90 hover:text-green-400 transition-colors"
                onClick={() => void openGameFolder()}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span className="truncate max-w-[360px]" title={localPath}>{localPath}</span>
              </button>
            ) : (
              <button
                className="flex items-center gap-1.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                onClick={() => void onSetPath(gameId)}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                点击设置游戏目录
              </button>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-2 shadow-sm rounded-full px-4"
            onClick={() => onNavigate("mods")}
          >
            <Plus className="w-4 h-4" />
            去模组库添加
          </Button>
          {localPath && (
            <Button
              size="sm"
              variant="outline"
              className="gap-2 shadow-sm rounded-full px-4"
              onClick={() => void openGameFolder()}
            >
              <FolderOpen className="w-4 h-4" />
              打开目录
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">正在加载模组...</p>
          </div>
        ) : mods.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-4">
            <Package className="w-12 h-12 text-muted-foreground/20" />
            <div className="text-center">
              <p className="text-sm font-medium">暂无该游戏的模组</p>
              <p className="text-xs mt-1 text-muted-foreground/60">前往模组库浏览并下载模组</p>
            </div>
            <Button size="sm" className="gap-2 rounded-full px-5" onClick={() => onNavigate("mods")}>
              <Plus className="w-4 h-4" />
              去模组库添加
            </Button>
          </div>
        ) : (
          <div className="pt-5">
            <p className="text-xs text-muted-foreground mb-4">共 {mods.length} 个模组</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {mods.map((mod) => (
                <div
                  key={mod.id}
                  className="group rounded-xl border border-border bg-card overflow-hidden hover:border-blue-500/30 hover:shadow-lg hover:shadow-blue-500/5 transition-all duration-200"
                >
                  <button className="w-full text-left" onClick={() => openModDetail(mod.mod_number || mod.id)}>
                    <div className="aspect-[16/9] bg-gradient-to-br from-muted to-muted/30 relative overflow-hidden">
                      {mod.thumbnail_url && (
                        <img
                          src={mod.thumbnail_url}
                          alt={mod.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    </div>
                  </button>

                  <div className="p-4 space-y-2">
                    <button className="w-full text-left" onClick={() => openModDetail(mod.mod_number || mod.id)}>
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
                    <div className="flex gap-1 flex-wrap">
                      {(mod.tags || []).slice(0, 3).map((tag: string) => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => openModDetail(mod.mod_number || mod.id)}>
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
          </div>
        )}
      </div>
    </div>
  )
}
