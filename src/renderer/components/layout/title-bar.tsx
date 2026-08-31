import { Minus, Square, X } from "lucide-react"

export function TitleBar() {
  const handleMinimize = () => window.electronAPI?.minimize()
  const handleMaximize = () => window.electronAPI?.maximize()
  const handleClose = () => window.electronAPI?.close()

  return (
    <div className="drag-region flex items-center justify-between h-9 bg-sidebar border-b border-sidebar-border select-none shrink-0">
      <div className="flex items-center gap-2 px-4">
        <img src="/favicon.ico" alt="" className="w-4 h-4" />
        <span className="text-xs font-semibold text-sidebar-foreground/70 tracking-wide">
          MIKUMOD DESKTOP
        </span>
      </div>
      <div className="no-drag flex items-center h-full">
        <button
          onClick={handleMinimize}
          className="h-full px-3 hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleMaximize}
          className="h-full px-3 hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={handleClose}
          className="h-full px-3 hover:bg-destructive/90 hover:text-white transition-colors text-muted-foreground"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
