import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import {
  SYSTEM_COMMAND_TIMEOUT_MS,
  GIT_COMMAND_TIMEOUT_MS,
  CACHE_FILE,
} from './constants'

export function runProcess(file: string, args: string[], timeoutMs = SYSTEM_COMMAND_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      windowsHide: true,
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        if (stderr && stderr.trim()) error.message = stderr.trim()
        reject(error)
        return
      }
      resolve(stdout || '')
    })
  })
}

export function runPowerShell(script: string) {
  return runProcess('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script])
}

export function escapePowerShellSingleQuotedString(value: string) {
  return String(value || '').replace(/'/g, "''")
}

export async function readGitConfig(args: string[]) {
  try {
    return (await runProcess('git', ['config', ...args], GIT_COMMAND_TIMEOUT_MS)).trim()
  } catch {
    return ''
  }
}

export async function writeGitConfig(args: string[]) {
  await runProcess('git', ['config', ...args], GIT_COMMAND_TIMEOUT_MS)
}

export async function isGitAvailable() {
  try {
    await runProcess('git', ['--version'], GIT_COMMAND_TIMEOUT_MS)
    return true
  } catch {
    return false
  }
}

export function normalizeHex(value: string) {
  return String(value || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase()
}

export function joinMessages(...messages: (string | undefined | null | false)[]) {
  return messages.filter(Boolean).join('\uff1b')
}

// --- userData 快照 ---

export function getUserDataFilePath(fileName: string) {
  return path.join(app.getPath('userData'), fileName)
}

export function readJsonSnapshot(fileName: string) {
  try { return JSON.parse(fs.readFileSync(getUserDataFilePath(fileName), 'utf-8')) } catch { return null }
}

export function writeJsonSnapshot(fileName: string, data: unknown) {
  fs.writeFileSync(getUserDataFilePath(fileName), JSON.stringify(data, null, 2), 'utf-8')
}

export function removeJsonSnapshot(fileName: string) {
  try { fs.unlinkSync(getUserDataFilePath(fileName)) } catch {}
}

// --- 域名缓存 ---

function getCachePath() {
  return path.join(app.getPath('userData'), CACHE_FILE)
}

export function loadCache() {
  try { return JSON.parse(fs.readFileSync(getCachePath(), 'utf-8')) } catch { return null }
}

export function saveCache(domains: unknown) {
  try { fs.writeFileSync(getCachePath(), JSON.stringify(domains, null, 2), 'utf-8') } catch {}
}
