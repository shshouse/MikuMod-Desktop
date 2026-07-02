import http from 'http'
import https from 'https'
import tls from 'tls'
import net from 'net'
import {
  PROXY_PORT,
  PROXY_WARM_IDLE_MS,
  SYSTEM_PROXY_PORT,
  SYSTEM_PROXY_MITM_PORT,
  HEALTH_CHECK_PATH,
  PAC_PATH,
} from './constants'
import { acceleratorState, type ForgeCert } from './state'
import { generateDomainCert, waitForLocalProxyHealth } from './cert'
import { normalizeDomain } from './domains'
import { forwardRequest, isAcceleratedDomain, resolveAcceleratedDomainIP } from './forward'

// --- 通用关闭 ---

function closeServer(server: http.Server | https.Server | null, timeoutMs = 1500): Promise<void> {
  if (!server) return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const done = () => { if (settled) return; settled = true; resolve() }
    try {
      server.close(done)
      if (typeof (server as any).closeAllConnections === 'function') (server as any).closeAllConnections()
    } catch { done() }
    setTimeout(done, timeoutMs)
  })
}

// --- HTTPS 代理 ---

function closeProxyServer(): Promise<void> {
  const server = acceleratorState.proxyServer
  acceleratorState.proxyServer = null
  return closeServer(server)
}

export function clearProxyShutdownTimer() {
  if (acceleratorState.proxyShutdownTimer) {
    clearTimeout(acceleratorState.proxyShutdownTimer)
    acceleratorState.proxyShutdownTimer = null
  }
}

export async function stopProxyServer() {
  clearProxyShutdownTimer()
  await closeProxyServer()
  if (acceleratorState.keepAliveAgent) {
    acceleratorState.keepAliveAgent.destroy()
    acceleratorState.keepAliveAgent = null
  }
}

export async function stopSystemProxyServers() {
  const proxyServer = acceleratorState.systemProxyServer
  const mitmServer = acceleratorState.systemProxyMitmServer
  acceleratorState.systemProxyServer = null
  acceleratorState.systemProxyMitmServer = null
  await Promise.all([closeServer(proxyServer), closeServer(mitmServer)])
  if (!acceleratorState.proxyServer && acceleratorState.keepAliveAgent) {
    acceleratorState.keepAliveAgent.destroy()
    acceleratorState.keepAliveAgent = null
  }
}

export function scheduleProxyWarmShutdown() {
  clearProxyShutdownTimer()
  if (!acceleratorState.proxyServer) return
  acceleratorState.proxyShutdownTimer = setTimeout(() => {
    acceleratorState.proxyShutdownTimer = null
    if (acceleratorState.running || !acceleratorState.proxyServer) return
    stopProxyServer().catch(() => {})
  }, PROXY_WARM_IDLE_MS)
}

// --- 代理服务器创建 ---

