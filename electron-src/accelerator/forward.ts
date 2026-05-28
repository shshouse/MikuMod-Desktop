import https from 'https'
import net from 'net'
import type http from 'http'
import { UPSTREAM_TIMEOUT_MS } from './constants'
import { acceleratorState } from './state'
import { normalizeDomain, needsWorkerRelay, getWorkerRelayConfig } from './domains'
import { resolveCandidatesViaDoh } from './dns'

// --- 域名判定 ---

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

// --- 上游请求构造 ---

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
    rejectUnauthorized: false,
    timeout: UPSTREAM_TIMEOUT_MS,
    agent: acceleratorState.keepAliveAgent || undefined,
  }
}

// --- Worker Relay ---

const workerAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 32,
  maxFreeSockets: 8,
})

function forwardViaWorker(clientReq: http.IncomingMessage, clientRes: http.ServerResponse, domain: string) {
  const relayConfig = getWorkerRelayConfig()
  if (!relayConfig.url || !relayConfig.secret) {
    if (!clientRes.headersSent) {
      clientRes.writeHead(503)
      clientRes.end('Worker relay is not configured. Please set WORKER_RELAY_URL and WORKER_RELAY_SECRET, then restart the app.')
    }
    return
  }

  let workerBaseUrl: URL
  let workerUrl: URL
  try {
    workerBaseUrl = new URL(relayConfig.url)
    workerUrl = new URL(clientReq.url!, workerBaseUrl)
  } catch {
    if (!clientRes.headersSent) {
      clientRes.writeHead(503)
      clientRes.end('Worker relay URL is invalid. Please check WORKER_RELAY_URL and restart the app.')
    }
    return
  }

  const headers = { ...clientReq.headers }
  headers['host'] = workerBaseUrl.host
  headers['x-proxy-host'] = domain
  headers['x-proxy-secret'] = relayConfig.secret

  const proxyReq = https.request(workerUrl.href, {
    method: clientReq.method,
    headers,
    timeout: 30000,
    agent: workerAgent,
  }, (proxyRes) => {
    const resHeaders = { ...proxyRes.headers }
    delete resHeaders['access-control-allow-origin']
    delete resHeaders['x-cache']
    if (proxyRes.statusCode! >= 400) {
      console.warn(`[Accelerator] Worker relay returned ${proxyRes.statusCode} for ${domain}${clientReq.url}`)
    }
    clientRes.writeHead(proxyRes.statusCode!, resHeaders)
    proxyRes.pipe(clientRes)
  })

  proxyReq.on('error', (err) => {
    console.error(`[Accelerator] Worker relay error for ${domain}: ${err.message}`)
    if (!clientRes.headersSent) {
      clientRes.writeHead(502)
      clientRes.end(`Worker relay failed: ${err.message}`)
    }
  })

  proxyReq.on('timeout', () => {
    console.error(`[Accelerator] Worker relay timeout for ${domain}`)
    proxyReq.destroy()
    if (!clientRes.headersSent) {
      clientRes.writeHead(504)
      clientRes.end('Worker Relay Timeout')
    }
  })

  clientReq.pipe(proxyReq)
}

// --- SNI 重试 ---

function retryWithSNI(clientReq: http.IncomingMessage, clientRes: http.ServerResponse, domain: string, realIP: string, lastError: Error | null) {
  if (clientRes.headersSent) return
  if (!isRetryableRequestMethod(clientReq.method)) {
    if (needsWorkerRelay(domain)) {
      console.warn(`[Accelerator] Non-retryable ${clientReq.method} for ${domain}, falling back to Worker relay`)
      return forwardViaWorker(clientReq, clientRes, domain)
    }
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
      if (needsWorkerRelay(domain)) {
        console.warn(`[Accelerator] All direct attempts failed for ${domain}, falling back to Worker relay`)
        return forwardViaWorker(clientReq, clientRes, domain)
      }
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

// --- 主转发 ---

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
