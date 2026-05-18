import { cn } from "@/lib/utils"
import { useDownloadStore } from "@/store/download"
import {
  Gamepad2,
  Download,
  MessageSquare,
  Search,
  Zap,
} from "lucide-react"
import logoImg from "@/assets/logo.png"

interface InstalledGame {
  id: string
  name: string
}

interface SidebarProps {
  activeTab: string
  onTabChange: (tab: string) => void
  installedGames?: InstalledGame[]
}

const topNavItems = [
  { id: "mods", label: "模组", icon: Search },
  { id: "community", label: "社区", icon: MessageSquare },
  { id: "games", label: "游戏", icon: Gamepad2 },
  { id: "downloads", label: "下载", icon: Download },
  { id: "accelerator", label: "加速", icon: Zap },
]

export function Sidebar({ activeTab, onTabChange, installedGames = [] }: SidebarProps) {
  const resolvedActive = activeTab.startsWith("game:") ? "games" : activeTab
  const downloadTaskCount = useDownloadStore.useStore().length

  return (
    <aside className="w-48 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col h-full">
      {/* Logo 拖拽区，高度与 TopBar 对齐 */}
      <div className="drag-region flex items-center px-4 h-14 border-b border-sidebar-border shrink-0">
        <img src={logoImg} alt="MikuMod" className="h-6 no-drag invert brightness-200" />
      </div>

      {/* Navigation - top */}
      <nav className="flex-1 flex flex-col px-3 pt-3 gap-1 overflow-y-auto">
        {topNavItems.map((item) => {
          const Icon = item.icon
          const isActive = resolvedActive === item.id
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={cn(
                "w-full h-9 flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-150 text-left",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Icon className={cn("w-4 h-4 shrink-0", isActive && "text-blue-400")} />
              <span className={cn("text-sm", isActive ? "font-medium" : "font-normal")}>
                {item.label}
              </span>
              {item.id === "downloads" && downloadTaskCount > 0 ? (
                <span className="ml-auto min-w-5 rounded-full bg-blue-500/15 px-1.5 py-0.5 text-center text-[10px] font-semibold text-blue-400">
                  {downloadTaskCount}
                </span>
              ) : null}
            </button>
          )
        })}

        {/* 已安装游戏 */}
        {installedGames.length > 0 && (
          <>
            <div className="h-px bg-sidebar-border my-2 mx-3" />
            <div className="px-3 mb-1">
              <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                已安装游戏
              </span>
            </div>
            {installedGames.map((game) => {
              const tabId = `game:${game.id}`
              const isActive = activeTab === tabId
              return (
                <button
                  key={game.id}
                  onClick={() => onTabChange(tabId)}
                  title={game.name}
                  className={cn(
                    "w-full h-8 flex items-center gap-2.5 px-3 py-1.5 rounded-xl transition-all duration-150 text-left",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/60 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
                  )}
                >
                  <Gamepad2 className={cn("w-3.5 h-3.5 shrink-0", isActive && "text-blue-400")} />
                  <span className={cn("text-xs truncate", isActive ? "font-medium" : "font-normal")}>
                    {game.name}
                  </span>
                </button>
              )
            })}
          </>
        )}
      </nav>

      {/* Navigation - bottom */}
      <div className="flex flex-col px-3 pb-3 gap-1">
        {bottomNavItems.map((item) => {
          const Icon = item.icon
          const isActive = resolvedActive === item.id
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={cn(
                "w-full h-9 flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-150 text-left",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Icon className={cn("w-4 h-4 shrink-0", isActive && "text-blue-400")} />
              <span className={cn("text-sm", isActive ? "font-medium" : "font-normal")}>
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
