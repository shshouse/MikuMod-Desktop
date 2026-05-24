import { useEffect, useState } from "react"
import { AlertTriangle, Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getApiBase } from "@/lib/api"
import { requestJson } from "@/lib/http"

interface PolicyResponse {
    channel: string
    platform: string
    latest_version: string | null
    min_supported_version: string | null
    force_update: boolean
    release_notes: string | null
    published_at: string | null
}

type Stage = 'idle' | 'available' | 'downloading' | 'ready' | 'error'

export function ForceUpdateGate({ children }: { children: React.ReactNode }) {
    const [policy, setPolicy] = useState<PolicyResponse | null>(null)
    const [stage, setStage] = useState<Stage>('idle')
    const [progress, setProgress] = useState(0)
    const [error, setError] = useState("")

    useEffect(() => {
        let cancelled = false
        const run = async () => {
            try {
                const channel = (await window.electronAPI?.updaterGetChannel?.().catch(() => 'stable')) || 'stable'
                const version = (await window.electronAPI?.getAppVersion?.().catch(() => '')) || ''
                const url = `${getApiBase()}/desktop/policy?channel=${channel}&platform=win-x64&current_version=${encodeURIComponent(version)}`
                const json = await requestJson<{ success: boolean; data: PolicyResponse }>(url, { timeoutMs: 8000 })
                if (cancelled) return
                if (json.success && json.data?.force_update) setPolicy(json.data)
            } catch {
                // Network error, skip force update check
            }
        }
        void run()
        return () => { cancelled = true }
    }, [])

    useEffect(() => {
        if (!policy) return
        window.electronAPI?.onUpdaterEvent?.((data) => {
            switch (data.type) {
                case 'update-available':
                    setStage('available')
                    break
                case 'download-progress':
                    setStage('downloading')
                    setProgress(data.progress?.percent || 0)
                    break
                case 'update-downloaded':
                    setStage('ready')
                    break
                case 'error':
                    setStage('error')
                    setError(data.error || '更新失败')
                    break
            }
        })
        void window.electronAPI?.updaterCheck?.()
    }, [policy])

    const startDownload = async () => {
        setStage('downloading')
        await window.electronAPI?.updaterDownload?.()
    }

    const installNow = () => {
        window.electronAPI?.updaterInstall?.()
    }

    if (!policy) return <>{children}</>

    return (
        <>
            {children}
            <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-card border border-destructive/40 rounded-2xl p-6 shadow-2xl space-y-5">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                            <AlertTriangle className="w-5 h-5 text-destructive" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-foreground">必须更新到 v{policy.latest_version}</h2>
                            <p className="text-sm text-muted-foreground mt-1">
                                当前版本已不再被支持（最低支持 v{policy.min_supported_version}），请升级后继续使用。
                            </p>
                        </div>
                    </div>

                    {policy.release_notes && (
                        <div className="bg-muted/40 rounded-lg p-3 text-xs text-foreground/70 whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {policy.release_notes}
                        </div>
                    )}

                    {stage === 'downloading' && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>下载中...</span>
                                <span>{Math.round(progress)}%</span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                            </div>
                        </div>
                    )}

                    {stage === 'error' && (
                        <p className="text-xs text-destructive">{error}</p>
                    )}

                    <div className="flex gap-2">
                        {stage === 'idle' || stage === 'available' || stage === 'error' ? (
                            <Button className="w-full gap-2" onClick={startDownload}>
                                <Download className="w-4 h-4" />
                                立即下载更新
                            </Button>
                        ) : stage === 'downloading' ? (
                            <Button className="w-full gap-2" disabled>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                正在下载...
                            </Button>
                        ) : (
                            <Button className="w-full gap-2" onClick={installNow}>
                                <Download className="w-4 h-4" />
                                立即重启安装
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </>
    )
}
