import path from 'path'
import fs from 'fs'
import { ipcMain } from 'electron'
import { acceleratorState, resetRuntimeState } from './state'
import { normalizeDomain, normalizeEnabledDomains } from './domains'
import { resolveCandidatesViaDoh, tcpPing } from './dns'
import {
  loadOrCreateCA,
  getCertFingerprint,
  certToDerBuffer,
  ensureCertDir,
  installCATrust,
  uninstallCATrust,
  warmupDomainCertificatesAsync,
} from './cert'
import {
  readHostsFile,
  containsMikuModEntries,
  applyHostsProxy,
  removeHosts,
  startHostsSelfHeal,
  stopHostsSelfHeal,
} from './hosts'
import {
  getSystemProxyPacUrl,
  applySystemProxyPac,
  restoreSystemProxySettings,
  hasSystemProxyResidual,
  joinMessages,
} from './system-proxy'
import {
  clearProxyShutdownTimer,
  stopProxyServer,
  stopSystemProxyServers,
  scheduleProxyWarmShutdown,
  ensureProxyServerReady,
  ensureSystemProxyServersReady,
} from './proxy'
import { loadCache, saveCache } from './utils'

export function registerAcceleratorIPC() {
  ipcMain.handle('accelerator-status', () => ({
    running: acceleratorState.running,
    resolved: acceleratorState.resolved,
    activeDomains: acceleratorState.activeDomains,
    mode: acceleratorState.proxyMode,
    pacUrl: acceleratorState.proxyMode === 'system' ? getSystemProxyPacUrl() : null,
  }))

  ipcMain.handle('accelerator-set-domains', (_e, domains) => {
    acceleratorState.domains = domains
    saveCache(domains)
    return { success: true }
  })

  ipcMain.handle('accelerator-get-domains', () => {
    if (acceleratorState.domains.length > 0) return acceleratorState.domains
    const cached = loadCache()
    if (cached) { acceleratorState.domains = cached; return cached }
    return []
  })

  ipcMain.handle('accelerator-resolve', async (_e, domain) => {
    const safeDomain = normalizeDomain(domain)
    if (!safeDomain) return null
    const candidates = await resolveCandidatesViaDoh(safeDomain)
    const ip = candidates[0] || null
    if (ip) {
      acceleratorState.resolved[safeDomain] = ip
      acceleratorState.resolvedCandidates[safeDomain] = candidates
    }
    return ip
  })

  ipcMain.handle('accelerator-resolve-all', async (_e, domains) => {
    const safeDomains = normalizeEnabledDomains(domains)
    const results: Record<string, string> = {}
    const candidateResults: Record<string, string[]> = {}
    await Promise.all(safeDomains.map(async (d) => {
      if (d.forward_ip) {
        results[d.match_domain] = d.forward_ip
        candidateResults[d.match_domain] = [d.forward_ip]
        return
      }
      const cachedCandidates = acceleratorState.resolvedCandidates[d.match_domain]
        || (acceleratorState.resolved[d.match_domain] ? [acceleratorState.resolved[d.match_domain]] : [])
      if (cachedCandidates.length > 0) {
        results[d.match_domain] = cachedCandidates[0]
        candidateResults[d.match_domain] = cachedCandidates
        return
      }
      const candidates = await resolveCandidatesViaDoh(d.match_domain)
      if (candidates.length > 0) {
        results[d.match_domain] = candidates[0]
        candidateResults[d.match_domain] = candidates
      }
    }))
    safeDomains.forEach(d => {
      if (d.forward_ip) {
        results[d.match_domain] = d.forward_ip
        candidateResults[d.match_domain] = [d.forward_ip]
      }
    })
    acceleratorState.resolved = results
    acceleratorState.resolvedCandidates = candidateResults
    return results
  })

  ipcMain.handle('accelerator-start', async (_e, enabledDomains) => {
    if (acceleratorState.running) return { success: false, error: '\u52a0\u901f\u5df2\u5728\u8fd0\u884c' }

    const safeDomains = normalizeEnabledDomains(enabledDomains)
    if (safeDomains.length === 0) return { success: false, error: '\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u4e2a\u6709\u6548\u57df\u540d' }

    try {
      stopHostsSelfHeal()
      const preCleanResult = removeHosts()
      if (!preCleanResult.success) return { success: false, error: `\u6e05\u7406\u6b8b\u7559 hosts \u5931\u8d25\uff1a${preCleanResult.error}` }

      const ca = loadOrCreateCA()
      const fingerprint = getCertFingerprint(ca.forgeCert)
      acceleratorState.caKey = ca.forgeKey
      acceleratorState.caCert = ca.forgeCert
      if (acceleratorState.caFingerprint !== fingerprint) {
        acceleratorState.certCache = {}
        acceleratorState.caFingerprint = fingerprint
      }

      const certDir = ensureCertDir()
      const derPath = path.join(certDir, 'mikumod_ca.cer')
      fs.writeFileSync(derPath, certToDerBuffer(ca.forgeCert))

      if (!await installCATrust(derPath, fingerprint)) {
        await uninstallCATrust()
        return { success: false, error: 'CA \u8bc1\u4e66\u672a\u88ab\u7cfb\u7edf\u4fe1\u4efb\uff0c\u8bf7\u4ee5\u7ba1\u7406\u5458\u6743\u9650\u542f\u52a8\u5e76\u5141\u8bb8\u5b89\u88c5\u6839\u8bc1\u4e66' }
      }

      const toResolve = safeDomains.filter(d => !d.forward_ip)
      const results: Record<string, string> = {}
      const candidateResults: Record<string, string[]> = {}
      await Promise.all(toResolve.map(async (d) => {
        if (d.forward_ip) {
          results[d.match_domain] = d.forward_ip
          candidateResults[d.match_domain] = [d.forward_ip]
          return
        }
        const cachedCandidates = acceleratorState.resolvedCandidates[d.match_domain]
          || (acceleratorState.resolved[d.match_domain] ? [acceleratorState.resolved[d.match_domain]] : [])
        if (cachedCandidates.length > 0) {
          results[d.match_domain] = cachedCandidates[0]
          candidateResults[d.match_domain] = cachedCandidates
          return
        }
        const candidates = await resolveCandidatesViaDoh(d.match_domain)
        if (candidates.length > 0) {
          results[d.match_domain] = candidates[0]
          candidateResults[d.match_domain] = candidates
        }
      }))
      safeDomains.forEach(d => {
        if (d.forward_ip) {
          results[d.match_domain] = d.forward_ip
          candidateResults[d.match_domain] = [d.forward_ip]
        }
      })

      const domainList = safeDomains
        .filter(d => results[d.match_domain])
        .map(d => d.match_domain)

      if (domainList.length === 0) {
        await uninstallCATrust()
        return { success: false, error: '\u6240\u9009\u57df\u540d\u89e3\u6790\u5931\u8d25\uff0c\u672a\u4fee\u6539\u7cfb\u7edf hosts' }
      }

      acceleratorState.resolved = results
      acceleratorState.resolvedCandidates = candidateResults
      acceleratorState.activeDomains = domainList

      let proxyMode: 'system' | 'hosts' = 'system'
      let proxyWarning = ''
      try {
        await ensureSystemProxyServersReady(ca.forgeCert)
        await applySystemProxyPac()
      } catch (err: any) {
        await restoreSystemProxySettings().catch(() => {})
        await stopSystemProxyServers()
        proxyMode = 'hosts'
        proxyWarning = `\u7cfb\u7edf PAC \u4ee3\u7406\u542f\u52a8\u5931\u8d25\uff0c\u5df2\u56de\u9000 hosts \u6a21\u5f0f\uff1a${err.message}`
        await ensureProxyServerReady(ca.forgeCert)
        const hostsResult = applyHostsProxy(domainList)
        if (!hostsResult.success) {
          await stopProxyServer()
          resetRuntimeState()
          await uninstallCATrust()
          return hostsResult
        }
      }

      acceleratorState.running = true
      acceleratorState.proxyMode = proxyMode
      if (proxyMode === 'hosts') startHostsSelfHeal(domainList)
      warmupDomainCertificatesAsync(domainList)

      const hostsMap: Record<string, string> = {}
      domainList.forEach(d => { hostsMap[d] = acceleratorState.resolved[d] })
      return {
        success: true,
        hostsMap,
        mode: proxyMode,
        pacUrl: proxyMode === 'system' ? getSystemProxyPacUrl() : undefined,
        warning: proxyWarning || undefined,
      }
    } catch (e: any) {
      removeHosts()
      await restoreSystemProxySettings().catch(() => {})
      await stopSystemProxyServers()
      await stopProxyServer()
      resetRuntimeState()
      await uninstallCATrust()
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('accelerator-stop', async () => {
    acceleratorState.hostsSelfHealPaused = true
    const systemRestore = await restoreSystemProxySettings().catch((e: any) => ({ changed: false, warning: `\u7cfb\u7edf\u4ee3\u7406\u6062\u590d\u5931\u8d25\uff1a${e.message}` }))
    const result = removeHosts()
    if (!result.success) {
      acceleratorState.hostsSelfHealPaused = false
      return result
    }
    stopHostsSelfHeal()
    await stopSystemProxyServers()
    resetRuntimeState({ preserveResolved: true })
    scheduleProxyWarmShutdown()
    return { ...result, warning: (systemRestore as { warning?: string }).warning || undefined }
  })

  ipcMain.handle('accelerator-repair', async () => {
    acceleratorState.hostsSelfHealPaused = true
    const systemRestore = await restoreSystemProxySettings().catch((e: any) => ({ changed: false, warning: `\u7cfb\u7edf\u4ee3\u7406\u6062\u590d\u5931\u8d25\uff1a${e.message}` }))
    const result = removeHosts()
    if (!result.success) {
      acceleratorState.hostsSelfHealPaused = false
      return result
    }
    stopHostsSelfHeal()
    await stopSystemProxyServers()
    await stopProxyServer()
    resetRuntimeState()
    await uninstallCATrust()
    return { ...result, warning: (systemRestore as { warning?: string }).warning || undefined }
  })

  ipcMain.handle('accelerator-check-hosts', async () => containsMikuModEntries(readHostsFile()) || await hasSystemProxyResidual())

  ipcMain.handle('accelerator-ping', async (_e, ip) => await tcpPing(ip))

  ipcMain.handle('accelerator-ping-both', async (_e, domain, ip) => {
    const before = await tcpPing(domain, 443, 2000)
    const after = await tcpPing(ip, 443, 2000)
    return { before, after }
  })
}

export async function cleanupOnExit() {
  stopHostsSelfHeal()
  clearProxyShutdownTimer()
  acceleratorState.running = false
  try { removeHosts() } catch {}
  await restoreSystemProxySettings().catch(() => {})
  await stopSystemProxyServers()
  await stopProxyServer()
  resetRuntimeState()
}
