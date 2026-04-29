import { useCallback, useEffect, useMemo, useState } from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { TopBar } from "@/components/layout/top-bar"
import { WindowControls } from "@/components/layout/window-controls"
import { ModsPage } from "@/pages/mods"
import { CommunityFeed } from "@/pages/community-feed"
import { GamesPage } from "@/pages/games"
import { DownloadsPage } from "@/pages/downloads"
import { SettingsPage } from "@/pages/settings"
import { GameModManagerPage } from "@/pages/game-mod-manager"
import { fetchGames, getDownloadToken } from "@/lib/api"
import { getCustomGames, getLocalGamePaths, saveLocalGamePaths } from "@/lib/desktop-config"
import type { CustomGameEntry } from "@/lib/desktop-config"
import { AcceleratorPage } from "@/pages/accelerator"
import { ModDetailPage } from "@/pages/mod-detail"
import { PostDetailPage } from "@/pages/post-detail"
import { UserProfilePage } from "@/pages/user-profile"
import { NotificationsPage } from "@/pages/notifications"
import { useDownloadStore } from "@/store/download"

interface PlatformGameEntry {
  id: string
  name: string
}

function App() {
  const [activeTab, setActiveTab] = useState("mods")
  const [searchQuery, setSearchQuery] = useState("")
  const [history, setHistory] = useState<string[]>(["mods"])
  const [historyIndex, setHistoryIndex] = useState(0)

  // 提升游戏状态，供 Sidebar 使用
  const [platformGames, setPlatformGames] = useState<PlatformGameEntry[]>([])
  const [localPaths, setLocalPaths] = useState<Record<string, string>>(getLocalGamePaths())
  const [customGames, setCustomGames] = useState<CustomGameEntry[]>(getCustomGames())

  useEffect(() => {
    fetchGames()
      .then((data) => setPlatformGames((data as PlatformGameEntry[]) || []))
      .catch(() => setPlatformGames([]))
  }, [])

  useEffect(() => {
    for (const localPath of Object.values(localPaths)) {
      if (localPath) {
        void window.electronAPI?.authorizeDirectory?.(localPath)
      }
    }
  }, [localPaths])

  const persistPaths = useCallback((nextPaths: Record<string, string>) => {
    setLocalPaths(nextPaths)
    saveLocalGamePaths(nextPaths)
  }, [])

  const handleSetPath = useCallback(async (gameId: string) => {
    const selectedPath = await window.electronAPI?.selectDirectory()
    if (!selectedPath) return
    persistPaths({ ...localPaths, [gameId]: selectedPath })
  }, [localPaths, persistPaths])

  // 已设置路径的游戏列表（用于侧边栏）
  const installedGames = useMemo(() => {
    const allGames = [
      ...platformGames.map((g) => ({ id: g.id, name: g.name })),
      ...customGames.map((g) => ({ id: g.id, name: g.name })),
    ]
    return allGames.filter((g) => !!localPaths[g.id])
  }, [platformGames, customGames, localPaths])

  const canGoBack = historyIndex > 0
  const canGoForward = historyIndex < history.length - 1

  const navigateTo = useCallback((tab: string) => {
    setActiveTab((currentTab) => {
      if (currentTab === tab) return currentTab
      setHistory((currentHistory) => {
        const trimmedHistory = currentHistory.slice(0, Math.min(historyIndex + 1, currentHistory.length))
        const nextHistory = [...trimmedHistory, tab]
        setHistoryIndex(nextHistory.length - 1)
        return nextHistory
      })
      return tab
    })
  }, [historyIndex])

  useEffect(() => {
    let unmounted = false

    const handler = async (url: string) => {
      if (unmounted || !url.startsWith("mikumod://install")) return

      try {
        const parsed = new URL(url)
        const modId = parsed.searchParams.get("mod_id")
        const versionId = parsed.searchParams.get("version_id") || undefined
        const modTitle = parsed.searchParams.get("mod_title") || "MikuMod 模组"
        const gameId = parsed.searchParams.get("game_id") || undefined
        const gameName = parsed.searchParams.get("game_name") || "未知游戏"
        const apiBase = parsed.searchParams.get("api_base") || undefined
        if (!modId) return

        const tokenInfo = await getDownloadToken(modId, versionId, apiBase)
        await useDownloadStore.getState().addDownload({
          id: `dl-${Date.now()}`,
          name: modTitle,
          gameId,
          game: gameName,
          url: tokenInfo.url,
          fileName: tokenInfo.fileName,
          size: tokenInfo.fileSize ? `${(tokenInfo.fileSize / (1024 * 1024)).toFixed(2)} MB` : "未知",
          platformModId: modId,
          platformVersionId: versionId,
          autoInstallGamePath: gameId ? localPaths[gameId] : undefined,
        })
        navigateTo("downloads")
      } catch (error) {
        alert(`一键安装失败: ${error instanceof Error ? error.message : "未知错误"}`)
      }
    }

    const unsubscribe = window.electronAPI?.onDeepLink?.(handler)

    return () => {
      unmounted = true
      unsubscribe?.()
    }
  }, [localPaths, navigateTo])

  const handleBack = useCallback(() => {
    if (!canGoBack) return
    const nextIndex = historyIndex - 1
    setHistoryIndex(nextIndex)
    setActiveTab(history[nextIndex])
  }, [canGoBack, history, historyIndex])

  const handleForward = useCallback(() => {
    if (!canGoForward) return
    const nextIndex = historyIndex + 1
    setHistoryIndex(nextIndex)
    setActiveTab(history[nextIndex])
  }, [canGoForward, history, historyIndex])

  const currentPage = useMemo(() => {
    // mod:123 — in-app mod detail page
    if (activeTab.startsWith("mod:")) {
      const modNumber = activeTab.slice(4)
      return <ModDetailPage key={modNumber} modNumber={modNumber} onNavigate={navigateTo} onBack={handleBack} />
    }

    // post:123 — in-app post detail page
    if (activeTab.startsWith("post:")) {
      const postId = activeTab.slice(5)
      return <PostDetailPage key={postId} postId={postId} onNavigate={navigateTo} onBack={handleBack} />
    }

    // user:123 — in-app user profile page
    if (activeTab.startsWith("user:")) {
      const userNumber = activeTab.slice(5)
      return <UserProfilePage key={userNumber} userNumber={userNumber} onNavigate={navigateTo} />
    }

    // game:uuid — game mods page
    if (activeTab.startsWith("game:")) {
      const gameId = activeTab.slice(5)
      const game =
        platformGames.find((g) => g.id === gameId) ||
        customGames.find((g) => g.id === gameId)
      return (
        <GameModManagerPage
          gameId={gameId}
          gameName={game?.name ?? gameId}
          localPath={localPaths[gameId]}
          onSetPath={handleSetPath}
          onNavigate={navigateTo}
        />
      )
    }

    switch (activeTab) {
      case "mods":
        return <ModsPage searchQuery={searchQuery} onNavigate={navigateTo} />
      case "community":
        return <CommunityFeed searchQuery={searchQuery} onNavigate={navigateTo} />
      case "games":
        return (
          <GamesPage
            searchQuery={searchQuery}
            sharedLocalPaths={localPaths}
            onPathsChange={persistPaths}
            sharedCustomGames={customGames}
            onCustomGamesChange={setCustomGames}
          />
        )
      case "downloads":
        return <DownloadsPage />
      case "accelerator":
        return <AcceleratorPage />
      case "notifications":
        return <NotificationsPage onNavigate={navigateTo} />
      case "settings":
        return <SettingsPage />
      default:
        return <ModsPage searchQuery={searchQuery} onNavigate={navigateTo} />
    }
  }, [activeTab, searchQuery, localPaths, customGames, platformGames, persistPaths, handleSetPath, navigateTo, handleBack])

  return (
    <div className="dark h-screen w-screen flex overflow-hidden bg-background text-foreground">
      <Sidebar activeTab={activeTab} onTabChange={navigateTo} installedGames={installedGames} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar
          activeTab={activeTab}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onBack={handleBack}
          onForward={handleForward}
          onNavigate={navigateTo}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
        <main className="flex-1 overflow-hidden">
          {currentPage}
        </main>
      </div>
      <WindowControls />
    </div>
  )
}

export default App
