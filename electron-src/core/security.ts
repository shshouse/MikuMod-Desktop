import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { getDesktopPaths } from './paths'

const ALLOWED_EXTERNAL_DOMAINS = new Set([
  'mikumod.com', 'www.mikumod.com',
  'github.com',
])

const ALLOWED_HTTP_DOMAINS = new Set([
  'mikumod.com', 'www.mikumod.com',
])

function matchesDomainSet(url: string, domainSet: Set<string>, extraCheck?: (host: string) => boolean) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    const host = parsed.hostname.toLowerCase()
    if (extraCheck?.(host)) return true
    for (const domain of domainSet) {
      if (host === domain || host.endsWith('.' + domain)) return true
    }
    return false
  } catch { return false }
}

export function isAllowedExternalUrl(url: string) {
  return matchesDomainSet(url, ALLOWED_EXTERNAL_DOMAINS)
}

export function isAllowedHttpDomain(url: string) {
  return matchesDomainSet(url, ALLOWED_HTTP_DOMAINS, (host) =>
    host.endsWith('.supabase.co') || host.endsWith('.supabase.in')
  )
}
const authorizedBaseDirs = new Set<string>()

function getAuthorizedBaseDirsPath() {
  return path.join(getDesktopPaths().dataDir, 'authorized-base-dirs.json')
}

export function normalizeBaseDir(dirPath: string) {
  if (typeof dirPath !== 'string' || !dirPath.trim()) return null
  const normalized = path.normalize(path.resolve(dirPath))
  if (normalized === path.parse(normalized).root) return null
  return normalized
}

export function loadAuthorizedBaseDirs() {
  try {
    const content = fs.readFileSync(getAuthorizedBaseDirsPath(), 'utf-8')
    const entries = JSON.parse(content)
    if (!Array.isArray(entries)) return
    for (const entry of entries) {
      const normalized = normalizeBaseDir(entry)
      if (normalized) authorizedBaseDirs.add(normalized)
    }
  } catch {}
}

function saveAuthorizedBaseDirs() {
  try { fs.writeFileSync(getAuthorizedBaseDirsPath(), JSON.stringify([...authorizedBaseDirs].sort(), null, 2), 'utf-8') } catch {}
}

export function authorizeBaseDir(dirPath: string) {
  const normalized = normalizeBaseDir(dirPath)
  if (!normalized) return null
  authorizedBaseDirs.add(normalized)
  saveAuthorizedBaseDirs()
  return normalized
}

function getSafeBaseDirs() {
  const paths = getDesktopPaths()
  return [
    path.normalize(paths.appDir),
    path.normalize(paths.dataDir),
    path.normalize(paths.modsDir),
    path.normalize(paths.backupsDir),
    path.normalize(app.getPath('userData')),
    path.normalize(app.getPath('downloads')),
    path.normalize(app.getPath('temp')),
    ...authorizedBaseDirs,
  ]
}

export function isPathAllowed(targetPath: string | undefined) {
  if (typeof targetPath !== 'string' || !targetPath.trim()) return false
  const normalized = path.normalize(path.resolve(targetPath))
  const baseDirs = getSafeBaseDirs()
  return baseDirs.some(base => normalized.startsWith(base + path.sep) || normalized === base)
}
