import net from 'net'
import { SUPPORTED_ACCELERATOR_DOMAINS } from './constants'

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
  return result
}
