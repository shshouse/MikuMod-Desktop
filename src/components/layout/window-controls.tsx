import { Minus, Square, X } from "lucide-react"

export function WindowControls() {
  const handleMinimize = () => window.electronAPI?.minimize()
  const handleMaximize = () => window.electronAPI?.maximize()
  const handleClose = () => window.electronAPI?.close()

  return (
    <div className="fixed top-0 right-0 z-50 flex items-center h-12 no-drag">
      <button
        onClick={handleMinimize}
        className="w-12 h-full flex items-center justify-center hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
      >
        <Minus className="w-4 h-4" />
      </button>
      <button
        onClick={handleMaximize}
        className="w-12 h-full flex items-center justify-center hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
      >
        <Square className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={handleClose}
        className="w-12 h-full flex items-center justify-center hover:bg-destructive/90 hover:text-white transition-colors text-muted-foreground"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
