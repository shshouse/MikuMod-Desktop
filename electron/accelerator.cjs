const { ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const tls = require('tls')
const net = require('net')
const http = require('http')
const https = require('https')
const crypto = require('crypto')
const forge = require('node-forge')

// === 常量 ===
const HOSTS_PATH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
const HOSTS_TAG_START = '# ===== MikuMod Accelerator START ====='
const HOSTS_TAG_END = '# ===== MikuMod Accelerator END ====='
const DOH_URLS = [
  'https://223.5.5.5/resolve',
  'https://1.12.12.12/dns-query',
  'https://1.1.1.1/dns-query',
  'https://8.8.8.8/resolve',
]
const CACHE_FILE = 'accelerate_cache.json'
const CA_CERT_FILE = 'mikumod_ca.pem'
const CA_KEY_FILE = 'mikumod_ca_key.pem'
const CA_COMMON_NAME = 'MikuMod Accelerator CA'
const PROXY_PORT = 443
const WORKER_RELAY_URL = process.env.WORKER_RELAY_URL
const WORKER_SECRET = process.env.WORKER_RELAY_SECRET
const WORKER_RELAY_DOMAINS = new Set([
  'github.com', 'github.dev', 'api.github.com', 'github.githubassets.com',
  'education.github.com', 'resources.github.com', 'uploads.github.com',
  'archiveprogram.github.com', 'raw.githubusercontent.com', 'avatars.githubusercontent.com',
  'objects.githubusercontent.com', 'desktop.githubusercontent.com', 'media.githubusercontent.com',
  'camo.githubusercontent.com', 'github.io', 'gist.github.com', 'copilot.github.com',
  'alive.github.com',
  'twitch.tv', 'www.twitch.tv', 'api.twitch.tv', 'ttvnw.net',
  'www.recaptcha.net', 'fonts.googleapis.com', 'fonts.gstatic.com',
])

function needsWorkerRelay(domain) {
  if (WORKER_RELAY_DOMAINS.has(domain)) return true
  for (const d of WORKER_RELAY_DOMAINS) {
    if (domain.endsWith('.' + d)) return true
  }
  return false
}

let acceleratorState = {
  running: false,
  domains: [],
  resolved: {},
  proxyServer: null,
  keepAliveAgent: null, // 长连接复用 Agent
  certCache: {},
  caKey: null,
  caCert: null,
}

// ============================================================
// 1. CA 证书管理
// ============================================================

function getCertDir() {
  const { app } = require('electron')
  return path.join(app.getPath('userData'), 'certs')
}

function ensureCertDir() {
  const dir = getCertDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function generateRootCA() {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 10)

  const attrs = [
    { name: 'commonName', value: CA_COMMON_NAME },
    { name: 'organizationName', value: 'MikuMod' },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
    forgeKey: keys.privateKey,
    forgeCert: cert,
  }
}

function loadOrCreateCA() {
  const dir = ensureCertDir()
  const certPath = path.join(dir, CA_CERT_FILE)
  const keyPath = path.join(dir, CA_KEY_FILE)

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      const certPem = fs.readFileSync(certPath, 'utf-8')
      const keyPem = fs.readFileSync(keyPath, 'utf-8')
      const forgeCert = forge.pki.certificateFromPem(certPem)
      if (new Date() < forgeCert.validity.notAfter) {
        return { key: keyPem, cert: certPem, forgeKey: forge.pki.privateKeyFromPem(keyPem), forgeCert }
      }
    } catch {}
  }

  const ca = generateRootCA()
  fs.writeFileSync(certPath, ca.cert, 'utf-8')
  fs.writeFileSync(keyPath, ca.key, 'utf-8')
  return ca
}

