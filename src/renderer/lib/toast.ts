export type ToastType = "info" | "success" | "error"

export interface ToastPayload {
  message: string
  type?: ToastType
  duration?: number
}

const TOAST_EVENT = "mikumod-toast"

export function showToast(payload: ToastPayload) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, { detail: payload }))
}

export function onToast(listener: (payload: ToastPayload) => void) {
  const handler = (event: Event) => {
    listener((event as CustomEvent<ToastPayload>).detail)
  }

  window.addEventListener(TOAST_EVENT, handler)
  return () => window.removeEventListener(TOAST_EVENT, handler)
}
