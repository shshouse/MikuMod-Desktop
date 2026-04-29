const { app, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const tls = require('tls')
const net = require('net')
const dns = require('dns').promises
const http = require('http')
const https = require('https')
const crypto = require('crypto')
const forge = require('node-forge')
const { getEnvFileCandidates, loadEnvFiles } = require('./env-loader.cjs')

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
const HEALTH_CHECK_PATH = '/__mikumod_accelerator_health'
const UPSTREAM_TIMEOUT_MS = 10000
const DOH_PROVIDER_TIMEOUT_MS = 2000
const DOH_EARLY_RETURN_GRACE_MS = 150
const DOH_TOTAL_TIMEOUT_MS = 2200
const CERT_PREWARM_DOMAIN_COUNT = 12
const HOSTS_SELF_HEAL_DEBOUNCE_MS = 800
const HOSTS_SELF_HEAL_IGNORE_MS = 1500
const HOSTS_WATCHER_RETRY_MS = 1000
const PROXY_WARM_IDLE_MS = 15000
const LEGACY_ACCELERATOR_HOSTS_DOMAINS = new Set([
  'steamcdn-a.akamaihd.net', 'cdn.akamai.steamstatic.com', 'steamcommunity-a.akamaihd.net',
  'media.steampowered.com', 'steamcommunity.com', 'store.steampowered.com',
  'api.steampowered.com', 'login.steampowered.com', 'help.steampowered.com',
  'github.com', 'github.dev', 'api.github.com', 'github.githubassets.com',
  'education.github.com', 'resources.github.com', 'uploads.github.com',
  'archiveprogram.github.com', 'raw.githubusercontent.com', 'avatars.githubusercontent.com',
  'objects.githubusercontent.com', 'desktop.githubusercontent.com', 'media.githubusercontent.com',
  'camo.githubusercontent.com', 'github.io', 'gist.github.com', 'copilot.github.com',
  'alive.github.com',
  'twitch.tv', 'www.twitch.tv', 'api.twitch.tv', 'ttvnw.net',
  'www.recaptcha.net', 'fonts.googleapis.com', 'fonts.gstatic.com',
])
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

function getWorkerRelayConfig() {
  loadEnvFiles({ app, keys: ['WORKER_RELAY_URL', 'WORKER_RELAY_SECRET'], override: true })
  return {
    url: process.env.WORKER_RELAY_URL?.trim() || '',
    secret: process.env.WORKER_RELAY_SECRET?.trim() || '',
  }
}

function getWorkerRelayMissingConfigMessage(relayDomains) {
  const envPaths = getEnvFileCandidates(app).slice(0, 4).join('、')
  return `所选域名包含必须走中转的站点：${relayDomains.slice(0, 3).join('、')}${relayDomains.length > 3 ? ' 等' : ''}。请在 .env 中配置 WORKER_RELAY_URL 和 WORKER_RELAY_SECRET 后重新开启加速。可读取位置：${envPaths}`
}

function needsWorkerRelay(domain) {
  if (WORKER_RELAY_DOMAINS.has(domain)) return true
  for (const d of WORKER_RELAY_DOMAINS) {
    if (domain.endsWith('.' + d)) return true
  }
  return false
}

function findDomainsRequiringWorkerRelay(domains) {
  return domains
    .map(d => normalizeDomain(d.match_domain))
    .filter(Boolean)
    .filter(domain => needsWorkerRelay(domain))
}

let acceleratorState = {
  running: false,
  domains: [],
  activeDomains: [],
  resolved: {},
  resolvedCandidates: {},
  proxyServer: null,
  proxyShutdownTimer: null,
  keepAliveAgent: null, // 长连接复用 Agent
  hostsWatcher: null,
  hostsWatchTimer: null,
  hostsWatcherRetryTimer: null,
  hostsIgnoreUntil: 0,
  hostsSelfHealPaused: false,
  certCache: {},
  caFingerprint: '',
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
  cert.serialNumber = crypto.randomBytes(16).toString('hex')
  cert.validity.notBefore = new Date()
  cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1)
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

function certToDerBuffer(forgeCert) {
  return Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(forgeCert)).getBytes(),
    'binary'
  )
}

function getCertFingerprint(forgeCert) {
  return crypto.createHash('sha1').update(certToDerBuffer(forgeCert)).digest('hex').toUpperCase()
}

