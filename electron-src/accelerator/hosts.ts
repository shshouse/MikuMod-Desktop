import fs from 'fs'
import path from 'path'
import {
  HOSTS_PATH,
  HOSTS_TAG_START,
  HOSTS_TAG_END,
  LEGACY_ACCELERATOR_HOSTS_DOMAINS,
  HOSTS_SELF_HEAL_DEBOUNCE_MS,
  HOSTS_SELF_HEAL_IGNORE_MS,
  HOSTS_WATCHER_RETRY_MS,
  DNS_FLUSH_TIMEOUT_MS,
} from './constants'
import { acceleratorState } from './state'
import { normalizeDomain } from './domains'
import { runProcess } from './utils'

// --- 读写 ---

export function readHostsFile() {
  try { return fs.readFileSync(HOSTS_PATH, 'utf-8') } catch { return '' }
}

function isLegacyAcceleratorHostsLine(line: string) {
  const trimmed = String(line || '').trim().toLowerCase()
  if (!trimmed || trimmed.startsWith('#')) return false
  const [ip, domain] = trimmed.split(/\s+/)
  return (ip === '127.0.0.1' || ip === '::1') && LEGACY_ACCELERATOR_HOSTS_DOMAINS.has(domain)
}

export function containsMikuModEntries(content: string) {
  return content.includes(HOSTS_TAG_START) || content.split(/\r?\n/).some(isLegacyAcceleratorHostsLine)
}

function buildHostsEntries(domains: string[]) {
  const lines = [HOSTS_TAG_START]
  for (const domain of domains) lines.push(`127.0.0.1 ${domain}`)
  lines.push(HOSTS_TAG_END)
  return lines.join('\n')
}

function removeExistingEntries(content: string) {
  const result: string[] = []
  let inBlock = false
  for (const line of content.split(/\r?\n/)) {
    if (line.includes(HOSTS_TAG_START)) { inBlock = true; continue }
    if (line.includes(HOSTS_TAG_END)) { inBlock = false; continue }
    if (inBlock || isLegacyAcceleratorHostsLine(line)) continue
    result.push(line)
  }
  return result.join('\n')
}

function writeHosts(newContent: string) {
  acceleratorState.hostsIgnoreUntil = Date.now() + HOSTS_SELF_HEAL_IGNORE_MS
  fs.writeFileSync(HOSTS_PATH, newContent, 'utf-8')
  runProcess('ipconfig', ['/flushdns'], DNS_FLUSH_TIMEOUT_MS).catch(() => {})
}

// --- 公共 API ---

export function applyHostsProxy(domainList: string[]) {
  const cleanDomains = domainList.map(normalizeDomain).filter(Boolean) as string[]
  if (cleanDomains.length === 0) return { success: false, error: '\u6ca1\u6709\u53ef\u7528\u7684\u52a0\u901f\u57df\u540d' }
  const currentContent = readHostsFile()
  const cleanContent = removeExistingEntries(currentContent)
  const newEntries = buildHostsEntries(cleanDomains)
  const newContent = cleanContent.trimEnd() + '\n\n' + newEntries + '\n'
  try { writeHosts(newContent); return { success: true } }
  catch (e: any) { return { success: false, error: e.message } }
}

export function removeHosts() {
  const currentContent = readHostsFile()
  if (!containsMikuModEntries(currentContent)) return { success: true }
  const cleanContent = removeExistingEntries(currentContent)
  try { writeHosts(cleanContent.trimEnd() + '\n'); return { success: true } }
  catch (e: any) { return { success: false, error: e.message } }
}

function hasExpectedHostsEntries(content: string, domainList: string[]) {
  const cleanDomains = domainList.map(normalizeDomain).filter(Boolean) as string[]
  if (cleanDomains.length === 0) return false
  return String(content || '').includes(buildHostsEntries(cleanDomains))
}

// --- 自修复 watcher ---

function clearHostsWatchTimer() {
  if (acceleratorState.hostsWatchTimer) {
    clearTimeout(acceleratorState.hostsWatchTimer)
    acceleratorState.hostsWatchTimer = null
  }
}

