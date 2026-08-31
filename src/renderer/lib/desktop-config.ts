export interface DesktopSettings {
  downloadDirectory: string
  apiBaseUrl: string
  webBaseUrl: string
}

export interface CustomGameEntry {
  id: string
  name: string
  localPath: string
  addedAt: string
}

const SETTINGS_KEY = "mikumod_desktop_settings"
const CUSTOM_GAMES_KEY = "mikumod_desktop_custom_games"
const GAME_PATHS_KEY = "mikumod_local_paths"
const DOWNLOAD_TASKS_KEY = "mikumod_desktop_download_tasks"
const PERSISTED_KEYS = [SETTINGS_KEY, CUSTOM_GAMES_KEY, GAME_PATHS_KEY, DOWNLOAD_TASKS_KEY] as const
const CONFIG_FILENAME = "config.json"
const LEGACY_DEFAULT_DOWNLOAD_DIRECTORIES = new Set(["D:\\MikuMod\\downloads", "D:/MikuMod/downloads"])
let cachedDataDir: string | null = null

async function getDataDir() {
  if (cachedDataDir) return cachedDataDir
  if (typeof window === "undefined" || !window.electronAPI) return null
  try { cachedDataDir = await window.electronAPI.getAppDataDir() } catch { /* empty */ }
  return cachedDataDir
}

async function readConfigFile(): Promise<Record<string, string>> {
  const dir = await getDataDir()
  if (!dir) return {}
  try {
    const raw = await window.electronAPI.readFile(`${dir}\\${CONFIG_FILENAME}`)
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {}
  } catch { return {} }
}

async function writeConfigFile(data: Record<string, string>) {
  const dir = await getDataDir()
  if (!dir) return
  try { await window.electronAPI.writeFile(`${dir}\\${CONFIG_FILENAME}`, JSON.stringify(data)) } catch { /* empty */ }
}

export function persistKey(key: string, value: string) {
  void (async () => {
    const all = await readConfigFile()
    all[key] = value
    await writeConfigFile(all)
  })()
}

export async function initDesktopConfig() {
  if (typeof window === "undefined" || !window.electronAPI) return
  const stored = await readConfigFile()
  for (const key of PERSISTED_KEYS) {
    if (stored[key] && !window.localStorage.getItem(key)) {
      window.localStorage.setItem(key, stored[key])
    }
  }
}

const defaultApiBaseUrl = import.meta.env.VITE_API_BASE_URL || "https://mikumod.com/api"
const defaultWebBaseUrl = import.meta.env.VITE_WEB_BASE_URL || "https://mikumod.com"

export const DEFAULT_SETTINGS: DesktopSettings = {
  downloadDirectory: "",
  apiBaseUrl: defaultApiBaseUrl,
  webBaseUrl: defaultWebBaseUrl,
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback
  }

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) {
      return fallback
    }

    const parsed = JSON.parse(raw)
    if (Array.isArray(fallback)) {
      return (Array.isArray(parsed) ? parsed : fallback) as T
    }

    if (fallback && typeof fallback === "object" && parsed && typeof parsed === "object") {
      return { ...fallback, ...parsed }
    }

    return parsed as T
  } catch {
    return fallback
  }
}

export function getDesktopSettings(): DesktopSettings {
  const settings = readJson(SETTINGS_KEY, DEFAULT_SETTINGS)
  if (settings.downloadDirectory || LEGACY_DEFAULT_DOWNLOAD_DIRECTORIES.has(settings.downloadDirectory)) {
    return { ...settings, downloadDirectory: "" }
  }

  return settings
}

export function saveDesktopSettings(settings: DesktopSettings) {
  if (typeof window === "undefined") {
    return
  }

  const json = JSON.stringify(settings)
  window.localStorage.setItem(SETTINGS_KEY, json)
  persistKey(SETTINGS_KEY, json)
}

export function getCustomGames(): CustomGameEntry[] {
  return readJson<CustomGameEntry[]>(CUSTOM_GAMES_KEY, [])
}

export function saveCustomGames(games: CustomGameEntry[]) {
  if (typeof window === "undefined") {
    return
  }

  const json = JSON.stringify(games)
  window.localStorage.setItem(CUSTOM_GAMES_KEY, json)
  persistKey(CUSTOM_GAMES_KEY, json)
}

export function getLocalGamePaths(): Record<string, string> {
  return readJson<Record<string, string>>(GAME_PATHS_KEY, {})
}

export function saveLocalGamePaths(paths: Record<string, string>) {
  if (typeof window === "undefined") {
    return
  }

  const json = JSON.stringify(paths)
  window.localStorage.setItem(GAME_PATHS_KEY, json)
  persistKey(GAME_PATHS_KEY, json)
  for (const localPath of Object.values(paths)) {
    if (localPath) {
      void window.electronAPI?.authorizeDirectory?.(localPath)
    }
  }
}
