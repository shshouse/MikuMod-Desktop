/**
 * Desktop 渲染进程结构化日志器
 *
 * - 开发环境：彩色可读输出
 * - 生产环境：单行 JSON，console 输出，由 Electron 主进程转发到日志文件
 * - 支持 request_id / user_id 等结构化字段，与 Web 端日志格式对齐
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
    request_id?: string
    user_id?: string
    [key: string]: unknown
}

interface LogEntry {
    timestamp: string
    level: LogLevel
    service: string
    message: string
    context?: LogContext
    error?: {
        name: string
        message: string
        stack?: string
    }
}

const SERVICE_NAME = 'mikumod-desktop'

const IS_PROD = import.meta.env.PROD

const CONFIGURED_LEVEL: LogLevel = (
    (import.meta.env.VITE_LOG_LEVEL as LogLevel | undefined) ||
    (IS_PROD ? 'info' : 'debug')
)

const LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
}

function shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[CONFIGURED_LEVEL]
}

function serializeError(err: unknown): LogEntry['error'] {
    if (err instanceof Error) {
        return {
            name: err.name,
            message: err.message,
            stack: IS_PROD ? undefined : err.stack,
        }
    }
    return {
        name: 'UnknownError',
        message: typeof err === 'string' ? err : JSON.stringify(err),
    }
}

function writeEntry(entry: LogEntry) {
    if (IS_PROD) {
        const line = JSON.stringify(entry)
        if (entry.level === 'error') {
            console.error(line)
        } else if (entry.level === 'warn') {
            console.warn(line)
        } else {
            console.log(line)
        }
        return
    }

    const colors = {
        debug: '\x1b[90m',
        info: '\x1b[36m',
        warn: '\x1b[33m',
        error: '\x1b[31m',
    }
    const reset = '\x1b[0m'
    const rid = entry.context?.request_id
        ? ` [${String(entry.context.request_id).slice(0, 8)}]`
        : ''
    const prefix = `${colors[entry.level]}[${entry.level.toUpperCase()}]${reset} ${entry.service}${rid}`

    const rest: unknown[] = []
    if (entry.context && Object.keys(entry.context).length > 0) rest.push(entry.context)
    if (entry.error) rest.push(entry.error)

    console.log(`${prefix} ${entry.message}`, ...rest)
}

function doLog(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: unknown
) {
    if (!shouldLog(level)) return
    const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        service: SERVICE_NAME,
        message,
    }
    if (context && Object.keys(context).length > 0) {
        entry.context = context
    }
    if (error !== undefined) {
        entry.error = serializeError(error)
    }
    writeEntry(entry)
}

export const logger = {
    debug: (message: string, context?: LogContext) => doLog('debug', message, context),
    info: (message: string, context?: LogContext) => doLog('info', message, context),
    warn: (message: string, context?: LogContext, error?: unknown) =>
        doLog('warn', message, context, error),
    error: (message: string, context?: LogContext, error?: unknown) =>
        doLog('error', message, context, error),
}

/**
 * 生成一个新的 request_id（UUID v4），用于发起一次跨进程/跨服务请求前。
 * 会在请求头中通过 `X-Request-Id` 传递给 Web API，从而形成端到端可追溯链路。
 */
export function newRequestId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    // 退化：非常旧的运行时才走这里
    return `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