function installCATrust(derPath) {
  try {
    // 用 certutil 检查是否已安装（不走 PowerShell，避免火绒拦截）
    const checkOutput = execSync(
      `certutil -store Root "${CA_COMMON_NAME}"`,
      { windowsHide: true, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    // 如果能找到证书，certutil 会正常输出包含 CN 的内容
    if (checkOutput.includes(CA_COMMON_NAME)) return true
  } catch {
    // certutil -store 找不到时会抛异常，说明还没安装，继续安装流程
  }

  try {
    // 直接用 certutil 安装（进程已是管理员权限，不需要提权）
    execSync(`certutil -addstore Root "${derPath}"`, {
      windowsHide: true,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    console.log('[Accelerator] CA certificate installed successfully')
    return true
  } catch (e) {
    console.error('[Accelerator] CA install failed:', e.message)
    return false
  }
}

/** 从系统信任存储移除 CA 证书 */
function uninstallCATrust() {
  try {
    // 先查证书序列号
    const output = execSync(
      `certutil -store Root "${CA_COMMON_NAME}"`,
      { windowsHide: true, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    // 提取序列号
    const serialMatch = output.match(/序列号[:\s]+([0-9a-fA-F]+)/)
      || output.match(/Serial Number[:\s]+([0-9a-fA-F]+)/i)
    if (serialMatch) {
      execSync(`certutil -delstore Root "${serialMatch[1]}"`, {
        windowsHide: true, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      })
      console.log('[Accelerator] CA certificate removed from trust store')
    }
  } catch {
    // 没找到或删除失败，忽略
  }
}

// ============================================================
// 2. 按域名动态签发证书
// ============================================================

function generateDomainCert(domain) {
  if (acceleratorState.certCache[domain]) return acceleratorState.certCache[domain]

  const caKey = acceleratorState.caKey
  const caCert = acceleratorState.caCert

  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = crypto.randomBytes(16).toString('hex')
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1)

  cert.setSubject([{ name: 'commonName', value: domain }])
  cert.setIssuer(caCert.subject.attributes)

  const altNames = [{ type: 2, value: domain }]
  if (!domain.startsWith('*.')) altNames.push({ type: 2, value: `*.${domain}` })

  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames },
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: true },
  ])
  cert.sign(caKey, forge.md.sha256.create())

  const result = {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
  }
  acceleratorState.certCache[domain] = result
  return result
}

// ============================================================
// 3. DoH 解析
// ============================================================

async function resolveViaDoh(domain) {
  for (const dohUrl of DOH_URLS) {
    try {
      const url = `${dohUrl}?name=${domain}&type=A`
      const headers = dohUrl.includes('1.1.1.1') ? { 'Accept': 'application/dns-json' } : {}
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) })
      const data = await response.json()
      const aRecord = (data.Answer || []).find(a => a.type === 1)
      if (aRecord) return aRecord.data
    } catch {}
  }
  return null
}

// ============================================================
// 4. Hosts 文件操作（指向 127.0.0.1）
// ============================================================

function readHostsFile() {
  try { return fs.readFileSync(HOSTS_PATH, 'utf-8') } catch { return '' }
}

function containsMikuModEntries(content) {
  return content.includes(HOSTS_TAG_START)
}

function buildHostsEntries(domains) {
  const lines = [HOSTS_TAG_START]
  for (const domain of domains) lines.push(`127.0.0.1 ${domain}`)
  lines.push(HOSTS_TAG_END)
  return lines.join('\n')
}

function removeExistingEntries(content) {
  const startIdx = content.indexOf(HOSTS_TAG_START)
  const endIdx = content.indexOf(HOSTS_TAG_END)
  if (startIdx === -1 || endIdx === -1) return content
  const before = content.substring(0, startIdx).trimEnd()
  const after = content.substring(endIdx + HOSTS_TAG_END.length).trimStart()
  return before + (after ? '\n' + after : '')
}

