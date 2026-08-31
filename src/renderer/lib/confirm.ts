export interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
}

type ConfirmResolver = (confirmed: boolean) => void

const CONFIRM_EVENT = "mikumod-confirm"

let activeResolver: ConfirmResolver | null = null

export function showConfirm(options: ConfirmOptions): Promise<boolean> {
  if (activeResolver) activeResolver(false)
  return new Promise<boolean>((resolve) => {
    activeResolver = resolve
    window.dispatchEvent(new CustomEvent<ConfirmOptions>(CONFIRM_EVENT, { detail: options }))
  })
}

export function resolveConfirm(confirmed: boolean) {
  if (!activeResolver) return
  const r = activeResolver
  activeResolver = null
  r(confirmed)
}

export function onConfirm(listener: (options: ConfirmOptions) => void) {
  const handler = (event: Event) => {
    listener((event as CustomEvent<ConfirmOptions>).detail)
  }
  window.addEventListener(CONFIRM_EVENT, handler)
  return () => window.removeEventListener(CONFIRM_EVENT, handler)
}
