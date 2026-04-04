import { cn } from "@/lib/utils"
import {
  Gamepad2,
  Download,
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

const navItems = [
  { id: "mods", label: "模组库", icon: Search, section: "discover" },
  { id: "community", label: "社区", icon: MessageSquare, section: "discover" },
  { id: "games", label: "游戏管理", icon: Gamepad2, section: "manage" },
  { id: "downloads", label: "下载管理", icon: Download, section: "manage" },
  { id: "accelerator", label: "网络加速", icon: Zap, section: "manage" },
  { id: "settings", label: "设置", icon: Settings, section: "other" },
]

const sections = [
  { id: "discover", label: "发现" },
  { id: "manage", label: "管理" },
  { id: "other", label: "" },
]

export function Sidebar({ activeTab, onTabChange, installedGames = [] }: SidebarProps) {
  return (
    <aside className="w-56 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col h-full">
      {/* Logo 拖拽区，高度与 TopBar 对齐 */}
      <div className="drag-region flex items-center px-5 h-14 border-b border-sidebar-border shrink-0">
        <img src={logoImg} alt="MikuMod" className="h-6 no-drag invert brightness-200" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {sections.map((section) => {
          const items = navItems.filter((i) => i.section === section.id)
          if (items.length === 0) return null
          return (
            <div key={section.id} className="mb-4">
              {section.label && (
                <div className="px-3 mb-2 text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                  {section.label}
                </div>
              )}
              {items.map((item) => {
                const Icon = item.icon
                const isActive = activeTab === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => onTabChange(item.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-150",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    )}
                  >
                    <Icon className={cn("w-4 h-4", isActive && "text-blue-400")} />
                    {item.label}
                  </button>
                )
              })}

              {/* 在「管理」section 下渲染已安装游戏列表 */}
              {section.id === "manage" && installedGames.length > 0 && (
                <div className="mt-1">
                  <div className="px-3 mb-1.5 mt-3 text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider">
                    已安装游戏
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
                          "w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-all duration-150",
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                            : "text-sidebar-foreground/60 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
                        )}
                      >
                        <Gamepad2 className={cn("w-3.5 h-3.5 shrink-0", isActive && "text-blue-400")} />
                        <span className="truncate text-xs">{game.name}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Version */}
      <div className="p-3 border-t border-sidebar-border">
        <div className="px-3 py-2 rounded-md bg-sidebar-accent/50">
          <p className="text-xs font-medium text-sidebar-foreground">MikuMod Desktop</p>
          <p className="text-[10px] text-muted-foreground">v0.1.0</p>
        </div>
      </div>
    </aside>
  )
}
