import type https from 'https'
import type http from 'http'
import type fs from 'fs'

// node-forge 类型不完整，用 opaque handle
export type ForgeKey = any
export type ForgeCert = any

export interface AcceleratorState {
  running: boolean
  domains: unknown[]
  activeDomains: string[]
  resolved: Record<string, string>
  resolvedCandidates: Record<string, string[]>
  proxyServer: https.Server | null
  systemProxyServer: http.Server | null
  systemProxyMitmServer: https.Server | null
  proxyShutdownTimer: ReturnType<typeof setTimeout> | null
  keepAliveAgent: https.Agent | null
  hostsWatcher: fs.FSWatcher | null
  hostsWatchTimer: ReturnType<typeof setTimeout> | null
  hostsWatcherRetryTimer: ReturnType<typeof setTimeout> | null
  hostsIgnoreUntil: number
  hostsSelfHealPaused: boolean
  certCache: Record<string, { key: string; cert: string; certChain: string }>
  caFingerprint: string
  caKey: ForgeKey
  caCert: ForgeCert
  proxyMode: 'system' | 'hosts' | null
}

export const acceleratorState: AcceleratorState = {
  running: false,
  domains: [],
  activeDomains: [],
  resolved: {},
  resolvedCandidates: {},
  proxyServer: null,
  systemProxyServer: null,
  systemProxyMitmServer: null,
  proxyShutdownTimer: null,
  keepAliveAgent: null,
  hostsWatcher: null,
  hostsWatchTimer: null,
  hostsWatcherRetryTimer: null,
  hostsIgnoreUntil: 0,
  hostsSelfHealPaused: false,
  certCache: {},
  caFingerprint: '',
  caKey: null,
  caCert: null,
  proxyMode: null,
}

export function resetRuntimeState(options: { preserveResolved?: boolean } = {}) {
  acceleratorState.running = false
  acceleratorState.activeDomains = []
  acceleratorState.hostsSelfHealPaused = false
  acceleratorState.proxyMode = null
  if (!options.preserveResolved) {
    acceleratorState.resolved = {}
    acceleratorState.resolvedCandidates = {}
  }
}
