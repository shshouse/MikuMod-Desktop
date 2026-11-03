import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { getDesktopPaths } from './paths'

export function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function getRequestIdFromHeaders(headers: Record<string, string> | undefined) {
  if (!headers || typeof headers !== 'object') return undefined
  return headers['x-request-id'] || headers['X-Request-Id'] || undefined
}

export function writeMainLog(message: string) {
  const line = `[${new Date().toISOString()}] ${message}\n`
  try { fs.appendFileSync(path.join(getDesktopPaths().logsDir, 'main.log'), line) } catch {}
  console.log(message)
}

export function writeStructuredLog(level: 'info' | 'warn' | 'error', message: string, context?: Record<string, any>, error?: Error) {
  const entry: Record<string, any> = {
    timestamp: new Date().toISOString(),
    level,
    service: 'mikumod-desktop-main',
    message,
  }
  if (context && Object.keys(context).length > 0) entry.context = context
  if (error) {
    entry.error = {
      name: error.name || 'Error',
      message: error.message || String(error),
      stack: app.isPackaged ? undefined : error.stack,
    }
  }
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
  try { fs.appendFileSync(path.join(getDesktopPaths().logsDir, 'main.log'), line + '\n', 'utf-8') } catch {}
}