function writeHosts(newContent) {
  // 进程已是管理员权限，直接写 hosts 文件
  fs.writeFileSync(HOSTS_PATH, newContent, 'utf-8')
  // 刷新 DNS 缓存（直接调用 ipconfig，不走 PowerShell）
  try {
    execSync('ipconfig /flushdns', { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch {}
}

function applyHostsProxy(domainList) {
  if (domainList.length === 0) return { success: false, error: '没有可用的加速域名' }
  const currentContent = readHostsFile()
  const cleanContent = removeExistingEntries(currentContent)
  const newEntries = buildHostsEntries(domainList)
  const newContent = cleanContent.trimEnd() + '\n\n' + newEntries + '\n'
  try { writeHosts(newContent); return { success: true } }
  catch (e) { return { success: false, error: e.message } }
}

function removeHosts() {
  const currentContent = readHostsFile()
  if (!containsMikuModEntries(currentContent)) return { success: true }
  const cleanContent = removeExistingEntries(currentContent)
  try { writeHosts(cleanContent.trimEnd() + '\n'); return { success: true } }
  catch (e) { return { success: false, error: e.message } }
}

// ============================================================
// 5. 本地 HTTPS 反向代理（核心）
// ============================================================

/**
 * HTTP 级别反向代理（同 Steam++ YARP 架构）
 *
 * 浏览器 --TLS--> 127.0.0.1:443 (本地 HTTPS 服务器终止 TLS，解析 HTTP)
 * 本地代理 --HTTPS(不发SNI)--> 真实IP:443 (转发 HTTP 请求)
 *
 * 关键区别于之前的 L4 pipe：
 * 1. 在 HTTP 层解析请求/响应，正确处理 headers、chunked encoding
 * 2. 上游连接不发 SNI (servername='')，绕过 GFW 的 SNI 检测
 * 3. 强制 HTTP/1.1 避免 ALPN 协商不一致
 */

function createProxyServer() {
  const defaultCert = generateDomainCert('localhost')

  // 开启 Keep-Alive 连接池，大幅提升并发加载速度（如多图网页）
  acceleratorState.keepAliveAgent = new https.Agent({
    keepAlive: true,
    maxSockets: Infinity,
    timeout: 60000,
  })

  // 使用 https.createServer 同时做 TLS 终止 + HTTP 解析
  const server = https.createServer({
    key: defaultCert.key,
    cert: defaultCert.cert,
    SNICallback: (servername, cb) => {
      const cert = generateDomainCert(servername)
      const ctx = tls.createSecureContext({ key: cert.key, cert: cert.cert })
      cb(null, ctx)
    },
    minVersion: 'TLSv1.2',
    // 强制 HTTP/1.1，避免 HTTP/2 ALPN 问题
    ALPNProtocols: ['http/1.1'],
  }, (req, res) => {
    // 此处已经拿到解析好的 HTTP 请求
    const domain = req.headers.host?.split(':')[0] || req.socket.servername || 'unknown'
    const realIP = acceleratorState.resolved[domain]

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

  // 处理 WebSocket
  server.on('upgrade', (req, clientSocket, head) => {
    const domain = req.headers.host?.split(':')[0] || 'unknown'
    const realIP = acceleratorState.resolved[domain]

    if (!realIP) {
      clientSocket.destroy()
      return
    }

    // 建立到上游的 TLS 隧道（WebSocket 透明转发）
    const upstreamSocket = tls.connect({
      host: realIP,
      port: 443,
      servername: '', // 同样不发 SNI
      rejectUnauthorized: false,
    }, () => {
      // 构建原始请求握手头转给服务端
      let requestHeader = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
      for(let i=0; i<req.rawHeaders.length; i+=2){
        requestHeader += `${req.rawHeaders[i]}: ${req.rawHeaders[i+1]}\r\n`
      }
      requestHeader += '\r\n'
      
      upstreamSocket.write(requestHeader)
      if (head && head.length) upstreamSocket.write(head)
      
      // 双向管道接通
      clientSocket.pipe(upstreamSocket)
      upstreamSocket.pipe(clientSocket)
    })

    upstreamSocket.on('error', () => {
      clientSocket.destroy()
      upstreamSocket.destroy()
    })
    clientSocket.on('error', () => {
      upstreamSocket.destroy()
    })
  })

  return server
}

/**
 * HTTP 级别请求转发
 * 不发 SNI 绕过 GFW，用 Host header 让目标服务器正确路由
 */
function forwardRequest(clientReq, clientRes, domain, realIP) {
  // 判断是否需要走 Worker 中转
  if (needsWorkerRelay(domain)) {
    return forwardViaWorker(clientReq, clientRes, domain)
  }

  const options = {
    hostname: realIP,
    port: 443,
    path: clientReq.url,
    method: clientReq.method,
    headers: { ...clientReq.headers },
    // 关键: 不发 SNI，绕过 GFW 的 SNI 检测
    servername: '',
    rejectUnauthorized: false,
    timeout: 30000,
    // 使用保持连接池的 Agent，提速
    agent: acceleratorState.keepAliveAgent,
  }

  // 确保 Host header 是原始域名（让目标服务器正确路由）
  options.headers.host = domain

  // 删除可能导致问题的 headers
  delete options.headers['accept-encoding'] // 避免压缩导致的流式传输问题

  const proxyReq = https.request(options, (proxyRes) => {
    // 转发响应状态码和 headers
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers)
    // 流式转发响应体
    proxyRes.pipe(clientRes)
  })

  proxyReq.on('error', (err) => {
    console.error(`[Accelerator] Upstream error for ${domain}: ${err.message}`)

    // 如果无 SNI 连接失败，尝试带 SNI 重试一次
    retryWithSNI(clientReq, clientRes, domain, realIP)
  })

  proxyReq.on('timeout', () => {
    console.error(`[Accelerator] Upstream timeout for ${domain}`)
    proxyReq.destroy()
    if (!clientRes.headersSent) {
      clientRes.writeHead(504)
      clientRes.end('Gateway Timeout')
    }
  })

  // 流式转发请求体
  clientReq.pipe(proxyReq)
}

/**
 * 通过 Cloudflare Worker 中转请求
 * 用于 Fastly CDN + GFW SNI 双重封锁的域名（GitHub、Twitch 等）
 */
const workerAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 32,         // Worker 并发连接数
  maxFreeSockets: 8,
})

function forwardViaWorker(clientReq, clientRes, domain) {
  const workerUrl = new URL(clientReq.url, WORKER_RELAY_URL)

  const headers = { ...clientReq.headers }
  headers['host'] = new URL(WORKER_RELAY_URL).host
  headers['x-proxy-host'] = domain
  headers['x-proxy-secret'] = WORKER_SECRET
  // 保留 accept-encoding，让 Worker 返回压缩数据直接透传给浏览器
  // 浏览器本身能解压 gzip/br，无需本地代理处理

  const proxyReq = https.request(workerUrl.href, {
    method: clientReq.method,
    headers,
    timeout: 30000,
    agent: workerAgent,
  }, (proxyRes) => {
    const resHeaders = { ...proxyRes.headers }
    delete resHeaders['access-control-allow-origin']
    delete resHeaders['x-cache'] // 调试用，生产环境不透传

    clientRes.writeHead(proxyRes.statusCode, resHeaders)
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

/**
 * 带 SNI 重试（某些 CDN 必须要 SNI 来路由）
 */
function retryWithSNI(clientReq, clientRes, domain, realIP) {
  if (clientRes.headersSent) return

  const options = {
    hostname: realIP,
    port: 443,
    path: clientReq.url,
    method: clientReq.method,
    headers: { ...clientReq.headers },
    servername: domain, // 带 SNI 重试
    rejectUnauthorized: false,
    timeout: 30000,
    agent: acceleratorState.keepAliveAgent,
  }
  options.headers.host = domain
  delete options.headers['accept-encoding']

  const proxyReq = https.request(options, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers)
    proxyRes.pipe(clientRes)
  })

  proxyReq.on('error', (err) => {
    console.error(`[Accelerator] Retry with SNI also failed for ${domain}: ${err.message}`)
    if (!clientRes.headersSent) {
      clientRes.writeHead(502)
      clientRes.end(`Bad Gateway: ${err.message}`)
    }
  })

  proxyReq.on('timeout', () => {
    proxyReq.destroy()
    if (!clientRes.headersSent) {
      clientRes.writeHead(504)
      clientRes.end('Gateway Timeout')
    }
  })

  // 注意：重试时请求体可能已经被消费了，对于 GET/HEAD 没有问题
  proxyReq.end()
}

// ============================================================
// 6. TCP Ping
// ============================================================

function tcpPing(host, port = 443, timeout = 2000) {
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

// ============================================================
// 7. 缓存
// ============================================================

function getCachePath() {
  const { app } = require('electron')
  return path.join(app.getPath('userData'), CACHE_FILE)
}

function loadCache() {
  try { return JSON.parse(fs.readFileSync(getCachePath(), 'utf-8')) } catch { return null }
}

function saveCache(domains) {
  try { fs.writeFileSync(getCachePath(), JSON.stringify(domains, null, 2), 'utf-8') } catch {}
}

// ============================================================
// 8. IPC 注册
// ============================================================

function registerAcceleratorIPC() {
  ipcMain.handle('accelerator-status', () => ({
    running: acceleratorState.running,
    resolved: acceleratorState.resolved,
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
    const ip = await resolveViaDoh(domain)
    if (ip) acceleratorState.resolved[domain] = ip
    return ip
  })

  ipcMain.handle('accelerator-resolve-all', async (_e, domains) => {
    const results = {}
    await Promise.all(domains.map(async (d) => {
      if (d.forward_ip) { results[d.match_domain] = d.forward_ip; return }
      const ip = await resolveViaDoh(d.match_domain)
      if (ip) results[d.match_domain] = ip
    }))
    acceleratorState.resolved = { ...acceleratorState.resolved, ...results }
    return results
  })

  // === 启动加速 ===
  ipcMain.handle('accelerator-start', async (_e, enabledDomains) => {
    if (acceleratorState.running) return { success: false, error: '加速已在运行' }

    try {
      // 1. CA 证书
      const ca = loadOrCreateCA()
      acceleratorState.caKey = ca.forgeKey
      acceleratorState.caCert = ca.forgeCert
      acceleratorState.certCache = {} // 清空域名证书缓存

      // 2. 安装到系统信任存储
      const certDir = ensureCertDir()
      const derPath = path.join(certDir, 'mikumod_ca.cer')
      const forgeCert = forge.pki.certificateFromPem(ca.cert)
      const derBuffer = Buffer.from(
        forge.asn1.toDer(forge.pki.certificateToAsn1(forgeCert)).getBytes(), 'binary'
      )
      fs.writeFileSync(derPath, derBuffer)

      if (!installCATrust(derPath)) {
        return { success: false, error: 'CA 证书安装失败，请允许管理员权限' }
      }

      // 3. DoH 解析
      const toResolve = enabledDomains.filter(d => !d.forward_ip && !d.match_domain.includes('/'))
      const results = {}
      await Promise.all(toResolve.map(async (d) => {
        const ip = await resolveViaDoh(d.match_domain)
        if (ip) results[d.match_domain] = ip
      }))
      enabledDomains.forEach(d => {
        if (d.forward_ip) results[d.match_domain] = d.forward_ip
      })
      acceleratorState.resolved = { ...acceleratorState.resolved, ...results }

      // 4. 启动本地反向代理
      const server = createProxyServer()
      await new Promise((resolve, reject) => {
        server.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            reject(new Error(`端口 ${PROXY_PORT} 已被占用，请关闭占用 443 端口的程序`))
          } else if (err.code === 'EACCES') {
            reject(new Error('需要管理员权限来监听 443 端口'))
          } else reject(err)
        })
        server.listen(PROXY_PORT, '127.0.0.1', () => {
          console.log(`[Accelerator] Reverse proxy on 127.0.0.1:${PROXY_PORT}`)
          resolve()
        })
      })
      acceleratorState.proxyServer = server

      // 5. hosts 指向 127.0.0.1
      const domainList = enabledDomains
        .filter(d => !d.match_domain.includes('/') && acceleratorState.resolved[d.match_domain])
        .map(d => d.match_domain)

      const hostsResult = applyHostsProxy(domainList)
      if (!hostsResult.success) {
        server.close(); acceleratorState.proxyServer = null
        return hostsResult
      }

      acceleratorState.running = true

      const hostsMap = {}
      domainList.forEach(d => { hostsMap[d] = acceleratorState.resolved[d] })
      return { success: true, hostsMap }
    } catch (e) {
      if (acceleratorState.proxyServer) {
        acceleratorState.proxyServer.close()
        acceleratorState.proxyServer = null
      }
      removeHosts()
      return { success: false, error: e.message }
    }
  })

  // === 停止加速 ===
  ipcMain.handle('accelerator-stop', async () => {
    // 1. 关闭代理服务器
    if (acceleratorState.proxyServer) {
      acceleratorState.proxyServer.close()
      acceleratorState.proxyServer = null
    }
    if (acceleratorState.keepAliveAgent) {
      acceleratorState.keepAliveAgent.destroy()
      acceleratorState.keepAliveAgent = null
    }
    // 2. 清除 hosts
    const result = removeHosts()
    if (result.success) {
      acceleratorState.running = false
      acceleratorState.resolved = {}
      acceleratorState.certCache = {}
    }
    // 3. 移除 CA 信任（避免证书污染）
    uninstallCATrust()
    return result
  })

  ipcMain.handle('accelerator-check-hosts', () => containsMikuModEntries(readHostsFile()))

  ipcMain.handle('accelerator-ping', async (_e, ip) => await tcpPing(ip))

  ipcMain.handle('accelerator-ping-both', async (_e, domain, ip) => {
    const before = await tcpPing(domain, 443, 2000)
    const after = await tcpPing(ip, 443, 2000)
    return { before, after }
  })
}

function cleanupOnExit() {
  if (acceleratorState.proxyServer) {
    acceleratorState.proxyServer.close()
    acceleratorState.proxyServer = null
  }
  if (acceleratorState.keepAliveAgent) {
    acceleratorState.keepAliveAgent.destroy()
    acceleratorState.keepAliveAgent = null
  }
  if (acceleratorState.running) {
    try {
      const content = readHostsFile()
      if (containsMikuModEntries(content)) {
        const clean = removeExistingEntries(content)
        try {
          fs.writeFileSync(HOSTS_PATH, clean.trimEnd() + '\n', 'utf-8')
          execSync('ipconfig /flushdns', {
            windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
          })
        } catch {}
      }
    } catch {}
    // 退出时也尝试移除 CA 信任
    try { uninstallCATrust() } catch {}
  }
}

module.exports = { registerAcceleratorIPC, cleanupOnExit }