function createProxyServer() {
  const defaultCert = generateDomainCert('localhost')

  if (!acceleratorState.keepAliveAgent) {
    acceleratorState.keepAliveAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 32,
      maxFreeSockets: 8,
    })
  }

  const server = https.createServer({
    key: defaultCert.key,
    cert: defaultCert.certChain,
    SNICallback: (servername, cb) => {
      const certDomain = normalizeDomain(servername) || 'localhost'
      const cert = generateDomainCert(certDomain)
      const ctx = tls.createSecureContext({ key: cert.key, cert: cert.certChain })
      cb(null, ctx)
    },
    minVersion: 'TLSv1.2',
    ALPNProtocols: ['http/1.1'],
  }, async (req, res) => {
    const domain = normalizeDomain(req.headers.host?.split(':')[0]) || normalizeDomain((req.socket as any).servername) || 'unknown'

    if (req.url === HEALTH_CHECK_PATH && req.headers['x-mikumod-health-check'] === '1') {
      res.writeHead(204, { 'cache-control': 'no-store' })
      res.end()
      return
    }

    const realIP = await resolveAcceleratedDomainIP(domain)
    if (!realIP) {
      console.log(`[Accelerator] No resolved IP for ${domain}, rejecting`)
      res.writeHead(502)
      res.end('Bad Gateway: domain not configured')
      return
    }

    forwardRequest(req, res, domain, realIP)
  })

  server.on('error', (err) => {
    console.error('[Accelerator] Server error:', err.message)
  })

  server.on('upgrade', (req, clientSocket, head) => {
    const domain = normalizeDomain(req.headers.host?.split(':')[0]) || 'unknown'
    resolveAcceleratedDomainIP(domain).then((realIP) => {
      if (!realIP) { clientSocket.destroy(); return }

      const upstreamSocket = tls.connect({
        host: realIP,
        port: 443,
        servername: domain,
        rejectUnauthorized: true,
      }, () => {
        let requestHeader = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          requestHeader += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`
        }
        requestHeader += '\r\n'
        upstreamSocket.write(requestHeader)
        if (head && head.length) upstreamSocket.write(head)
        clientSocket.pipe(upstreamSocket)
        upstreamSocket.pipe(clientSocket)
      })

      upstreamSocket.on('error', () => { clientSocket.destroy(); upstreamSocket.destroy() })
      clientSocket.on('error', () => { upstreamSocket.destroy() })
    }).catch(() => { clientSocket.destroy() })
  })

  return server
}

function listenProxyServer(server: https.Server) {
  return new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') reject(new Error(`\u7aef\u53e3 ${PROXY_PORT} \u5df2\u88ab\u5360\u7528\uff0c\u8bf7\u5173\u95ed\u5360\u7528 443 \u7aef\u53e3\u7684\u7a0b\u5e8f`))
      else if (err.code === 'EACCES') reject(new Error('\u9700\u8981\u7ba1\u7406\u5458\u6743\u9650\u6765\u76d1\u542c 443 \u7aef\u53e3'))
      else reject(err)
    }
    server.once('error', onError)
    server.listen(PROXY_PORT, '127.0.0.1', () => {
      server.off('error', onError)
      console.log(`[Accelerator] Reverse proxy on 127.0.0.1:${PROXY_PORT}`)
      resolve()
    })
  })
}

export async function ensureProxyServerReady(caCert: ForgeCert) {
  clearProxyShutdownTimer()
  if (acceleratorState.proxyServer) {
    try {
      await waitForLocalProxyHealth('localhost', caCert)
      return
    } catch (err: any) {
      console.warn(`[Accelerator] Existing proxy health check failed, recreating: ${err.message}`)
      await stopProxyServer()
    }
  }
  const server = createProxyServer()
  acceleratorState.proxyServer = server
  await listenProxyServer(server)
  await waitForLocalProxyHealth('localhost', caCert)
}

// --- PAC ---

export function createPacContent(domainList: string[]) {
  const domains = [...new Set(domainList.map(normalizeDomain).filter(Boolean))]
  const body = JSON.stringify(domains)
  return `function FindProxyForURL(url, host) {
  var domains = ${body};
  host = String(host || '').toLowerCase();
  for (var i = 0; i < domains.length; i++) {
    var domain = domains[i];
    if (host === domain || dnsDomainIs(host, '.' + domain)) {
      return 'PROXY 127.0.0.1:${SYSTEM_PROXY_PORT}; DIRECT';
    }
  }
  return 'DIRECT';
}
`
}

function createPacResponse(domainList: string[]) {
  return Buffer.from(createPacContent(domainList), 'utf-8')
}

function parseConnectTarget(url: string) {
  const [host, rawPort] = String(url || '').split(':')
  return { host: normalizeDomain(host), port: Number(rawPort || 443) }
}

// --- 系统代理服务器 ---

function createSystemProxyServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === PAC_PATH) {
      const pac = createPacResponse(acceleratorState.activeDomains)
      res.writeHead(200, {
        'content-type': 'application/x-ns-proxy-autoconfig; charset=utf-8',
        'content-length': pac.length,
        'cache-control': 'no-store',
      })
      res.end(pac)
      return
    }

    let target: URL
    try { target = new URL(req.url!) } catch {
      res.writeHead(400)
      res.end('Bad Request')
      return
    }

    const domain = normalizeDomain(target.hostname)
    if (!domain || !isAcceleratedDomain(domain)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    req.url = target.pathname + target.search
    req.headers.host = domain
    resolveAcceleratedDomainIP(domain).then((realIP) => {
      if (!realIP) { res.writeHead(502); res.end('Bad Gateway: domain not configured'); return }
      forwardRequest(req, res, domain, realIP)
    }).catch((err) => {
      res.writeHead(502); res.end(`Bad Gateway: ${err.message}`)
    })
  })

  server.on('connect', (req, clientSocket) => {
    const target = parseConnectTarget(req.url!)
    if (!target.host || target.port !== 443 || !isAcceleratedDomain(target.host)) {
      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      clientSocket.destroy()
      return
    }

    const upstreamSocket = net.connect(SYSTEM_PROXY_MITM_PORT, '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      clientSocket.pipe(upstreamSocket)
      upstreamSocket.pipe(clientSocket)
    })

    const closeBoth = () => { clientSocket.destroy(); upstreamSocket.destroy() }
    upstreamSocket.on('error', closeBoth)
    clientSocket.on('error', closeBoth)
  })

  server.on('error', (err) => {
    console.error('[Accelerator] System proxy server error:', err.message)
  })

  return server
}

function listenServer(server: http.Server | https.Server, port: number, name: string) {
  return new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') reject(new Error(`\u7aef\u53e3 ${port} \u5df2\u88ab\u5360\u7528\uff0c\u8bf7\u5173\u95ed\u5360\u7528\u8be5\u7aef\u53e3\u7684\u7a0b\u5e8f`))
      else if (err.code === 'EACCES') reject(new Error(`\u6ca1\u6709\u6743\u9650\u76d1\u542c\u672c\u5730\u7aef\u53e3 ${port}`))
      else reject(err)
    }
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError)
      console.log(`[Accelerator] ${name} on 127.0.0.1:${port}`)
      resolve()
    })
  })
}

export async function ensureSystemProxyServersReady(caCert: ForgeCert) {
  if (acceleratorState.systemProxyServer && acceleratorState.systemProxyMitmServer) {
    try {
      await waitForLocalProxyHealth('localhost', caCert, SYSTEM_PROXY_MITM_PORT)
      return
    } catch (err: any) {
      console.warn(`[Accelerator] Existing system proxy health check failed, recreating: ${err.message}`)
      await stopSystemProxyServers()
    }
  }

  const mitmServer = createProxyServer()
  const proxyServer = createSystemProxyServer()
  acceleratorState.systemProxyMitmServer = mitmServer
  acceleratorState.systemProxyServer = proxyServer
  try {
    await listenServer(mitmServer, SYSTEM_PROXY_MITM_PORT, 'System proxy MITM')
    await waitForLocalProxyHealth('localhost', caCert, SYSTEM_PROXY_MITM_PORT)
    await listenServer(proxyServer, SYSTEM_PROXY_PORT, 'PAC/HTTP proxy')
  } catch (err) {
    await stopSystemProxyServers()
    throw err
  }
}
