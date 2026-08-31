import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import https from 'https'
import { execFileSync } from 'child_process'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const forge = require('node-forge')
import { app } from 'electron'
import {
  CA_CERT_FILE,
  CA_KEY_FILE,
  CA_COMMON_NAME,
  HEALTH_CHECK_PATH,
  CERT_PREWARM_DOMAIN_COUNT,
} from './constants'
import { acceleratorState, type ForgeCert } from './state'
import { runProcess, runPowerShell, escapePowerShellSingleQuotedString, normalizeHex } from './utils'
import { normalizeDomain } from './domains'

// --- 目录 ---

export function getCertDir() {
  return path.join(app.getPath('userData'), 'certs')
}

export function ensureCertDir() {
  const dir = getCertDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

// --- 根 CA ---

export function generateRootCA() {
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

export function certToDerBuffer(forgeCert: ForgeCert) {
  return Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(forgeCert)).getBytes(),
    'binary'
  )
}

export function getCertFingerprint(forgeCert: ForgeCert) {
  return crypto.createHash('sha1').update(certToDerBuffer(forgeCert)).digest('hex').toUpperCase()
}

function isCAKeyPairValid(forgeCert: ForgeCert, forgeKey: any) {
  try {
    const publicKey = forgeCert.publicKey
    return Boolean(
      publicKey.n && forgeKey.n && publicKey.e && forgeKey.e
      && publicKey.n.equals(forgeKey.n) && publicKey.e.equals(forgeKey.e)
    )
  } catch {
    return false
  }
}

