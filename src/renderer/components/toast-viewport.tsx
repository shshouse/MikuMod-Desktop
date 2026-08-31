import { CheckCircle2, Info, XCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { onToast, type ToastPayload, type ToastType } from "@/lib/toast"

interface ToastItem extends Required<ToastPayload> {
  id: number
}

const iconByType: Record<ToastType, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  error: XCircle,
}

const styleByType: Record<ToastType, string> = {
  info: "border-blue-500/30 bg-blue-500/10 text-blue-100",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
  error: "border-red-500/30 bg-red-500/10 text-red-100",
}

export function ToastViewport() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    return onToast((payload) => {
      const id = Date.now() + Math.random()
      const toast: ToastItem = {
        id,
        message: payload.message,
        type: payload.type || "info",
        duration: payload.duration ?? 2400,
      }

      setToasts((current) => [...current.slice(-2), toast])
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== id))
      }, toast.duration)
    })
  }, [])

  return (
    <div className="pointer-events-none fixed left-1/2 top-5 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((toast) => {
        const Icon = iconByType[toast.type]
        return (
          <div
            key={toast.id}
            className={cn(
              "flex min-w-64 max-w-[520px] items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-3 duration-200",
              styleByType[toast.type]
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{toast.message}</span>
          </div>
        )
      })}
    </div>
  )
}
