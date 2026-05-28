import {
  SYSTEM_PROXY_PORT,
  PAC_PATH,
  SYSTEM_PROXY_SNAPSHOT_FILE,
  GIT_PROXY_SNAPSHOT_FILE,
  GIT_PROXY_DOMAINS,
} from './constants'
import {
  runPowerShell,
  escapePowerShellSingleQuotedString,
  readGitConfig,
  writeGitConfig,
  isGitAvailable,
  readJsonSnapshot,
  writeJsonSnapshot,
  removeJsonSnapshot,
  joinMessages,
} from './utils'
import { normalizeDomain } from './domains'

// --- PAC URL ---

export function getSystemProxyPacUrl() {
  return `http://127.0.0.1:${SYSTEM_PROXY_PORT}${PAC_PATH}`
}

// --- Windows 代理注册表 ---

function systemProxyNotifyScript() {
  return `
$source = @"
using System;
using System.Runtime.InteropServices;
public static class MikuModInternetSettings {
  [DllImport("wininet.dll", SetLastError = true)]
  public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
}
"@
if (-not ("MikuModInternetSettings" -as [type])) { Add-Type -TypeDefinition $source }
[MikuModInternetSettings]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
[MikuModInternetSettings]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null
`
}

interface SystemProxySettings {
  ProxyEnable: number | null
  ProxyServer: string | null
  AutoConfigURL: string | null
}

async function readSystemProxySettings(): Promise<SystemProxySettings> {
  if (process.platform !== 'win32') return { ProxyEnable: null, ProxyServer: null, AutoConfigURL: null }
  const script = `
$path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
$props = Get-ItemProperty -Path $path
[pscustomobject]@{
  ProxyEnable = if ($null -ne $props.ProxyEnable) { [int]$props.ProxyEnable } else { $null }
  ProxyServer = if ($null -ne $props.ProxyServer) { [string]$props.ProxyServer } else { $null }
  AutoConfigURL = if ($null -ne $props.AutoConfigURL) { [string]$props.AutoConfigURL } else { $null }
} | ConvertTo-Json -Compress
`
  const output = (await runPowerShell(script)).trim()
  return JSON.parse(output)
}

async function writeSystemProxySettings(settings: SystemProxySettings) {
  if (process.platform !== 'win32') return
  const proxyEnable = settings.ProxyEnable === null || settings.ProxyEnable === undefined
    ? null
    : Number(settings.ProxyEnable) ? 1 : 0
  const proxyServer = settings.ProxyServer ? escapePowerShellSingleQuotedString(settings.ProxyServer) : null
  const autoConfigUrl = settings.AutoConfigURL ? escapePowerShellSingleQuotedString(settings.AutoConfigURL) : null
  const script = `
$path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
${proxyEnable === null
    ? "Remove-ItemProperty -Path $path -Name ProxyEnable -ErrorAction SilentlyContinue"
    : `New-ItemProperty -Path $path -Name ProxyEnable -Value ${proxyEnable} -PropertyType DWord -Force | Out-Null`}
${proxyServer === null
    ? "Remove-ItemProperty -Path $path -Name ProxyServer -ErrorAction SilentlyContinue"
    : `New-ItemProperty -Path $path -Name ProxyServer -Value '${proxyServer}' -PropertyType String -Force | Out-Null`}
${autoConfigUrl === null
    ? "Remove-ItemProperty -Path $path -Name AutoConfigURL -ErrorAction SilentlyContinue"
    : `New-ItemProperty -Path $path -Name AutoConfigURL -Value '${autoConfigUrl}' -PropertyType String -Force | Out-Null`}
${systemProxyNotifyScript()}
`
  await runPowerShell(script)
}

export async function applySystemProxyPac() {
  const snapshot = readJsonSnapshot(SYSTEM_PROXY_SNAPSHOT_FILE)
  const current = await readSystemProxySettings()
  if (!snapshot) writeJsonSnapshot(SYSTEM_PROXY_SNAPSHOT_FILE, current)
  await writeSystemProxySettings({
    ProxyEnable: 0,
    ProxyServer: current.ProxyServer || null,
    AutoConfigURL: getSystemProxyPacUrl(),
  })
}

export async function restoreSystemProxySettings() {
  const snapshot = readJsonSnapshot(SYSTEM_PROXY_SNAPSHOT_FILE)
  if (snapshot) {
    await writeSystemProxySettings(snapshot)
    removeJsonSnapshot(SYSTEM_PROXY_SNAPSHOT_FILE)
    return { changed: true }
  }
  try {
    const current = await readSystemProxySettings()
    if (current.AutoConfigURL === getSystemProxyPacUrl()) {
      await writeSystemProxySettings({ ...current, AutoConfigURL: null })
      return { changed: true }
    }
  } catch {}
  return { changed: false }
}

