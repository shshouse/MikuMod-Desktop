import { Download, CheckCircle2, XCircle, Loader2, Pause, Play, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"

import { useDownloadStore } from "@/store/download"

const statusConfig = {
  downloading: { icon: Loader2, label: "下载中", color: "text-blue-500", iconClass: "animate-spin text-blue-500" },
  paused: { icon: Pause, label: "已暂停", color: "text-yellow-500", iconClass: "text-yellow-500" },
  done: { icon: CheckCircle2, label: "已完成", color: "text-green-500", iconClass: "text-green-500" },
  error: { icon: XCircle, label: "失败", color: "text-destructive", iconClass: "text-destructive" },
}

export function DownloadsPage() {
  const downloads = useDownloadStore.useStore()
  const store = useDownloadStore.getState()

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border/50 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">任务列表</h2>
          <p className="text-sm text-muted-foreground mt-1">管理您正在下载或已下载的资源</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8">全部暂停</Button>
          <Button 
            variant="outline" 
            size="sm" 
            className="h-8"
            onClick={() => store.clearDone()}
          >清空已完成</Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {downloads.map((dl) => {
          const cfg = statusConfig[dl.status as keyof typeof statusConfig]
          const Icon = cfg.icon
          
          return (
            <div key={dl.id} className="group p-4 rounded-xl border border-border bg-card hover:border-blue-500/30 transition-all flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <div className={`w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0`}>
                    <Icon className={`w-5 h-5 ${cfg.iconClass}`} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground/90">{dl.name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                      <span className="bg-secondary px-1.5 py-0.5 rounded text-[10px]">{dl.game}</span>
                      <span>大小: {dl.size}</span>
                      {dl.status === "downloading" && <span>• 速度: {dl.speed}</span>}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                   <span className={`text-[11px] font-medium mr-2 px-2 py-0.5 rounded-full ${dl.status === 'downloading' ? 'bg-blue-500/10 text-blue-400' : dl.status === 'paused' ? 'bg-yellow-500/10 text-yellow-500' : dl.status === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-green-500/10 text-green-400'}`}>
                      {cfg.label}
                   </span>
                   
                   <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {dl.status === 'downloading' ? (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => store.pause(dl.id)}>
                          <Pause className="w-4 h-4" />
                        </Button>
                      ) : dl.status === 'paused' ? (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => store.resume(dl.id)}>
                          <Play className="w-4 h-4" />
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => store.cancel(dl.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                   </div>
                </div>
              </div>
              
              {dl.status === "downloading" && (
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden mt-1">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-300 relative"
                    style={{ width: `${dl.progress}%` }}
                  >
                     <div className="absolute inset-0 bg-white/20 animate-pulse" />
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {downloads.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Download className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-sm text-foreground/80">目前没有任何下载任务</p>
            <p className="text-xs text-muted-foreground mt-1">您可以去模组库探索有趣的整合包</p>
          </div>
        )}
      </div>
    </div>
  )
}
