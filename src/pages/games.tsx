import { Gamepad2, FolderOpen, Plus, MoreHorizontal, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useState, useEffect } from "react"
import { fetchGames as fetchGamesApi } from "@/lib/api"
import type { GameSummary } from "@/lib/api"

export function GamesPage() {
  const [games, setGames] = useState<GameSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [localPaths, setLocalPaths] = useState<Record<string, string>>({})

  const handleSetPath = async (gameId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const electronAPI = window.electronAPI
    if (electronAPI?.selectDirectory) {
      const selectedPath = await electronAPI.selectDirectory()
      if (selectedPath) {
        const paths = { ...localPaths, [gameId]: selectedPath }
        setLocalPaths(paths)
        localStorage.setItem("mikumod_local_paths", JSON.stringify(paths))
      }
    } else {
      const testPath = prompt("请输入游戏本地安装路径：", "D:\\Games\\Example")
      if (testPath) {
        const paths = { ...localPaths, [gameId]: testPath }
        setLocalPaths(paths)
        localStorage.setItem("mikumod_local_paths", JSON.stringify(paths))
      }
    }
  }

  useEffect(() => {
    // 假设本地路径存储在 localStorage 中
    const paths = JSON.parse(localStorage.getItem("mikumod_local_paths") || "{}")
    setLocalPaths(paths)

    async function fetchGames() {
      setIsLoading(true)
      try {
        const data = await fetchGamesApi()
        setGames(data || [])
      } catch (err) {
        console.error("Failed to fetch games:", err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchGames()
  }, [])

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-6 pt-6 pb-4 flex items-center justify-between border-b border-border/50">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">游戏管理</h2>
          <p className="text-sm text-muted-foreground mt-1">管理已安装游戏和对应的模组</p>
        </div>
        <Button size="sm" className="gap-2 shadow-sm rounded-full px-4">
          <Plus className="w-4 h-4" />
          手动添加
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">正在加载支持的游戏...</p>
          </div>
        ) : games.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
            <Gamepad2 className="w-12 h-12 text-muted-foreground/30 mb-2" />
            <p className="text-sm">暂无支持的游戏数据</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {games.map((game) => {
              const localPath = localPaths[game.id]
              const coverImage = game.images?.[0]

              return (
                <div
                  key={game.id}
                  className="group flex flex-col gap-0 rounded-xl border border-border bg-card overflow-hidden hover:border-blue-500/30 hover:shadow-md hover:shadow-blue-500/5 transition-all cursor-pointer"
                >
                  <div className="h-24 bg-muted relative overflow-hidden flex items-center justify-center">
                    {coverImage ? (
                      <img src={coverImage} alt={game.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <Gamepad2 className="w-8 h-8 text-muted-foreground/30" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  </div>
                  <div className="p-4 flex flex-col flex-1">
                    <div className="flex items-start justify-between">
                      <h3 className="text-base font-semibold text-foreground/90 group-hover:text-blue-400 transition-colors line-clamp-1">
                        {game.name}
                      </h3>
                      <Button variant="ghost" size="icon" className="shrink-0 -mr-2 -mt-2 opacity-50 hover:opacity-100">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {localPath ? (
                        <div 
                          className="flex items-center gap-1.5 text-green-500/90 cursor-pointer hover:text-green-400 transition-colors"
                          onClick={(e) => handleSetPath(game.id, e)}
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          <span className="truncate" title={localPath}>{localPath}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-muted-foreground/60">
                          <FolderOpen className="w-3.5 h-3.5" />
                          <span>未设置游戏路径</span>
                        </div>
                      )}
                    </div>
                    <div className="mt-auto pt-4 flex items-center justify-between">
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground inline-flex">
                        平台模组数: {game.mod_count || 0}
                      </span>
                      {!localPath && (
                         <Button 
                           size="sm" 
                           variant="secondary" 
                           className="h-7 text-[11px] px-3 rounded-full"
                           onClick={(e) => handleSetPath(game.id, e)}
                         >
                           设置路径
                         </Button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
