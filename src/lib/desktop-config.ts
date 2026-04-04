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

const defaultApiBaseUrl = import.meta.env.VITE_API_BASE_URL || "https://mikumod.com/api"
const defaultWebBaseUrl = import.meta.env.VITE_WEB_BASE_URL || "https://mikumod.com"

export const DEFAULT_SETTINGS: DesktopSettings = {
  downloadDirectory: "D:\\MikuMod\\downloads",
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
  return readJson(SETTINGS_KEY, DEFAULT_SETTINGS)
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
}
