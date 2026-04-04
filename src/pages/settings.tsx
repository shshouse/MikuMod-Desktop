import { Settings2, FolderOpen, Server, RefreshCcw, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"

export function SettingsPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border/50">
        <h2 className="text-xl font-semibold tracking-tight">偏好设置</h2>
        <p className="text-sm text-muted-foreground mt-1">定制 MikuMod 客户端行为和资源路径</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Core Settings Section */}
        <section className="space-y-4">
          <h3 className="text-sm font-medium flex items-center gap-2 text-foreground/80">
            <Settings2 className="w-4 h-4 text-blue-400" />
            通用配置
          </h3>
          
          <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
            {/* Setting Item 1 */}
            <div className="p-4 flex items-center justify-between hover:bg-muted/10 transition-colors">
              <div className="flex gap-4 items-center">
                <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                  <FolderOpen className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground/90">默认下载目录</p>
                  <p className="text-xs text-muted-foreground mt-0.5">所有模组整合包下载后的默认解压和缓存位置</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-muted-foreground bg-muted px-2.5 py-1.5 rounded-md border border-border">
                  D:\MikuMod\downloads
                </span>
                <Button variant="outline" size="sm" className="h-8">更改</Button>
              </div>
            </div>

            {/* Setting Item 2 */}
            <div className="p-4 flex items-center justify-between hover:bg-muted/10 transition-colors">
              <div className="flex gap-4 items-center">
                <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                  <Server className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground/90">API 服务器源</p>
                  <p className="text-xs text-muted-foreground mt-0.5">MikuMod 社区数据的获取接口节点</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-muted-foreground bg-muted px-2.5 py-1.5 rounded-md border border-border">
                  https://mikumod.com
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="space-y-4 pt-4">
          <h3 className="text-sm font-medium text-destructive/80 pl-1">危险操作</h3>
          
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 overflow-hidden divide-y divide-destructive/10">
            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground/90">清除本地缓存</p>
                <p className="text-xs text-muted-foreground mt-0.5">清除所有下载的图片、临时文件以及错误日志</p>
              </div>
              <Button variant="outline" size="sm" className="h-8 gap-2 border-destructive/20 hover:bg-destructive/10 hover:text-destructive">
                <RefreshCcw className="w-3.5 h-3.5" />
                清除
              </Button>
            </div>
            
            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground/90">退出登录</p>
                <p className="text-xs text-muted-foreground mt-0.5">断开当前账号与客户端的链接</p>
              </div>
              <Button variant="destructive" size="sm" className="h-8 gap-2">
                <LogOut className="w-3.5 h-3.5" />
                退出账号
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
