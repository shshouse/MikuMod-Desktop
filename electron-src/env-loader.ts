import fs from 'fs'
import path from 'path'
import type { App } from 'electron'

function parseEnvValue(value: unknown): string {
  const trimmed = String(value || '').trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function readEnvFile(filePath: string): Record<string, string> {
  const values: Record<string, string> = {}
  try {
    if (!filePath || !fs.existsSync(filePath)) return values
    const content = fs.readFileSync(filePath, 'utf-8')
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match) continue
      values[match[1]] = parseEnvValue(match[2])
    }
  } catch { return values }
  return values
}

function addCandidate(candidates: string[], filePath: string | undefined) {
  if (!filePath) return
  const normalized = path.normalize(filePath)
  if (!candidates.includes(normalized)) candidates.push(normalized)
}

export function getEnvFileCandidates(app?: App): string[] {
  const candidates: string[] = []
  addCandidate(candidates, path.resolve(process.cwd(), '.env'))
  addCandidate(candidates, path.resolve(__dirname, '..', '.env'))
  addCandidate(candidates, path.join(path.dirname(process.execPath), '.env'))
  if (process.resourcesPath) {
    addCandidate(candidates, path.join(process.resourcesPath, '.env'))
    addCandidate(candidates, path.join(path.dirname(process.resourcesPath), '.env'))
  }
  try {
    if (app?.getPath) addCandidate(candidates, path.join(app.getPath('userData'), '.env'))
  } catch { void 0 }
  addCandidate(candidates, process.env.MIKUMOD_ENV_PATH)
  return candidates
}

interface LoadEnvOptions {
  app?: App
  keys?: string[]
  override?: boolean
}

export function loadEnvFiles(options: LoadEnvOptions = {}): Record<string, string> {
  const keys = Array.isArray(options.keys) ? new Set(options.keys) : null
  const override = options.override === true
  const loaded: Record<string, string> = {}
  for (const candidate of getEnvFileCandidates(options.app)) {
    const values = readEnvFile(candidate)
    for (const [key, value] of Object.entries(values)) {
      if (keys && !keys.has(key)) continue
      if (override || !process.env[key]) process.env[key] = value
      loaded[key] = process.env[key] || value
    }
  }
  return loaded
}
