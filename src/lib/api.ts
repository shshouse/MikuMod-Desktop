import { getDesktopSettings } from "./desktop-config"
import { supabase } from './supabase'

export function getApiBase() {
  if (typeof window !== "undefined") {
    return getDesktopSettings().apiBaseUrl
  }

  return import.meta.env.VITE_API_BASE_URL || 'https://mikumod.com/api'
}

async function requestJson(url: string, options: RequestInit = {}) {
  if (typeof window !== "undefined" && window.electronAPI?.httpRequest) {
    const result = await window.electronAPI.httpRequest(url, options)
    if (!result.ok) {
      throw new Error(`HTTP error ${result.status}`)
    }
    return JSON.parse(result.text)
  }

  const res = await fetch(url, options)
  if (!res.ok) {
    throw new Error(`HTTP error ${res.status}`)
  }
  return res.json()
}

export async function fetchMods(params: { q?: string; page?: number; limit?: number } = {}) {
  const url = new URL(`${getApiBase()}/search`)
  if (params.q) url.searchParams.set('q', params.q)
  if (params.page !== undefined) url.searchParams.set('page', params.page.toString())
  if (params.limit !== undefined) url.searchParams.set('limit', params.limit.toString())

  const json = await requestJson(url.toString())
  
  if (!json.success) throw new Error(json.error || 'Failed to fetch mods')
  return json.data // { mods, total }
}

export async function getDownloadToken(modId: string, versionId?: string) {
  const url = new URL(`${getApiBase()}/mods/${modId}/download`)
  if (versionId) url.searchParams.set('version_id', versionId)
  
  const json = await requestJson(url.toString())

  if (!json.success) throw new Error(json.error || 'Failed to get download token')
  return json.data // { url, fileName, fileSize, version, expiresAt }
}

export async function fetchGames() {
  const url = new URL(`${getApiBase()}/games/list`)
  const json = await requestJson(url.toString())
  if (!json.success) throw new Error(json.error || 'Failed to fetch games')
  return json.data
}

export async function fetchPosts(params: { category?: string; gameId?: string; page?: number; limit?: number } = {}) {
  const url = new URL(`${getApiBase()}/community/forum`)
  if (params.category) url.searchParams.set('category', params.category)
  if (params.gameId) url.searchParams.set('game_id', params.gameId)
  if (params.page !== undefined) url.searchParams.set('page', params.page.toString())
  if (params.limit !== undefined) url.searchParams.set('limit', params.limit.toString())

  const json = await requestJson(url.toString())
  
  if (!json.success) throw new Error(json.error || 'Failed to fetch posts')
  return json.data
}

export async function authenticatedFetch(url: string, options: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  
  const headers = new Headers(options.headers || {})
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }

  const json = await requestJson(url, { ...options, headers })
  if (!json.success) throw new Error(json.error || 'API Request Failed')
  return json.data
}

export async function fetchMyProfile(userId: string) {
  const url = new URL(`${getApiBase()}/profile?userId=${userId}`)
  const json = await requestJson(url.toString())
  if (!json.success) throw new Error(json.error || 'Failed to fetch profile')
  return json.data
}

export async function fetchUnreadNotifications() {
  const data = await authenticatedFetch(`${getApiBase()}/notifications?limit=1&unread_only=true`)
  return data.unread_count
}
