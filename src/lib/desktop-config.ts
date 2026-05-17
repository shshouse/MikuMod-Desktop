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
const LEGACY_DEFAULT_DOWNLOAD_DIRECTORIES = new Set(["D:\\MikuMod\\downloads", "D:/MikuMod/downloads"])

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

  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function getCustomGames(): CustomGameEntry[] {
  return readJson<CustomGameEntry[]>(CUSTOM_GAMES_KEY, [])
}

export function saveCustomGames(games: CustomGameEntry[]) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(CUSTOM_GAMES_KEY, JSON.stringify(games))
}

export function getLocalGamePaths(): Record<string, string> {
  return readJson<Record<string, string>>(GAME_PATHS_KEY, {})
}

export function saveLocalGamePaths(paths: Record<string, string>) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(GAME_PATHS_KEY, JSON.stringify(paths))
  for (const localPath of Object.values(paths)) {
    if (localPath) {
      void window.electronAPI?.authorizeDirectory?.(localPath)
    }
  }
}
