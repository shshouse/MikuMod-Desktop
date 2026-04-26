import { logger, newRequestId } from "./logger"

export interface HttpRequestOptions extends RequestInit {
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
  maxRetryDelayMs?: number
  retryOnStatuses?: number[]
  requestId?: string
}

const DEFAULT_RETRY_ON_STATUSES = [408, 425, 429, 500, 502, 503, 504]

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function headersToRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries())
}

function ensureRequestId(options: HttpRequestOptions): { headers: Headers; requestId: string } {
  const headers = new Headers(options.headers)
  const existing = headers.get("x-request-id") || options.requestId
  const requestId = existing && existing.length > 0 ? existing : newRequestId()
  headers.set("x-request-id", requestId)
  return { headers, requestId }
}

function bindAbortSignal(signal: AbortSignal | undefined, controller: AbortController) {
  if (!signal) {
    return () => undefined
  }

  if (signal.aborted) {
    controller.abort(signal.reason)
    return () => undefined
  }

  const onAbort = () => controller.abort(signal.reason)
  signal.addEventListener("abort", onAbort, { once: true })
  return () => signal.removeEventListener("abort", onAbort)
}

async function requestViaElectron(url: string, options: HttpRequestOptions): Promise<Response> {
  const headers = new Headers(options.headers)
  const requestOptions = {
    ...options,
    headers: headersToRecord(headers),
  }

  delete requestOptions.signal
  delete (requestOptions as { requestId?: string }).requestId

  const result = await window.electronAPI.httpRequest(url, requestOptions)

  return new Response(result.text, {
    status: result.status,
    statusText: result.ok ? "OK" : "ERROR",
    headers: result.headers,
  })
}

async function requestViaBrowser(url: string, options: HttpRequestOptions): Promise<Response> {
  const controller = new AbortController()
  const detachAbort = bindAbortSignal(options.signal ?? undefined, controller)
  const timeout = window.setTimeout(() => controller.abort(new Error("Request timed out")), options.timeoutMs ?? 15000)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    window.clearTimeout(timeout)
    detachAbort()
  }
}

async function performRequest(url: string, options: HttpRequestOptions): Promise<Response> {
  if (typeof window !== "undefined" && window.electronAPI && typeof window.electronAPI.httpRequest === "function") {
    return requestViaElectron(url, options)
  }

  return requestViaBrowser(url, options)
}

function getRetryDelay(attempt: number, baseDelay: number, maxDelay: number) {
  return Math.min(maxDelay, baseDelay * Math.pow(2, attempt - 1))
}

function getErrorMessageFromBody(bodyText: string) {
  if (!bodyText) {
    return "请求失败"
  }

  try {
    const parsed = JSON.parse(bodyText) as { error?: string; message?: string }
    return parsed.error || parsed.message || bodyText
  } catch {
    return bodyText
  }
}

export class HttpRequestError extends Error {
  status: number
  bodyText?: string
  requestId?: string

  constructor(message: string, status: number, bodyText?: string, requestId?: string) {
    super(message)
    this.name = "HttpRequestError"
    this.status = status
    this.bodyText = bodyText
    this.requestId = requestId
  }
}

export async function fetchWithRetry(url: string, options: HttpRequestOptions = {}): Promise<Response> {
  const {
    retries = 2,
    retryDelayMs = 400,
    maxRetryDelayMs = 3000,
    retryOnStatuses = DEFAULT_RETRY_ON_STATUSES,
    ...requestOptions
  } = options

  const { headers, requestId } = ensureRequestId(options)
  const effectiveOptions: HttpRequestOptions = {
    ...requestOptions,
    headers,
  }

  const attempts = Math.max(1, retries + 1)
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await performRequest(url, effectiveOptions)
      if (response.ok || !retryOnStatuses.includes(response.status) || attempt === attempts) {
        return response
      }

      const bodyText = await response.text()
      lastError = new HttpRequestError(getErrorMessageFromBody(bodyText), response.status, bodyText, requestId)
      logger.warn("Desktop http retrying after retryable status", {
        request_id: requestId,
        code: "HTTP-1001",
        url,
        status: response.status,
        attempt,
        max_attempts: attempts,
      })
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Request failed")
      if (attempt === attempts) {
        logger.error("Desktop http request failed", {
          request_id: requestId,
          code: "HTTP-1002",
          url,
          attempts,
        }, lastError)
        throw lastError
      }
      logger.warn("Desktop http retrying after error", {
        request_id: requestId,
        code: "HTTP-1003",
        url,
        attempt,
        max_attempts: attempts,
      }, lastError)
    }

    await sleep(getRetryDelay(attempt, retryDelayMs, maxRetryDelayMs))
  }

  if (lastError) {
    logger.error("Desktop http request exhausted retries", {
      request_id: requestId,
      code: "HTTP-1004",
      url,
      attempts,
    }, lastError)
  }

  throw lastError || new Error("Request failed")
}

export async function requestJson<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
  const response = await fetchWithRetry(url, options)
  const bodyText = await response.text()
  const requestId = response.headers.get("x-request-id") || options.requestId || undefined

  if (!response.ok) {
    throw new HttpRequestError(getErrorMessageFromBody(bodyText), response.status, bodyText, requestId)
  }

  if (!bodyText) {
    return {} as T
  }

  try {
    return JSON.parse(bodyText) as T
  } catch {
    throw new Error("响应解析失败")
  }
}