function clearHostsWatcherRetryTimer() {
  if (acceleratorState.hostsWatcherRetryTimer) {
    clearTimeout(acceleratorState.hostsWatcherRetryTimer)
    acceleratorState.hostsWatcherRetryTimer = null
  }
}

function scheduleHostsWatcherRestart() {
  clearHostsWatcherRetryTimer()
  if (!acceleratorState.running) return
  acceleratorState.hostsWatcherRetryTimer = setTimeout(() => {
    acceleratorState.hostsWatcherRetryTimer = null
    if (acceleratorState.running && !acceleratorState.hostsWatcher) {
      startHostsSelfHealWatcher()
    }
  }, HOSTS_WATCHER_RETRY_MS)
}

function scheduleHostsSelfHealCheck(delayMs = HOSTS_SELF_HEAL_DEBOUNCE_MS) {
  if (!acceleratorState.running || acceleratorState.hostsSelfHealPaused || !acceleratorState.hostsWatcher) return
  clearHostsWatchTimer()
  acceleratorState.hostsWatchTimer = setTimeout(() => {
    acceleratorState.hostsWatchTimer = null
    healHostsIfNeeded()
  }, delayMs)
}

function healHostsIfNeeded() {
  if (!acceleratorState.running || acceleratorState.hostsSelfHealPaused) return
  if (acceleratorState.activeDomains.length === 0) return

  const remainingIgnoreMs = acceleratorState.hostsIgnoreUntil - Date.now()
  if (remainingIgnoreMs > 0) {
    scheduleHostsSelfHealCheck(Math.max(remainingIgnoreMs, HOSTS_SELF_HEAL_DEBOUNCE_MS))
    return
  }

  const content = readHostsFile()
  if (hasExpectedHostsEntries(content, acceleratorState.activeDomains)) return

  const result = applyHostsProxy(acceleratorState.activeDomains)
  if (!result.success) {
    console.error(`[Accelerator] Hosts self-heal failed: ${result.error}`)
    return
  }
  console.log('[Accelerator] Hosts entries were restored after external changes')
}

function startHostsSelfHealWatcher() {
  clearHostsWatcherRetryTimer()
  if (acceleratorState.hostsWatcher) return

  const hostsDir = path.dirname(HOSTS_PATH)
  const hostsFileName = path.basename(HOSTS_PATH).toLowerCase()

  try {
    const watcher = fs.watch(hostsDir, { persistent: false }, (_eventType, filename) => {
      if (filename && String(filename).toLowerCase() !== hostsFileName) return
      scheduleHostsSelfHealCheck()
    })

    watcher.on('error', (err) => {
      console.error(`[Accelerator] Hosts watcher error: ${err.message}`)
      clearHostsWatchTimer()
      if (acceleratorState.hostsWatcher) {
        try { acceleratorState.hostsWatcher.close() } catch {}
        acceleratorState.hostsWatcher = null
      }
      scheduleHostsWatcherRestart()
    })

    acceleratorState.hostsWatcher = watcher
  } catch (err: any) {
    console.error(`[Accelerator] Failed to start hosts watcher: ${err.message}`)
    scheduleHostsWatcherRestart()
  }
}

export function startHostsSelfHeal(domainList: string[]) {
  acceleratorState.activeDomains = domainList.map(normalizeDomain).filter(Boolean) as string[]
  acceleratorState.hostsSelfHealPaused = false
  startHostsSelfHealWatcher()
}

export function stopHostsSelfHeal() {
  clearHostsWatchTimer()
  clearHostsWatcherRetryTimer()
  if (acceleratorState.hostsWatcher) {
    try { acceleratorState.hostsWatcher.close() } catch {}
    acceleratorState.hostsWatcher = null
  }
  acceleratorState.hostsIgnoreUntil = 0
  acceleratorState.hostsSelfHealPaused = false
  acceleratorState.activeDomains = []
}
