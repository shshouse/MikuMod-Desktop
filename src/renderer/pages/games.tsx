import { FolderOpen, Gamepad2, Loader2, MoreHorizontal, Plus, Radar, Search, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { fetchGames } from "@/lib/api"
import type { GameSummary } from "@/lib/api"
import { saveCustomGames, saveLocalGamePaths } from "@/lib/desktop-config"
import type { CustomGameEntry } from "@/lib/desktop-config"

// ponytail: gameName -> miName 映射, 用于检测到游戏后自动写入 XXMI Config
function resolveMiName(gameName: string): string | null {
  const lower = (gameName || "").toLowerCase()
  if (lower.includes("endfield") || lower.includes("终末地")) return "EFMI"
  if (lower.includes("genshin") || lower.includes("原神")) return "GIMI"
  if (lower.includes("star rail") || lower.includes("星穹铁道") || lower.includes("星铁")) return "SRMI"
  if (lower.includes("wuthering") || lower.includes("鸣潮")) return "WWMI"
  if (lower.includes("zenless") || lower.includes("绝区零")) return "ZZMI"
  if (lower.includes("honkai impact") || lower.includes("崩坏3") || lower.includes("崩坏3rd")) return "HIMI"
  return null
}

interface DisplayGame extends GameSummary {
  source: "platform" | "local"
}

interface GamesPageProps {
  searchQuery: string
  // 由 App 提升的共享状态
  sharedLocalPaths?: Record<string, string>
  onPathsChange?: (paths: Record<string, string>) => void
  sharedCustomGames?: CustomGameEntry[]
  onCustomGamesChange?: (games: CustomGameEntry[]) => void
}

export function GamesPage({
  searchQuery,
  sharedLocalPaths,
  onPathsChange,
  sharedCustomGames,
  onCustomGamesChange,
}: GamesPageProps) {
  const [games, setGames] = useState<GameSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isScanning, setIsScanning] = useState(false)
  const [scanResult, setScanResult] = useState<string | null>(null)

  // 本地 fallback（当独立使用时），正常由 App 提供
  const [localLocalPaths, setLocalLocalPaths] = useState<Record<string, string>>({})
  const [localCustomGames, setLocalCustomGames] = useState<CustomGameEntry[]>([])

  const localPaths = sharedLocalPaths ?? localLocalPaths
  const customGames = sharedCustomGames ?? localCustomGames

  useEffect(() => {
    async function loadGames() {
      setIsLoading(true)
      try {
        const data = await fetchGames()
        setGames(data || [])
      } catch (error) {
        console.error("Failed to fetch games:", error)
        setGames([])
      } finally {
        setIsLoading(false)
      }
    }
    void loadGames()
  }, [])

  const mergedGames = useMemo(() => {
    const platformGames: DisplayGame[] = games.map((game) => ({ ...game, source: "platform" }))
    const localOnlyGames: DisplayGame[] = customGames.map((game) => ({
      id: game.id,
      name: game.name,
      images: [],
      mod_count: 0,
      source: "local",
    }))
    const allGames = [...platformGames, ...localOnlyGames]
    if (!searchQuery.trim()) return allGames
    const normalized = searchQuery.trim().toLowerCase()
    return allGames.filter((game) => String(game.name || "").toLowerCase().includes(normalized))
  }, [customGames, games, searchQuery])

  const persistPaths = (nextPaths: Record<string, string>) => {
    if (onPathsChange) {
      onPathsChange(nextPaths)
    } else {
      setLocalLocalPaths(nextPaths)
    }
    saveLocalGamePaths(nextPaths)
  }

  const persistCustomGames = (nextGames: CustomGameEntry[]) => {
    if (onCustomGamesChange) {
      onCustomGamesChange(nextGames)
    } else {
      setLocalCustomGames(nextGames)
    }
    saveCustomGames(nextGames)
  }

  const handleSetPath = async (gameId: string) => {
    const selectedPath = await window.electronAPI?.selectDirectory()
    if (!selectedPath) return
    persistPaths({ ...localPaths, [gameId]: selectedPath })
    // 自动写入 XXMI Config
    const game = games.find(g => g.id === gameId) || customGames.find(g => g.id === gameId)
    if (game) {
      const miName = resolveMiName(game.name)
      if (miName) {
        try { await window.electronAPI?.xxmiWriteGameFolder?.(game.name, selectedPath) } catch {}
      }
    }
  }

  const handleManualAdd = async () => {
    const selectedPath = await window.electronAPI?.selectDirectory()
    if (!selectedPath) return
    const gameName = window.prompt("请输入游戏名称", "")
    if (!gameName?.trim()) return
    const id = `custom-${Date.now()}`
    const nextCustomGames = [
      ...customGames,
      { id, name: gameName.trim(), localPath: selectedPath, addedAt: new Date().toISOString() },
    ]
    persistCustomGames(nextCustomGames)
    persistPaths({ ...localPaths, [id]: selectedPath })
  }

  const handleAutoDetect = async () => {
    if (!window.electronAPI?.scanSteamGames) return
    setIsScanning(true)
    setScanResult(null)
    try {
      const nextPaths = { ...localPaths }
      const matched: string[] = []

      // Steam 检测
      const steamGames = await window.electronAPI.scanSteamGames()
      if (steamGames?.length) {
        const steamMap = new Map<string, string>()
        for (const sg of steamGames) steamMap.set(sg.appId, sg.installPath)
        for (const game of games) {
          if (!game.steam_app_id || nextPaths[game.id]) continue
          const installPath = steamMap.get(game.steam_app_id)
          if (installPath) {
            nextPaths[game.id] = installPath
            matched.push(game.name)
          }
        }
      }

      // 终末地检测(EFMI,非 Steam 渠道)
      if (window.electronAPI?.detectEndfield) {
        const endfield = await window.electronAPI.detectEndfield()
        if (endfield?.length) {
          const ENDFIELD_NAME_KEYS = ["endfield", "终末地"]
          for (const game of games) {
            if (nextPaths[game.id]) continue
            const nameLower = (game.name || "").toLowerCase()
            if (!ENDFIELD_NAME_KEYS.some((k) => nameLower.includes(k.toLowerCase()))) continue
            nextPaths[game.id] = endfield[0].installPath
            matched.push(game.name)
            break
          }
        }
      }

      if (matched.length > 0) {
        persistPaths(nextPaths)
        setScanResult(`已检测到 ${matched.length} 个游戏：${matched.join("、")}`)

        // 自动写入 XXMI Config.json: 检测到游戏路径后同步到 XXMI 配置
        for (const game of games) {
          const detectedPath = nextPaths[game.id]
          if (!detectedPath) continue
          const miName = resolveMiName(game.name)
          if (!miName) continue
          try {
            await window.electronAPI?.xxmiWriteGameFolder?.(game.name, detectedPath)
          } catch {
            // 写入失败不阻塞检测流程, 用户启动游戏时会再次写入
          }
        }
      } else {
        setScanResult("未检测到任何已安装的支持游戏")
      }
    } catch (err) {
      console.error("Auto-detect failed:", err)
      setScanResult("检测失败，请重试")
    } finally {
      setIsScanning(false)
      setTimeout(() => setScanResult(null), 6000)
    }
  }

  const openGameFolder = async (gameId: string) => {
    const localPath = localPaths[gameId]
    if (!localPath) {
      await handleSetPath(gameId)
      return
    }
    await window.electronAPI?.openDirectory(localPath)
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-5 space-y-4">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">游戏管理</h2>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-2 rounded-lg" onClick={() => void handleAutoDetect()} disabled={isScanning}>
              {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
              {isScanning ? "检测中..." : "自动检测"}
            </Button>
            <Button size="sm" className="gap-2 rounded-lg" onClick={() => void handleManualAdd()}>
              <Plus className="w-4 h-4" />
              手动添加
            </Button>
          </div>
        </div>

        {scanResult && (
          <div className="px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-sm text-blue-400 flex items-center gap-2">
            <Radar className="w-4 h-4 shrink-0" />
            <span>{scanResult}</span>
            <button className="ml-auto text-blue-400/60 hover:text-blue-400 transition-colors" onClick={() => setScanResult(null)}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Games grid card */}
        <div className="rounded-2xl bg-card p-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
              <Search className="w-8 h-8 animate-pulse" />
              <p className="text-sm">正在加载支持的游戏...</p>
            </div>
          ) : mergedGames.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
              <Gamepad2 className="w-12 h-12 text-muted-foreground/30 mb-2" />
              <p className="text-sm">没有匹配的游戏</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {mergedGames.map((game) => {
                const localPath = localPaths[game.id]
                const coverImage = game.images?.[0]
                return (
                  <div
                    key={game.id}
                    className="group flex flex-col rounded-xl border border-border/50 bg-background overflow-hidden hover:border-blue-500/30 transition-all"
                  >
                    <div className="h-24 bg-muted relative overflow-hidden flex items-center justify-center">
                      {coverImage ? (
                        <img src={coverImage} alt={game.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      ) : (
                        <Gamepad2 className="w-8 h-8 text-muted-foreground/30" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    </div>
                    <div className="p-3.5 flex flex-col flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold text-foreground/90 group-hover:text-blue-400 transition-colors line-clamp-1">
                            {game.name}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {game.source === "local" ? "本地手动添加" : "平台支持游戏"}
                          </p>
                        </div>
                        <Button variant="ghost" size="icon" className="shrink-0 -mr-2 -mt-1 opacity-50 hover:opacity-100 h-7 w-7" onClick={() => void openGameFolder(game.id)}>
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </div>

                      <div className="mt-2 text-xs text-muted-foreground">
                        {localPath ? (
                          <button
                            className="flex items-center gap-1.5 text-green-500/90 cursor-pointer hover:text-green-400 transition-colors"
                            onClick={() => void openGameFolder(game.id)}
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                            <span className="truncate" title={localPath}>{localPath}</span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-1.5 text-muted-foreground/60">
                            <FolderOpen className="w-3.5 h-3.5" />
                            <span>尚未设置游戏路径</span>
                          </div>
                        )}
                      </div>

                      <div className="mt-auto pt-3 flex items-center justify-between">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground">
                          模组 {game.mod_count || 0}
                        </span>
                        <Button
                          size="sm"
                          variant={localPath ? "outline" : "secondary"}
                          className="h-7 text-xs px-3 rounded-lg"
                          onClick={() => void (localPath ? openGameFolder(game.id) : handleSetPath(game.id))}
                        >
                          {localPath ? "打开目录" : "设置路径"}
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
