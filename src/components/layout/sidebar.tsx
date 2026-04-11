import { cn } from "@/lib/utils"
import {
  Gamepad2,
  Download,
  LayoutDashboard,
  MessageSquare,
  Settings,
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
  { id: "modder-dashboard", label: "创作", icon: LayoutDashboard },
]

const bottomNavItems = [
  { id: "settings", label: "设置", icon: Settings },
]

export function Sidebar({ activeTab, onTabChange, installedGames = [] }: SidebarProps) {
  const resolvedActive = activeTab.startsWith("game:") ? "games" : activeTab

  return (
    <aside className="w-16 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col h-full">
      {/* Logo 拖拽区，高度与 TopBar 对齐 */}
      <div className="drag-region flex items-center justify-center h-14 border-b border-sidebar-border shrink-0">
        <img src={logoImg} alt="MikuMod" className="h-5 no-drag invert brightness-200" />
      </div>

      {/* Navigation - top */}
      <nav className="flex-1 flex flex-col items-center pt-2 gap-0.5 overflow-y-auto">
        {topNavItems.map((item) => {
          const Icon = item.icon
          const isActive = resolvedActive === item.id
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              title={item.label}
              className={cn(
                "w-12 h-12 flex flex-col items-center justify-center gap-0.5 rounded-xl transition-all duration-150",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Icon className={cn("w-[18px] h-[18px]", isActive && "text-blue-400")} />
              <span className={cn("text-[10px] leading-none", isActive ? "font-medium" : "font-normal")}>
                {item.label}
              </span>
            </button>
          )
        })}

        {/* 已安装游戏 - 紧凑图标 */}
        {installedGames.length > 0 && (
          <>
            <div className="w-8 h-px bg-sidebar-border my-1.5" />
            {installedGames.map((game) => {
              const tabId = `game:${game.id}`
              const isActive = activeTab === tabId
              return (
                <button
                  key={game.id}
                  onClick={() => onTabChange(tabId)}
                  title={game.name}
                  className={cn(
                    "w-12 h-10 flex items-center justify-center rounded-xl transition-all duration-150",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/40 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
                  )}
                >
                  <Gamepad2 className={cn("w-4 h-4", isActive && "text-blue-400")} />
                </button>
              )
            })}
          </>
        )}
      </nav>

      {/* Navigation - bottom */}
      <div className="flex flex-col items-center pb-3 gap-0.5">
        {bottomNavItems.map((item) => {
          const Icon = item.icon
          const isActive = resolvedActive === item.id
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              title={item.label}
              className={cn(
                "w-12 h-12 flex flex-col items-center justify-center gap-0.5 rounded-xl transition-all duration-150",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Icon className={cn("w-[18px] h-[18px]", isActive && "text-blue-400")} />
              <span className={cn("text-[10px] leading-none", isActive ? "font-medium" : "font-normal")}>
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