function normalizeHex(value) {
  return String(value || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase()
}

function isCAKeyPairValid(forgeCert, forgeKey) {
  try {
    const publicKey = forgeCert.publicKey
    return Boolean(
      publicKey.n
      && forgeKey.n
      && publicKey.e
      && forgeKey.e
      && publicKey.n.equals(forgeKey.n)
      && publicKey.e.equals(forgeKey.e)
    )
  } catch {
    return false
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
      const forgeKey = forge.pki.privateKeyFromPem(keyPem)
      if (new Date() < forgeCert.validity.notAfter && isCAKeyPairValid(forgeCert, forgeKey)) {
        return { key: keyPem, cert: certPem, forgeKey, forgeCert }
      }
    } catch {}
  }

  const ca = generateRootCA()
  fs.writeFileSync(certPath, ca.cert, 'utf-8')
  fs.writeFileSync(keyPath, ca.key, 'utf-8')
  return ca
}

function isCATrusted(expectedFingerprint) {
  try {
    const output = execSync(
      `certutil -store Root "${expectedFingerprint}"`,
      { windowsHide: true, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    return output.includes(CA_COMMON_NAME) && normalizeHex(output).includes(normalizeHex(expectedFingerprint))
  } catch {}
  return false
}

function installCATrust(derPath, expectedFingerprint) {
  if (isCATrusted(expectedFingerprint)) return true
  uninstallCATrust()
  try {
    // 直接用 certutil 安装（进程已是管理员权限，不需要提权）
    execSync(`certutil -f -addstore Root "${derPath}"`, {
      windowsHide: true,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const trusted = isCATrusted(expectedFingerprint)
    if (trusted) console.log('[Accelerator] CA certificate installed successfully')
    return trusted
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
    const certIds = new Set()
    const serialMatches = output.matchAll(/(?:序列号|Serial Number)[:\s]+([0-9a-fA-F]+)/gi)
    const hashMatches = output.matchAll(/Cert Hash\(sha1\)[:\s]+([0-9a-fA-F ]+)/gi)
    for (const match of serialMatches) certIds.add(normalizeHex(match[1]))
    if (certIds.size === 0) {
      for (const match of hashMatches) certIds.add(normalizeHex(match[1]))
    }
    for (const certId of certIds) {
      if (!certId) continue
      execSync(`certutil -delstore Root "${certId}"`, {
        windowsHide: true, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      })
    }
    if (certIds.size > 0) console.log('[Accelerator] CA certificate removed from trust store')
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
  cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1)
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

  const certPem = forge.pki.certificateToPem(cert)
  const caCertPem = forge.pki.certificateToPem(caCert)
  const result = {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: certPem,
    certChain: certPem + caCertPem,
  }
  acceleratorState.certCache[domain] = result
  return result
}

// ============================================================
// 3. DoH 解析
// ============================================================

function pushUniqueIPs(target, seen, values) {
  for (const ip of values || []) {
    if (!net.isIP(ip) || seen.has(ip)) continue
    seen.add(ip)
    target.push(ip)
  }
}

async function resolveCandidatesViaDoh(domain) {
  return await new Promise((resolve) => {
    const candidates = []
    const seen = new Set()
    const lookups = [
      ...DOH_URLS.map(async (dohUrl) => {
        try {
          const url = `${dohUrl}?name=${domain}&type=A`
          const headers = dohUrl.includes('1.1.1.1') ? { 'Accept': 'application/dns-json' } : {}
          const response = await fetch(url, { headers, signal: AbortSignal.timeout(DOH_PROVIDER_TIMEOUT_MS) })
          const data = await response.json()
          return (data.Answer || [])
            .filter(a => a.type === 1 && net.isIP(a.data))
            .map(a => a.data)
        } catch {
          return []
        }
      }),
      dns.resolve4(domain).catch(() => []),
    ]
    let pending = lookups.length
    let finished = false
    let earlyTimer = null
    const finish = () => {
      if (finished) return
      finished = true
      if (earlyTimer) clearTimeout(earlyTimer)
      clearTimeout(totalTimer)
      resolve([...candidates])
    }
    const onResult = (ips) => {
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

// ============================================================
// 4. Hosts 文件操作（指向 127.0.0.1）
// ============================================================

function readHostsFile() {
  try { return fs.readFileSync(HOSTS_PATH, 'utf-8') } catch { return '' }
}

function containsMikuModEntries(content) {
  return content.includes(HOSTS_TAG_START) || content.split(/\r?\n/).some(isLegacyAcceleratorHostsLine)
}

function buildHostsEntries(domains) {
  const lines = [HOSTS_TAG_START]
  for (const domain of domains) lines.push(`127.0.0.1 ${domain}`)
  lines.push(HOSTS_TAG_END)
  return lines.join('\n')
}

function removeExistingEntries(content) {
  const result = []
  let inBlock = false
  for (const line of content.split(/\r?\n/)) {
    if (line.includes(HOSTS_TAG_START)) {
      inBlock = true
      continue
    }
    if (line.includes(HOSTS_TAG_END)) {
      inBlock = false
      continue
    }
    if (inBlock || isLegacyAcceleratorHostsLine(line)) continue
    result.push(line)
  }
  return result.join('\n')
}

function isLegacyAcceleratorHostsLine(line) {
  const trimmed = String(line || '').trim().toLowerCase()
  if (!trimmed || trimmed.startsWith('#')) return false
  const [ip, domain] = trimmed.split(/\s+/)
  return (ip === '127.0.0.1' || ip === '::1') && LEGACY_ACCELERATOR_HOSTS_DOMAINS.has(domain)
}

function writeHosts(newContent) {
  // 进程已是管理员权限，直接写 hosts 文件
  acceleratorState.hostsIgnoreUntil = Date.now() + HOSTS_SELF_HEAL_IGNORE_MS
  fs.writeFileSync(HOSTS_PATH, newContent, 'utf-8')
  // 刷新 DNS 缓存（直接调用 ipconfig，不走 PowerShell）
  try {
    execSync('ipconfig /flushdns', { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch {}
}

function applyHostsProxy(domainList) {
  const cleanDomains = domainList.map(normalizeDomain).filter(Boolean)
  if (cleanDomains.length === 0) return { success: false, error: '没有可用的加速域名' }
  const currentContent = readHostsFile()
  const cleanContent = removeExistingEntries(currentContent)
  const newEntries = buildHostsEntries(cleanDomains)
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

function hasExpectedHostsEntries(content, domainList) {
  const cleanDomains = domainList.map(normalizeDomain).filter(Boolean)
  if (cleanDomains.length === 0) return false
  return String(content || '').includes(buildHostsEntries(cleanDomains))
}

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

function scheduleHostsSelfHealCheck(delayMs = HOSTS_SELF_HEAL_DEBOUNCE_MS) {
  if (!acceleratorState.running || acceleratorState.hostsSelfHealPaused || !acceleratorState.hostsWatcher) return
  clearHostsWatchTimer()
  acceleratorState.hostsWatchTimer = setTimeout(() => {
    acceleratorState.hostsWatchTimer = null
    healHostsIfNeeded()
  }, delayMs)
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
  } catch (err) {
    console.error(`[Accelerator] Failed to start hosts watcher: ${err.message}`)
    scheduleHostsWatcherRestart()
  }
}

function startHostsSelfHeal(domainList) {
  acceleratorState.activeDomains = domainList.map(normalizeDomain).filter(Boolean)
  acceleratorState.hostsSelfHealPaused = false
  startHostsSelfHealWatcher()
}

function stopHostsSelfHeal() {
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

function isValidDomainName(domain) {
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

function normalizeDomain(value) {
  const domain = String(value || '').trim().toLowerCase()
  return isValidDomainName(domain) ? domain : null
}

function normalizeIP(value) {
  const ip = String(value || '').trim()
  return net.isIP(ip) ? ip : null
}

function normalizeEnabledDomains(domains) {
  if (!Array.isArray(domains)) return []
  const seen = new Set()
  const result = []
  for (const item of domains) {
    if (!item || typeof item !== 'object') continue
    const domain = normalizeDomain(item.match_domain)
    if (!domain || seen.has(domain)) continue
    result.push({ ...item, match_domain: domain, forward_ip: normalizeIP(item.forward_ip) })
    seen.add(domain)
  }
  return result
}

function closeProxyServer() {
  const server = acceleratorState.proxyServer
  acceleratorState.proxyServer = null
  if (!server) return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    try {
      server.close(done)
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    } catch {
      done()
    }
    setTimeout(done, 1500)
  })
}

async function stopProxyServer() {
  clearProxyShutdownTimer()
  await closeProxyServer()
  if (acceleratorState.keepAliveAgent) {
    acceleratorState.keepAliveAgent.destroy()
    acceleratorState.keepAliveAgent = null
  }
}

function clearProxyShutdownTimer() {
  if (acceleratorState.proxyShutdownTimer) {
    clearTimeout(acceleratorState.proxyShutdownTimer)
    acceleratorState.proxyShutdownTimer = null
  }
}

async function scheduleProxyWarmShutdown() {
  clearProxyShutdownTimer()
  if (!acceleratorState.proxyServer) return
  acceleratorState.proxyShutdownTimer = setTimeout(() => {
    acceleratorState.proxyShutdownTimer = null
    if (acceleratorState.running || !acceleratorState.proxyServer) return
    stopProxyServer().catch(() => {})
  }, PROXY_WARM_IDLE_MS)
}

function resetRuntimeState(options = {}) {
  const preserveResolved = options.preserveResolved === true
  acceleratorState.running = false
  acceleratorState.activeDomains = []
  acceleratorState.hostsSelfHealPaused = false
  if (!preserveResolved) {
    acceleratorState.resolved = {}
    acceleratorState.resolvedCandidates = {}
  }
}

function warmupDomainCertificatesAsync(domains) {
  const queue = [...new Set(domains.map(normalizeDomain).filter(Boolean))].slice(0, CERT_PREWARM_DOMAIN_COUNT)
  if (queue.length === 0) return
  const runNext = () => {
    const domain = queue.shift()
    if (!domain || !acceleratorState.caKey || !acceleratorState.caCert) return
    try {
      generateDomainCert(domain)
    } catch {}
    if (queue.length > 0) setImmediate(runNext)
  }
  setImmediate(runNext)
}

function getPeerCertPem(peerCert) {
  if (!peerCert || !peerCert.raw) return null
  return `-----BEGIN CERTIFICATE-----\n${peerCert.raw.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`
}

function verifyDomainCertWithCA(peerCert, domain, caCert) {
  const pem = getPeerCertPem(peerCert)
  if (!pem) throw new Error('本地代理未返回 TLS 证书')
  const cert = forge.pki.certificateFromPem(pem)
  const now = new Date()
  if (now < cert.validity.notBefore || now > cert.validity.notAfter) {
    throw new Error('本地代理证书不在有效期内')
  }
  if (!caCert.verify(cert)) {
    throw new Error('本地代理证书不是由 MikuMod CA 签发')
  }
  const altNameExt = cert.getExtension('subjectAltName')
  const names = (altNameExt?.altNames || [])
    .filter(item => item.type === 2)
    .map(item => String(item.value || '').toLowerCase())
  if (!names.includes(domain.toLowerCase())) {
    throw new Error(`本地代理证书域名不匹配：${domain}`)
  }
}

function waitForLocalProxyHealth(domain, caCert) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: '127.0.0.1',
      port: PROXY_PORT,
      path: HEALTH_CHECK_PATH,
      method: 'GET',
      servername: domain,
      headers: {
        host: domain,
        'x-mikumod-health-check': '1',
      },
      rejectUnauthorized: false,
      timeout: 3000,
    }, (res) => {
      try {
        verifyDomainCertWithCA(res.socket.getPeerCertificate(true), domain, caCert)
        res.resume()
        res.on('end', () => {
          if (res.statusCode === 204) resolve()
          else reject(new Error(`本地代理健康检查失败：HTTP ${res.statusCode}`))
        })
      } catch (e) {
        req.destroy()
        reject(e)
      }
    })
    req.on('timeout', () => req.destroy(new Error('本地代理健康检查超时')))
    req.on('error', reject)
    req.end()
  })
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
    keepAliveMsecs: 30000,
    maxSockets: 32,         // Worker 并发连接数
    maxFreeSockets: 8,
  })

  // 使用 https.createServer 同时做 TLS 终止 + HTTP 解析
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
    // 强制 HTTP/1.1，避免 HTTP/2 ALPN 问题
    ALPNProtocols: ['http/1.1'],
  }, (req, res) => {
    // 此处已经拿到解析好的 HTTP 请求
    const domain = normalizeDomain(req.headers.host?.split(':')[0]) || normalizeDomain(req.socket.servername) || 'unknown'

    if (req.url === HEALTH_CHECK_PATH && req.headers['x-mikumod-health-check'] === '1') {
      res.writeHead(204, { 'cache-control': 'no-store' })
      res.end()
      return
    }

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
    const domain = normalizeDomain(req.headers.host?.split(':')[0]) || 'unknown'
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

function listenProxyServer(server) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`端口 ${PROXY_PORT} 已被占用，请关闭占用 443 端口的程序`))
      } else if (err.code === 'EACCES') {
        reject(new Error('需要管理员权限来监听 443 端口'))
      } else reject(err)
    }
    server.once('error', onError)
    server.listen(PROXY_PORT, '127.0.0.1', () => {
      server.off('error', onError)
      console.log(`[Accelerator] Reverse proxy on 127.0.0.1:${PROXY_PORT}`)
      resolve()
    })
  })
}

