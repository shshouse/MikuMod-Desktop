import net from 'net'
import dns from 'dns'
import {
  DOH_URLS,
  DOH_PROVIDER_TIMEOUT_MS,
  DOH_EARLY_RETURN_GRACE_MS,
  DOH_TOTAL_TIMEOUT_MS,
} from './constants'

const dnsPromises = dns.promises

function pushUniqueIPs(target: string[], seen: Set<string>, values: string[] | undefined) {
  for (const ip of values || []) {
    if (!net.isIP(ip) || seen.has(ip)) continue
    seen.add(ip)
    target.push(ip)
  }
}

export async function resolveCandidatesViaDoh(domain: string): Promise<string[]> {
  return await new Promise((resolve) => {
    const candidates: string[] = []
    const seen = new Set<string>()
    const lookups = [
      ...DOH_URLS.map(async (dohUrl) => {
        try {
          const url = `${dohUrl}?name=${domain}&type=A`
          const headers: Record<string, string> = dohUrl.includes('1.1.1.1') ? { 'Accept': 'application/dns-json' } : {}
          const response = await fetch(url, { headers, signal: AbortSignal.timeout(DOH_PROVIDER_TIMEOUT_MS) })
          const data = await response.json() as { Answer?: { type: number; data: string }[] }
          return (data.Answer || [])
            .filter(a => a.type === 1 && net.isIP(a.data))
            .map(a => a.data)
        } catch {
          return []
        }
      }),
      dnsPromises.resolve4(domain).catch(() => []),
    ]
    let pending = lookups.length
    let finished = false
    let earlyTimer: ReturnType<typeof setTimeout> | null = null
    const finish = () => {
      if (finished) return
      finished = true
      if (earlyTimer) clearTimeout(earlyTimer)
      clearTimeout(totalTimer)
      resolve([...candidates])
    }
    const onResult = (ips: string[]) => {
      if (finished) return
      pushUniqueIPs(candidates, seen, ips)
      pending -= 1
      if (candidates.length > 0 && !earlyTimer) {
        earlyTimer = setTimeout(finish, DOH_EARLY_RETURN_GRACE_MS)
      }
      if (pending <= 0) finish()
    }
    const totalTimer = setTimeout(finish, DOH_TOTAL_TIMEOUT_MS)
    for (const lookup of lookups) {
      Promise.resolve(lookup).then(onResult, () => onResult([]))
    }
  })
}

export function tcpPing(host: string, port = 443, timeout = 2000): Promise<number | null> {
  return new Promise((resolve) => {
    const start = Date.now()
    const socket = new net.Socket()
    socket.setTimeout(timeout)
    socket.on('connect', () => { resolve(Date.now() - start); socket.destroy() })
    socket.on('timeout', () => { socket.destroy(); resolve(null) })
    socket.on('error', () => { socket.destroy(); resolve(null) })
    socket.connect(port, host)
  })
}
