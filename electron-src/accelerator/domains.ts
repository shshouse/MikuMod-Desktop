import net from 'net'
import { app } from 'electron'
import {
  SUPPORTED_ACCELERATOR_DOMAINS,
  WORKER_RELAY_DOMAINS,
  GITHUB_WEB_DEPENDENCY_DOMAINS,
} from './constants'
import { loadEnvFiles } from '../env-loader'

export function isValidDomainName(domain: unknown): domain is string {
  if (typeof domain !== 'string') return false
  const value = domain.trim().toLowerCase()
  if (!value || value.length > 253 || value.includes('/') || value.includes('\\') || /\s/.test(value)) return false
  const labels = value.split('.')
  if (labels.length < 2) return false
  return labels.every(label =>
    label.length > 0
    && label.length <= 63
    && /^[a-z0-9-]+$/.test(label)
    && !label.startsWith('-')
    && !label.endsWith('-')
  )
}

export function normalizeDomain(value: unknown): string | null {
  const domain = String(value || '').trim().toLowerCase()
  return isValidDomainName(domain) ? domain : null
}

export function isSupportedAcceleratorDomain(domain: string) {
  return SUPPORTED_ACCELERATOR_DOMAINS.has(domain)
}

export function normalizeIP(value: unknown): string | null {
  const ip = String(value || '').trim()
  return net.isIP(ip) ? ip : null
}

export interface EnabledDomainInput {
  match_domain: string
  forward_ip?: string | null
  [key: string]: unknown
}

export interface NormalizedDomain {
  match_domain: string
  forward_ip: string | null
  [key: string]: unknown
}

export function normalizeEnabledDomains(domains: unknown): NormalizedDomain[] {
  if (!Array.isArray(domains)) return []
  const seen = new Set<string>()
  const result: NormalizedDomain[] = []
  for (const item of domains) {
    if (!item || typeof item !== 'object') continue
    const domain = normalizeDomain((item as EnabledDomainInput).match_domain)
    if (!domain || !isSupportedAcceleratorDomain(domain) || seen.has(domain)) continue
    result.push({ ...item, match_domain: domain, forward_ip: normalizeIP((item as EnabledDomainInput).forward_ip) })
    seen.add(domain)
  }
  if (seen.has('github.com')) {
    for (const domain of GITHUB_WEB_DEPENDENCY_DOMAINS) {
      if (!seen.has(domain) && isSupportedAcceleratorDomain(domain)) {
        result.push({ match_domain: domain, forward_ip: null })
        seen.add(domain)
      }
    }
  }
  return result
}

export function needsWorkerRelay(domain: string) {
  if (WORKER_RELAY_DOMAINS.has(domain)) return true
  for (const d of WORKER_RELAY_DOMAINS) {
    if (domain.endsWith('.' + d)) return true
  }
  return false
}

export function getWorkerRelayConfig() {
  loadEnvFiles({ app, keys: ['WORKER_RELAY_URL', 'WORKER_RELAY_SECRET'], override: true })
  return {
    url: process.env.WORKER_RELAY_URL?.trim() || '',
    secret: process.env.WORKER_RELAY_SECRET?.trim() || '',
  }
}