async function ensureProxyServerReady(caCert) {
  clearProxyShutdownTimer()

  if (acceleratorState.proxyServer) {
    try {
      await waitForLocalProxyHealth('localhost', caCert)
      return
    } catch (err) {
      console.warn(`[Accelerator] Existing proxy health check failed, recreating: ${err.message}`)
      await stopProxyServer()
    }
  }

  const server = createProxyServer()
  acceleratorState.proxyServer = server
  await listenProxyServer(server)
  await waitForLocalProxyHealth('localhost', caCert)
}

/**
 * HTTP 级别请求转发
 * 不发 SNI 绕过 GFW，用 Host header 让目标服务器正确路由
 */
function getResolvedCandidates(domain, primaryIP) {
  const candidates = []
  const seen = new Set()
  const add = (ip) => {
    if (!net.isIP(ip) || seen.has(ip)) return
    seen.add(ip)
    candidates.push(ip)
  }
  add(primaryIP)
  for (const ip of acceleratorState.resolvedCandidates[domain] || []) add(ip)
  return candidates
}

function isRetryableRequestMethod(method) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase())
}

function createUpstreamOptions(clientReq, domain, ip, servername) {
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
    agent: acceleratorState.keepAliveAgent,
  }
}

function forwardRequest(clientReq, clientRes, domain, realIP) {
  // 判断是否需要走 Worker 中转
  if (needsWorkerRelay(domain)) {
    return forwardViaWorker(clientReq, clientRes, domain)
  }

  const options = createUpstreamOptions(clientReq, domain, realIP, '')
  const proxyReq = https.request(options, (proxyRes) => {
    acceleratorState.resolved[domain] = realIP
    // 转发响应状态码和 headers
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers)
    // 流式转发响应体
    proxyRes.pipe(clientRes)
  })

  let failed = false
  const failover = (err) => {
    if (failed) return
    failed = true
    console.error(`[Accelerator] Upstream error for ${domain} via ${realIP}: ${err.message}`)
    retryWithSNI(clientReq, clientRes, domain, realIP, err)
  }

  proxyReq.on('error', (err) => {
    failover(err)
  })

  proxyReq.on('timeout', () => {
    const err = new Error(`connect ETIMEDOUT ${realIP}:443`)
    failover(err)
    proxyReq.destroy()
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
  const relayConfig = getWorkerRelayConfig()
  if (!relayConfig.url || !relayConfig.secret) {
    if (!clientRes.headersSent) {
      clientRes.writeHead(503)
      clientRes.end('Worker relay is not configured. Please set WORKER_RELAY_URL and WORKER_RELAY_SECRET, then restart the app.')
    }
    return
  }

  let workerBaseUrl
  let workerUrl
  try {
    workerBaseUrl = new URL(relayConfig.url)
    workerUrl = new URL(clientReq.url, workerBaseUrl)
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
function retryWithSNI(clientReq, clientRes, domain, realIP, lastError) {
  if (clientRes.headersSent) return
  if (!isRetryableRequestMethod(clientReq.method)) {
    clientRes.writeHead(502)
    clientRes.end(`Bad Gateway: ${lastError?.message || 'upstream connection failed'}`)
    return
  }

  const candidates = getResolvedCandidates(domain, realIP)
  const attempts = []
  candidates.forEach((ip) => {
    if (ip !== realIP) attempts.push({ ip, servername: '' })
    attempts.push({ ip, servername: domain })
  })

  const tryAttempt = (index, previousError) => {
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
      clientRes.writeHead(proxyRes.statusCode, proxyRes.headers)
      proxyRes.pipe(clientRes)
    })

    let failed = false
    const fail = (err) => {
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
    const results = {}
    const candidateResults = {}
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

  // === 启动加速 ===
  ipcMain.handle('accelerator-start', async (_e, enabledDomains) => {
    if (acceleratorState.running) return { success: false, error: '加速已在运行' }

    const safeDomains = normalizeEnabledDomains(enabledDomains)
    if (safeDomains.length === 0) return { success: false, error: '请至少选择一个有效域名' }

    try {
      stopHostsSelfHeal()
      const preCleanResult = removeHosts()
      if (!preCleanResult.success) return { success: false, error: `清理残留 hosts 失败：${preCleanResult.error}` }

      const relayConfig = getWorkerRelayConfig()
      const relayDomains = findDomainsRequiringWorkerRelay(safeDomains)
      if (relayDomains.length > 0 && (!relayConfig.url || !relayConfig.secret)) {
        return {
          success: false,
          error: getWorkerRelayMissingConfigMessage(relayDomains),
        }
      }

      // 1. CA 证书
      const ca = loadOrCreateCA()
      const fingerprint = getCertFingerprint(ca.forgeCert)
      acceleratorState.caKey = ca.forgeKey
      acceleratorState.caCert = ca.forgeCert
      if (acceleratorState.caFingerprint !== fingerprint) {
        acceleratorState.certCache = {}
        acceleratorState.caFingerprint = fingerprint
      }

      // 2. 安装到系统信任存储
      const certDir = ensureCertDir()
      const derPath = path.join(certDir, 'mikumod_ca.cer')
      fs.writeFileSync(derPath, certToDerBuffer(ca.forgeCert))

      if (!installCATrust(derPath, fingerprint)) {
        uninstallCATrust()
        return { success: false, error: 'CA 证书未被系统信任，请以管理员权限启动并允许安装根证书' }
      }

      // 3. DoH 解析
      const toResolve = safeDomains.filter(d => !d.forward_ip)
      const results = {}
      const candidateResults = {}
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
        uninstallCATrust()
        return { success: false, error: '所选域名解析失败，未修改系统 hosts' }
      }

      acceleratorState.resolved = results
      acceleratorState.resolvedCandidates = candidateResults

      // 4. 启动本地反向代理
      await ensureProxyServerReady(ca.forgeCert)

      // 5. hosts 指向 127.0.0.1
      const hostsResult = applyHostsProxy(domainList)
      if (!hostsResult.success) {
        await stopProxyServer()
        resetRuntimeState()
        uninstallCATrust()
        return hostsResult
      }

      acceleratorState.running = true
      startHostsSelfHeal(domainList)
      warmupDomainCertificatesAsync(domainList)

      const hostsMap = {}
      domainList.forEach(d => { hostsMap[d] = acceleratorState.resolved[d] })
      return { success: true, hostsMap }
    } catch (e) {
      removeHosts()
      await stopProxyServer()
      resetRuntimeState()
      uninstallCATrust()
      return { success: false, error: e.message }
    }
  })

  // === 停止加速 ===
  ipcMain.handle('accelerator-stop', async () => {
    acceleratorState.hostsSelfHealPaused = true
    const result = removeHosts()
    if (!result.success) {
      acceleratorState.hostsSelfHealPaused = false
      return result
    }
    stopHostsSelfHeal()
    resetRuntimeState({ preserveResolved: true })
    scheduleProxyWarmShutdown()
    return result
  })

  ipcMain.handle('accelerator-repair', async () => {
    acceleratorState.hostsSelfHealPaused = true
    const result = removeHosts()
    if (!result.success) {
      acceleratorState.hostsSelfHealPaused = false
      return result
    }
    stopHostsSelfHeal()
    await stopProxyServer()
    resetRuntimeState()
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
  stopHostsSelfHeal()
  clearProxyShutdownTimer()
  acceleratorState.running = false
  try {
    removeHosts()
  } catch {}
  if (acceleratorState.proxyServer) {
    try { acceleratorState.proxyServer.close() } catch {}
    acceleratorState.proxyServer = null
  }
  if (acceleratorState.keepAliveAgent) {
    acceleratorState.keepAliveAgent.destroy()
    acceleratorState.keepAliveAgent = null
  }
  resetRuntimeState()
}

module.exports = { registerAcceleratorIPC, cleanupOnExit }