function protectFile(filePath: string) {
  try {
    execFileSync('icacls', [filePath, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`], { windowsHide: true })
  } catch {}
}

export function loadOrCreateCA() {
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
        protectFile(keyPath)
        return { key: keyPem, cert: certPem, forgeKey, forgeCert }
      }
    } catch {}
  }

  const ca = generateRootCA()
  fs.writeFileSync(certPath, ca.cert, 'utf-8')
  fs.writeFileSync(keyPath, ca.key, 'utf-8')
  protectFile(keyPath)
  protectFile(certPath)
  return ca
}

// --- 系统信任存储 ---

async function removeMikuModRootCerts(keepFingerprint = '') {
  const keep = normalizeHex(keepFingerprint)
  const name = escapePowerShellSingleQuotedString(CA_COMMON_NAME)
  const script = `
$storePaths = @('Cert:\\LocalMachine\\Root', 'Cert:\\CurrentUser\\Root')
$keep = '${keep}'
$name = '${name}'
$removed = 0
$errors = 0
foreach ($storePath in $storePaths) {
  Get-ChildItem $storePath -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -like "*$name*" } |
    Where-Object { -not $keep -or (($_.Thumbprint -replace '[^0-9A-Fa-f]', '').ToUpperInvariant() -ne $keep) } |
    ForEach-Object {
      try {
        Remove-Item -LiteralPath $_.PSPath -Force -ErrorAction Stop
        $removed++
      } catch {
        $errors++
      }
    }
}
if ($errors -gt 0) { throw "Failed to remove $errors MikuMod CA certificate(s)" }
Write-Output $removed
`
  const output = (await runPowerShell(script)).trim()
  const lines = output.split(/\r?\n/).filter(Boolean)
  return Number(lines[lines.length - 1] || 0) || 0
}

async function isCATrusted(expectedFingerprint: string) {
  try {
    const output = await runProcess('certutil', ['-store', 'Root', expectedFingerprint])
    return output.includes(CA_COMMON_NAME) && normalizeHex(output).includes(normalizeHex(expectedFingerprint))
  } catch {}
  return false
}

export async function installCATrust(derPath: string, expectedFingerprint: string) {
  try {
    await removeMikuModRootCerts()
  } catch (e: any) {
    console.error('[Accelerator] stale CA cleanup failed:', e.message)
    return false
  }
  try {
    await runProcess('certutil', ['-f', '-addstore', 'Root', derPath])
    const trusted = await isCATrusted(expectedFingerprint)
    if (trusted) console.log('[Accelerator] CA certificate installed successfully')
    return trusted
  } catch (e: any) {
    console.error('[Accelerator] CA install failed:', e.message)
    return false
  }
}

export async function uninstallCATrust() {
  try {
    const removed = await removeMikuModRootCerts()
    if (removed > 0) console.log('[Accelerator] CA certificate removed from trust store')
  } catch (e: any) {
    console.warn('[Accelerator] CA certificate cleanup failed:', e.message)
  }
}

// --- 域名证书签发 ---

export function generateDomainCert(domain: string) {
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

  const altNames: any[] = [{ type: 2, value: domain }]
  if (!domain.startsWith('*.')) altNames.push({ type: 2, value: `*.${domain}` })

  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames },
    { name: 'subjectKeyIdentifier' },
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

// --- 证书验证 ---

function getPeerCertPem(peerCert: any) {
  if (!peerCert || !peerCert.raw) return null
  return `-----BEGIN CERTIFICATE-----\n${peerCert.raw.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`
}

function verifyDomainCertWithCA(peerCert: any, domain: string, caCert: ForgeCert) {
  const pem = getPeerCertPem(peerCert)
  if (!pem) throw new Error('\u672c\u5730\u4ee3\u7406\u672a\u8fd4\u56de TLS \u8bc1\u4e66')
  const cert = forge.pki.certificateFromPem(pem)
  const now = new Date()
  if (now < cert.validity.notBefore || now > cert.validity.notAfter) {
    throw new Error('\u672c\u5730\u4ee3\u7406\u8bc1\u4e66\u4e0d\u5728\u6709\u6548\u671f\u5185')
  }
  if (!caCert.verify(cert)) {
    throw new Error('\u672c\u5730\u4ee3\u7406\u8bc1\u4e66\u4e0d\u662f\u7531 MikuMod CA \u7b7e\u53d1')
  }
  const altNameExt = cert.getExtension('subjectAltName') as any
  const names = (altNameExt?.altNames || [])
    .filter((item: any) => item.type === 2)
    .map((item: any) => String(item.value || '').toLowerCase())
  if (!names.includes(domain.toLowerCase())) {
    throw new Error(`\u672c\u5730\u4ee3\u7406\u8bc1\u4e66\u57df\u540d\u4e0d\u5339\u914d\uff1a${domain}`)
  }
}

// --- 健康检查 ---

export function waitForLocalProxyHealth(domain: string, caCert: ForgeCert, port = 443): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: '127.0.0.1',
      port,
      path: HEALTH_CHECK_PATH,
      method: 'GET',
      servername: domain,
      headers: { host: domain, 'x-mikumod-health-check': '1' },
      rejectUnauthorized: false,
      timeout: 3000,
    }, (res) => {
      try {
        verifyDomainCertWithCA((res.socket as any).getPeerCertificate(true), domain, caCert)
        res.resume()
        res.on('end', () => {
          if (res.statusCode === 204) resolve()
          else reject(new Error(`\u672c\u5730\u4ee3\u7406\u5065\u5eb7\u68c0\u67e5\u5931\u8d25\uff1aHTTP ${res.statusCode}`))
        })
      } catch (e) {
        req.destroy()
        reject(e)
      }
    })
    req.on('timeout', () => req.destroy(new Error('\u672c\u5730\u4ee3\u7406\u5065\u5eb7\u68c0\u67e5\u8d85\u65f6')))
    req.on('error', reject)
    req.end()
  })
}

// --- 证书预热 ---

export function warmupDomainCertificatesAsync(domains: string[]) {
  const queue = [...new Set(domains.map(normalizeDomain).filter(Boolean))].slice(0, CERT_PREWARM_DOMAIN_COUNT)
  if (queue.length === 0) return
  const runNext = () => {
    const domain = queue.shift()
    if (!domain || !acceleratorState.caKey || !acceleratorState.caCert) return
    try { generateDomainCert(domain) } catch {}
    if (queue.length > 0) setImmediate(runNext)
  }
  setImmediate(runNext)
}
