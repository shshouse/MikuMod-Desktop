import { useCallback, useEffect, useMemo, useState } from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { TopBarEnhanced } from "@/components/layout/top-bar-enhanced"
import { WindowControls } from "@/components/layout/window-controls"
import { ModsPageEnhanced } from "@/pages/mods-enhanced"
import { CommunityFeed } from "@/pages/community-feed"
import { GamesPageEnhanced } from "@/pages/games-enhanced"
import { DownloadsPageEnhanced } from "@/pages/downloads-enhanced"
import { SettingsPageEnhanced } from "@/pages/settings-enhanced"
import { GameModsPage } from "@/pages/game-mods"
import { fetchGames } from "@/lib/api"
import { getCustomGames, getLocalGamePaths, saveLocalGamePaths } from "@/lib/desktop-config"
import { AcceleratorPage } from "@/pages/accelerator"
import { ModDetailPage } from "@/pages/mod-detail"
import { PostDetailPage } from "@/pages/post-detail"
import { UserProfilePage } from "@/pages/user-profile"
import { NotificationsPage } from "@/pages/notifications"
import { ModderDashboard } from "@/pages/modder-dashboard"

function App() {
  const [activeTab, setActiveTab] = useState("mods")
  const [searchQuery, setSearchQuery] = useState("")
  const [history, setHistory] = useState<string[]>(["mods"])
  const [historyIndex, setHistoryIndex] = useState(0)

  // 提升游戏状态，供 Sidebar 使用
  const [platformGames, setPlatformGames] = useState<any[]>([])
  const [localPaths, setLocalPaths] = useState<Record<string, string>>({})
  const [customGames, setCustomGames] = useState(getCustomGames())

  useEffect(() => {
    setLocalPaths(getLocalGamePaths())
    setCustomGames(getCustomGames())
    fetchGames()
      .then((data) => setPlatformGames(data || []))
      .catch(() => setPlatformGames([]))
  }, [])

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

  const navigateTo = (tab: string) => {
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
  }

  const handleBack = () => {
    if (!canGoBack) return
    const nextIndex = historyIndex - 1
    setHistoryIndex(nextIndex)
    setActiveTab(history[nextIndex])
  }

  const handleForward = () => {
    if (!canGoForward) return
    const nextIndex = historyIndex + 1
    setHistoryIndex(nextIndex)
    setActiveTab(history[nextIndex])
  }

  const currentPage = useMemo(() => {
    // mod:123 — in-app mod detail page
    if (activeTab.startsWith("mod:")) {
      const modNumber = activeTab.slice(4)
      return <ModDetailPage modNumber={modNumber} onNavigate={navigateTo} onBack={handleBack} />
    }

    // post:123 — in-app post detail page
    if (activeTab.startsWith("post:")) {
      const postId = activeTab.slice(5)
      return <PostDetailPage postId={postId} onNavigate={navigateTo} onBack={handleBack} />
    }

    // user:123 — in-app user profile page
    if (activeTab.startsWith("user:")) {
      const userNumber = activeTab.slice(5)
      return <UserProfilePage userNumber={userNumber} onNavigate={navigateTo} />
    }

    // game:uuid — game mods page
    if (activeTab.startsWith("game:")) {
      const gameId = activeTab.slice(5)
      const game =
        platformGames.find((g) => g.id === gameId) ||
        customGames.find((g) => g.id === gameId)
      return (
        <GameModsPage
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
        return <ModsPageEnhanced searchQuery={searchQuery} onNavigate={navigateTo} />
      case "community":
        return <CommunityFeed searchQuery={searchQuery} onNavigate={navigateTo} />
      case "games":
        return (
          <GamesPageEnhanced
            searchQuery={searchQuery}
            sharedLocalPaths={localPaths}
            onPathsChange={persistPaths}
            sharedCustomGames={customGames}
            onCustomGamesChange={setCustomGames}
          />
        )
      case "downloads":
        return <DownloadsPageEnhanced />
      case "accelerator":
        return <AcceleratorPage />
      case "notifications":
        return <NotificationsPage onNavigate={navigateTo} />
      case "modder-dashboard":
        return <ModderDashboard onNavigate={navigateTo} />
      case "settings":
        return <SettingsPageEnhanced />
      default:
        return <ModsPageEnhanced searchQuery={searchQuery} onNavigate={navigateTo} />
    }
  }, [activeTab, searchQuery, localPaths, customGames, platformGames, persistPaths, handleSetPath])

  return (
    <div className="dark h-screen w-screen flex overflow-hidden bg-background text-foreground">
      <Sidebar activeTab={activeTab} onTabChange={navigateTo} installedGames={installedGames} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBarEnhanced
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