export async function hasSystemProxyResidual() {
  if (readJsonSnapshot(SYSTEM_PROXY_SNAPSHOT_FILE)) return true
  try {
    const current = await readSystemProxySettings()
    return current.AutoConfigURL === getSystemProxyPacUrl()
  } catch {
    return false
  }
}

// --- Git 代理 ---

function getGitProxyDomains(domainList: string[]) {
  const selected = new Set(domainList.map(normalizeDomain).filter(Boolean) as string[])
  if (selected.has('github.com')) {
    selected.add('api.github.com')
    selected.add('raw.githubusercontent.com')
    selected.add('objects.githubusercontent.com')
    selected.add('github-releases.githubusercontent.com')
    selected.add('release-assets.githubusercontent.com')
  }
  return [...selected].filter(domain => GIT_PROXY_DOMAINS.has(domain))
}

function getGitProxyConfigKey(domain: string) {
  return `http.https://${domain}.proxy`
}

export async function applyGitProxyConfig(domainList: string[]) {
  const domains = getGitProxyDomains(domainList)
  if (domains.length === 0) return { changed: false }
  if (!await isGitAvailable()) return { changed: false, warning: '\u672a\u68c0\u6d4b\u5230 Git\uff0c\u5df2\u8df3\u8fc7 GitHub Git \u4ee3\u7406\u914d\u7f6e' }
  const snapshot = readJsonSnapshot(GIT_PROXY_SNAPSHOT_FILE)
  if (!snapshot) {
    const original: Record<string, string | null> = {}
    for (const domain of domains) {
      original[domain] = await readGitConfig(['--global', '--get', getGitProxyConfigKey(domain)]) || null
    }
    writeJsonSnapshot(GIT_PROXY_SNAPSHOT_FILE, original)
  }
  try {
    for (const domain of domains) {
      await writeGitConfig(['--global', getGitProxyConfigKey(domain), `http://127.0.0.1:${SYSTEM_PROXY_PORT}`])
    }
    return { changed: true }
  } catch (e: any) {
    return { changed: false, warning: `GitHub Git \u4ee3\u7406\u914d\u7f6e\u5931\u8d25\uff1a${e.message}` }
  }
}

export async function restoreGitProxyConfig() {
  const snapshot = readJsonSnapshot(GIT_PROXY_SNAPSHOT_FILE)
  if (!snapshot) return { changed: false }
  if (!await isGitAvailable()) return { changed: false, warning: '\u672a\u68c0\u6d4b\u5230 Git\uff0c\u65e0\u6cd5\u6062\u590d Git \u4ee3\u7406\u914d\u7f6e' }
  for (const [domain, value] of Object.entries(snapshot)) {
    const key = getGitProxyConfigKey(domain)
    if (value) await writeGitConfig(['--global', key, value as string])
    else {
      try { await writeGitConfig(['--global', '--unset-all', key]) } catch {}
    }
  }
  removeJsonSnapshot(GIT_PROXY_SNAPSHOT_FILE)
  return { changed: true }
}

export async function repairGitSchannelConfig() {
  if (process.platform !== 'win32') return { changed: false }
  if (!await isGitAvailable()) return { changed: false }

  const effectiveBackend = (await readGitConfig(['--get', 'http.sslBackend'])).toLowerCase()
  const globalCAInfo = await readGitConfig(['--global', '--get', 'http.sslCAInfo'])
  const needsBackendFix = effectiveBackend !== 'schannel'
  const needsCAInfoFix = Boolean(globalCAInfo)

  if (!needsBackendFix && !needsCAInfoFix) {
    const schannelUseSSLCAInfo = (await readGitConfig(['--global', '--get', 'http.schannelUseSSLCAInfo'])).toLowerCase()
    const schannelCheckRevoke = (await readGitConfig(['--global', '--get', 'http.schannelCheckRevoke'])).toLowerCase()
    if (schannelUseSSLCAInfo === 'false' && schannelCheckRevoke === 'false') return { changed: false }
  }

  try {
    if (needsBackendFix) await writeGitConfig(['--global', 'http.sslBackend', 'schannel'])
    if (needsCAInfoFix) {
      try { await writeGitConfig(['--global', '--unset', 'http.sslCAInfo']) } catch {}
    }
    await writeGitConfig(['--global', 'http.schannelUseSSLCAInfo', 'false'])
    await writeGitConfig(['--global', 'http.schannelCheckRevoke', 'false'])
    return { changed: true, warning: '\u5df2\u4fee\u590d Git for Windows \u8bc1\u4e66\u914d\u7f6e\uff0cGit \u5c06\u4f7f\u7528 Windows \u7cfb\u7edf\u4fe1\u4efb\u5b58\u50a8' }
  } catch (e: any) {
    return { changed: false, warning: `Git \u8bc1\u4e66\u914d\u7f6e\u4fee\u590d\u5931\u8d25\uff1a${e.message}` }
  }
}

export { joinMessages }
