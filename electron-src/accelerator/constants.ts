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
export const GIT_PROXY_SNAPSHOT_FILE = 'accelerator_git_proxy_snapshot.json'
export const HOSTS_SELF_HEAL_DEBOUNCE_MS = 800
export const HOSTS_SELF_HEAL_IGNORE_MS = 1500
export const HOSTS_WATCHER_RETRY_MS = 1000
export const PROXY_WARM_IDLE_MS = 15000

export const STEAM_ACCELERATOR_DOMAINS = [
  'steamcdn-a.akamaihd.net', 'cdn.akamai.steamstatic.com', 'steamcommunity-a.akamaihd.net',
  'media.steampowered.com', 'steamcommunity.com', 'store.steampowered.com',
  'api.steampowered.com', 'login.steampowered.com', 'help.steampowered.com',
]

export const GITHUB_RELAY_DOMAINS = [
  'github.com', 'github.dev', 'api.github.com', 'github.githubassets.com',
  'education.github.com', 'resources.github.com', 'uploads.github.com',
  'archiveprogram.github.com', 'raw.githubusercontent.com', 'avatars.githubusercontent.com',
  'objects.githubusercontent.com', 'desktop.githubusercontent.com', 'media.githubusercontent.com',
  'camo.githubusercontent.com', 'github.io', 'gist.github.com', 'copilot.github.com',
  'alive.github.com', 'collector.github.com', 'favicons.githubusercontent.com',
  'user-images.githubusercontent.com', 'private-user-images.githubusercontent.com',
  'repository-images.githubusercontent.com', 'opengraph.githubassets.com',
  'github-cloud.s3.amazonaws.com', 'github-releases.githubusercontent.com',
  'github-registry-files.githubusercontent.com', 'pkg-containers.githubusercontent.com',
  'central.github.com', 'pipelines.actions.githubusercontent.com', 'gist.githubusercontent.com',
  'private-avatars.githubusercontent.com', 'secured-user-images.githubusercontent.com',
  'objects-origin.githubusercontent.com', 'release-assets.githubusercontent.com',
  'marketplace-screenshots.githubusercontent.com', 'identicons.github.com',
  'insights.github.com', 'www.githubstatus.com',
  'github-production-repository-file-5c1aeb.s3.amazonaws.com',
  'github-production-upload-manifest-file-7fdce7.s3.amazonaws.com',
  'github-production-user-asset-6210df.s3.amazonaws.com',
  'github-production-repository-image-32fea6.s3.amazonaws.com',
  'github-production-release-asset-2e65be.s3.amazonaws.com',
]

export const LEGACY_ACCELERATOR_HOSTS_DOMAINS = new Set([
  ...STEAM_ACCELERATOR_DOMAINS,
  ...GITHUB_RELAY_DOMAINS,
  'twitch.tv', 'www.twitch.tv', 'api.twitch.tv', 'ttvnw.net',
  'www.recaptcha.net', 'fonts.googleapis.com', 'fonts.gstatic.com',
])

export const WORKER_RELAY_DOMAINS = new Set(GITHUB_RELAY_DOMAINS)

export const SUPPORTED_ACCELERATOR_DOMAINS = new Set([
  ...STEAM_ACCELERATOR_DOMAINS,
  ...GITHUB_RELAY_DOMAINS,
])

export const GITHUB_WEB_DEPENDENCY_DOMAINS = [
  'github.githubassets.com',
  'avatars.githubusercontent.com',
  'private-avatars.githubusercontent.com',
  'favicons.githubusercontent.com',
  'raw.githubusercontent.com',
  'media.githubusercontent.com',
  'camo.githubusercontent.com',
  'user-images.githubusercontent.com',
  'private-user-images.githubusercontent.com',
  'secured-user-images.githubusercontent.com',
  'repository-images.githubusercontent.com',
  'opengraph.githubassets.com',
  'objects.githubusercontent.com',
  'objects-origin.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-cloud.s3.amazonaws.com',
  'github-releases.githubusercontent.com',
  'github-production-user-asset-6210df.s3.amazonaws.com',
  'github-production-repository-image-32fea6.s3.amazonaws.com',
  'github-production-release-asset-2e65be.s3.amazonaws.com',
]

export const GIT_PROXY_DOMAINS = new Set([
  'github.com',
  'api.github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'github-registry-files.githubusercontent.com',
  'pkg-containers.githubusercontent.com',
  'gist.github.com',
  'gist.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-production-release-asset-2e65be.s3.amazonaws.com',
])
