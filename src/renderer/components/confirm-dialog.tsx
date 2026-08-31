import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { onConfirm, resolveConfirm, type ConfirmOptions } from "@/lib/confirm"

export function ConfirmDialog() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)

  useEffect(() => onConfirm(setOptions), [])

  if (!options) return null

  const handleConfirm = () => { setOptions(null); resolveConfirm(true) }
  const handleCancel = () => { setOptions(null); resolveConfirm(false) }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-150">
        {options.title && <h3 className="text-base font-semibold mb-2">{options.title}</h3>}
        <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{options.message}</p>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" size="sm" onClick={handleCancel}>
            {options.cancelText || "取消"}
          </Button>
          <Button size="sm" onClick={handleConfirm}>
            {options.confirmText || "确定"}
          </Button>
        </div>
      </div>
    </div>
  )
}
