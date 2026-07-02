import https from 'https'
import net from 'net'
import type http from 'http'
import { UPSTREAM_TIMEOUT_MS } from './constants'
import { acceleratorState } from './state'
import { normalizeDomain } from './domains'
import { resolveCandidatesViaDoh } from './dns'

export function isAcceleratedDomain(domain: string) {
  const safeDomain = normalizeDomain(domain)
  if (!safeDomain) return false
  const domains = acceleratorState.activeDomains.length > 0
    ? acceleratorState.activeDomains
    : Object.keys(acceleratorState.resolved)
  return domains.some(item => safeDomain === item || safeDomain.endsWith(`.${item}`))
}

export async function resolveAcceleratedDomainIP(domain: string) {
  const safeDomain = normalizeDomain(domain)
  if (!safeDomain || !isAcceleratedDomain(safeDomain)) return null
  if (acceleratorState.resolved[safeDomain]) return acceleratorState.resolved[safeDomain]
  const candidates = await resolveCandidatesViaDoh(safeDomain)
  if (candidates.length === 0) return null
  acceleratorState.resolved[safeDomain] = candidates[0]
  acceleratorState.resolvedCandidates[safeDomain] = candidates
  return candidates[0]
}

function getResolvedCandidates(domain: string, primaryIP: string) {
  const candidates: string[] = []
  const seen = new Set<string>()
  const add = (ip: string) => {
    if (!net.isIP(ip) || seen.has(ip)) return
    seen.add(ip)
    candidates.push(ip)
  }
  add(primaryIP)
  for (const ip of acceleratorState.resolvedCandidates[domain] || []) add(ip)
  return candidates
}

function isRetryableRequestMethod(method: string | undefined) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase())
}

function createUpstreamOptions(clientReq: http.IncomingMessage, domain: string, ip: string, servername: string) {
  const headers = { ...clientReq.headers }
  headers.host = domain
  delete headers['accept-encoding']
  return {
    hostname: ip,
    port: 443,
    path: clientReq.url,
    method: clientReq.method,
    headers,
    servername,
    rejectUnauthorized: true,
    timeout: UPSTREAM_TIMEOUT_MS,
    agent: acceleratorState.keepAliveAgent || undefined,
  }
}

function retryWithSNI(clientReq: http.IncomingMessage, clientRes: http.ServerResponse, domain: string, realIP: string, lastError: Error | null) {
  if (clientRes.headersSent) return
  if (!isRetryableRequestMethod(clientReq.method)) {
    clientRes.writeHead(502)
    clientRes.end(`Bad Gateway: ${lastError?.message || 'upstream connection failed'}`)
    return
  }

  const candidates = getResolvedCandidates(domain, realIP)
  const attempts: { ip: string; servername: string }[] = []
  candidates.forEach((ip) => {
    if (ip !== realIP) attempts.push({ ip, servername: '' })
    attempts.push({ ip, servername: domain })
  })

  const tryAttempt = (index: number, previousError: Error | null) => {
    if (clientRes.headersSent) return
    const attempt = attempts[index]
    if (!attempt) {
      clientRes.writeHead(502)
      clientRes.end(`Bad Gateway: ${previousError?.message || 'all upstream candidates failed'}`)
      return
    }

    const options = createUpstreamOptions(clientReq, domain, attempt.ip, attempt.servername)
    const proxyReq = https.request(options, (proxyRes) => {
      acceleratorState.resolved[domain] = attempt.ip
      clientRes.writeHead(proxyRes.statusCode!, proxyRes.headers)
      proxyRes.pipe(clientRes)
    })

    let failed = false
    const fail = (err: Error) => {
      if (failed) return
      failed = true
      console.error(`[Accelerator] Upstream retry failed for ${domain} via ${attempt.ip}${attempt.servername ? ' with SNI' : ' without SNI'}: ${err.message}`)
      tryAttempt(index + 1, err)
    }

    proxyReq.on('error', fail)
    proxyReq.on('timeout', () => {
      const err = new Error(`connect ETIMEDOUT ${attempt.ip}:443`)
      fail(err)
      proxyReq.destroy()
    })
    proxyReq.end()
  }

  tryAttempt(0, lastError)
}

export function forwardRequest(clientReq: http.IncomingMessage, clientRes: http.ServerResponse, domain: string, realIP: string) {
  const options = createUpstreamOptions(clientReq, domain, realIP, '')
  const proxyReq = https.request(options, (proxyRes) => {
    acceleratorState.resolved[domain] = realIP
    clientRes.writeHead(proxyRes.statusCode!, proxyRes.headers)
    proxyRes.pipe(clientRes)
  })

  let failed = false
  const failover = (err: Error) => {
    if (failed) return
    failed = true
    console.error(`[Accelerator] Upstream error for ${domain} via ${realIP}: ${err.message}`)
    retryWithSNI(clientReq, clientRes, domain, realIP, err)
  }

  proxyReq.on('error', failover)
  proxyReq.on('timeout', () => {
    const err = new Error(`connect ETIMEDOUT ${realIP}:443`)
    failover(err)
    proxyReq.destroy()
  })

  clientReq.pipe(proxyReq)
}
