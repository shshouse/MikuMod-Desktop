import { Download, Eye, Gamepad2, Loader2, ThumbsUp, User } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

export interface ModCardMod {
  id: string
  title: string
  mod_number?: string
  game?: { id?: string; name?: string | null; game_number?: string } | null
  game_id?: string
  category?: { name?: string | null } | null
  author?: { username?: string | null; avatar_url?: string | null } | null
  media?: { thumbnail_url?: string | null } | null
  download_count?: number
  view_count?: number
  like_count?: number
  tags?: string[] | null
}

interface ModCardProps {
  mod: ModCardMod
  onDetail?: () => void
  onInstall?: () => void
  installing?: boolean
  className?: string
}

function formatNumber(num?: number): string {
  if (num == null) return "-"
  if (num >= 10000) return `${(num / 10000).toFixed(1)}w`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
  return num.toLocaleString()
}

export function ModCard({ mod, onDetail, onInstall, installing, className }: ModCardProps) {
  const [imageError, setImageError] = useState(false)

  const gameName = mod.game?.name || "未知游戏"
  const thumbnailUrl = mod.media?.thumbnail_url
  const categoryName = mod.category?.name
  const likeCount = mod.like_count || 0

  return (
    <div
      className={cn(
        "group bg-card border border-border rounded-xl overflow-hidden transition-colors duration-200 hover:border-foreground/30 h-full flex flex-col",
        className,
      )}
    >
      {/* Cover */}
      <button type="button" onClick={onDetail} className="relative block w-full text-left cursor-pointer">
        <div className="relative aspect-video overflow-hidden bg-muted">
          {thumbnailUrl && !imageError ? (
            <img
              src={thumbnailUrl}
              alt={mod.title}
              className="w-full h-full object-contain transition-opacity duration-200 group-hover:opacity-95"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              <Gamepad2 className="w-8 h-8 opacity-30" />
            </div>
          )}

          {/* Stats overlay */}
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2 bg-gradient-to-t from-black/70 via-black/20 to-transparent">
            <div className="flex items-center gap-2 text-xs font-medium text-white">
              <span className="flex items-center gap-1 whitespace-nowrap">
                <Eye className="w-3.5 h-3.5" />
                {formatNumber(mod.view_count)}
              </span>
              <span className="flex items-center gap-1 whitespace-nowrap">
                <Download className="w-3.5 h-3.5" />
                {formatNumber(mod.download_count)}
              </span>
              {likeCount > 0 && (
                <span className="flex items-center gap-1 whitespace-nowrap">
                  <ThumbsUp className="w-3.5 h-3.5" />
                  {formatNumber(likeCount)}
                </span>
              )}
            </div>
            <span className="px-2 py-0.5 bg-black/60 backdrop-blur-sm rounded text-xs font-medium text-white shrink-0">
              {gameName}
            </span>
          </div>
        </div>
      </button>

      {/* Content */}
      <div className="p-4 flex flex-1 flex-col">
        {/* Title */}
        <button type="button" onClick={onDetail} className="text-left cursor-pointer">
          <h3 className="text-foreground font-semibold text-base mb-2 line-clamp-1 min-h-6 group-hover:underline underline-offset-4 decoration-foreground/40">
            {mod.title}
          </h3>
        </button>

        {/* Author */}
        <div className="flex items-center gap-2 mb-3 min-h-5">
          {mod.author?.avatar_url ? (
            <img
              src={mod.author.avatar_url}
              alt=""
              className="w-4 h-4 rounded-full object-cover"
            />
          ) : (
            <User className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="text-sm text-muted-foreground">
            {mod.author?.username || "匿名"}
          </span>
        </div>

        {/* Install button (flex-grow spacer pushes bottom section down) */}
        {onInstall && (
          <div className="mb-3">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onInstall() }}
              disabled={installing}
              className="inline-flex items-center justify-center gap-1.5 w-full h-8 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
            >
              {installing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              一键安装
            </button>
          </div>
        )}

        {/* Bottom: game + category (same as Web端) */}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground border-t border-border pt-3 mt-auto">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-muted text-muted-foreground text-xs rounded-full truncate max-w-[7rem]">
              <Gamepad2 className="w-3.5 h-3.5 shrink-0" />
              {gameName}
            </span>
          </div>
          {categoryName && (
            <span className="px-2 py-0.5 bg-muted text-muted-foreground text-xs rounded-full shrink-0 max-w-[7rem] truncate">
              {categoryName}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
