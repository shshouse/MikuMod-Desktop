import path from 'path'

export const HOSTS_PATH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
export const HOSTS_TAG_START = '# ===== MikuMod Accelerator START ====='
export const HOSTS_TAG_END = '# ===== MikuMod Accelerator END ====='
export const DOH_URLS = [
  'https://223.5.5.5/resolve',
  'https://1.12.12.12/dns-query',
  'https://1.1.1.1/dns-query',
  'https://8.8.8.8/resolve',
]
export const CACHE_FILE = 'accelerate_cache.json'
export const CA_CERT_FILE = 'mikumod_ca.pem'
export const CA_KEY_FILE = 'mikumod_ca_key.pem'
export const CA_COMMON_NAME = 'MikuMod Accelerator CA'
export const PROXY_PORT = 443
export const SYSTEM_PROXY_PORT = 17890
export const SYSTEM_PROXY_MITM_PORT = 17891
export const PAC_PATH = '/mikumod-accelerator.pac'
export const HEALTH_CHECK_PATH = '/__mikumod_accelerator_health'
export const UPSTREAM_TIMEOUT_MS = 10000
export const DOH_PROVIDER_TIMEOUT_MS = 2000
export const DOH_EARLY_RETURN_GRACE_MS = 150
export const DOH_TOTAL_TIMEOUT_MS = 2200
export const CERT_PREWARM_DOMAIN_COUNT = 0
export const SYSTEM_COMMAND_TIMEOUT_MS = 15000
export const GIT_COMMAND_TIMEOUT_MS = 5000
export const DNS_FLUSH_TIMEOUT_MS = 3000
export const SYSTEM_PROXY_SNAPSHOT_FILE = 'accelerator_system_proxy_snapshot.json'
export const HOSTS_SELF_HEAL_DEBOUNCE_MS = 800
export const HOSTS_SELF_HEAL_IGNORE_MS = 1500
export const HOSTS_WATCHER_RETRY_MS = 1000
export const PROXY_WARM_IDLE_MS = 15000

export const SUPPORTED_ACCELERATOR_DOMAINS = new Set([
  'steamcdn-a.akamaihd.net', 'cdn.akamai.steamstatic.com', 'steamcommunity-a.akamaihd.net',
  'media.steampowered.com', 'steamcommunity.com', 'store.steampowered.com',
  'api.steampowered.com', 'login.steampowered.com', 'help.steampowered.com',
])

export const LEGACY_ACCELERATOR_HOSTS_DOMAINS = new Set([
  ...SUPPORTED_ACCELERATOR_DOMAINS,
])
