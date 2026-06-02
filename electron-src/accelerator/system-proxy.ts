import {
  SYSTEM_PROXY_PORT,
  PAC_PATH,
  SYSTEM_PROXY_SNAPSHOT_FILE,
} from './constants'
import {
  runPowerShell,
  escapePowerShellSingleQuotedString,
  readJsonSnapshot,
  writeJsonSnapshot,
  removeJsonSnapshot,
  joinMessages,
} from './utils'

export function getSystemProxyPacUrl() {
  return `http://127.0.0.1:${SYSTEM_PROXY_PORT}${PAC_PATH}`
}

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

export { joinMessages }
