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

// === Mod Detail ===

export async function fetchModDetail(modNumber: string) {
  const url = new URL(`${getApiBase()}/mods/${modNumber}/download`)
  // We use the search endpoint with a workaround — but actually we can use supabase directly
  // since the desktop has supabase client. Let's use it for richer data.
  const { supabase: sb } = await import('./supabase')

  const { data: mods } = await sb
    .from('mod')
    .select('*,game:games(id,name,game_number),author:users!mod_author_id_fkey(id,user_number,username,avatar_url,bio)')
    .eq('mod_number', modNumber)
    .eq('status', 'approved')
    .limit(1)

  const mod = mods?.[0]
  if (!mod) return null

  const [versionsRes, reviewsRes] = await Promise.all([
    sb
      .from('mod_versions')
      .select('*')
      .eq('mod_id', mod.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
    sb
      .from('mod_reviews')
      .select('*,user:users!mod_reviews_user_id_fkey(id,user_number,username,avatar_url)')
      .eq('mod_id', mod.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  return {
    mod,
    versions: versionsRes.data || [],
    reviews: reviewsRes.data || [],
  }
}

// === Post Detail ===

export async function fetchPostDetail(postId: string) {
  const url = `${getApiBase()}/community/posts/${postId}`
  const json = await requestJson(url)
  if (!json.success) throw new Error(json.error || 'Failed to fetch post')
  return json.data
}

export async function fetchPostReplies(postId: string) {
  const url = `${getApiBase()}/community/posts/${postId}/replies`
  const json = await requestJson(url)
  if (!json.success) throw new Error(json.error || 'Failed to fetch replies')
  return json.data
}

export async function fetchPostLikeStatus(postId: string) {
  try {
    const data = await authenticatedFetch(`${getApiBase()}/community/posts/${postId}/like`)
    return data // { count, liked }
  } catch {
    // Not logged in or error — return defaults
    const url = `${getApiBase()}/community/posts/${postId}/like`
    const json = await requestJson(url)
    if (json.success) return json.data
    return { count: 0, liked: false }
  }
}

export async function togglePostLike(postId: string) {
  const data = await authenticatedFetch(`${getApiBase()}/community/posts/${postId}/like`, {
    method: 'POST',
  })
  return data // { liked, count }
}

export async function submitPostReply(postId: string, content: string, parentId?: number) {
  const body: Record<string, unknown> = { content }
  if (parentId) body.parent_id = parentId

  const data = await authenticatedFetch(`${getApiBase()}/community/posts/${postId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return data
}

// === Notifications ===

export async function fetchNotifications(params: { limit?: number; offset?: number; unread_only?: boolean } = {}) {
  const url = new URL(`${getApiBase()}/notifications`)
  if (params.limit) url.searchParams.set('limit', params.limit.toString())
  if (params.offset) url.searchParams.set('offset', params.offset.toString())
  if (params.unread_only) url.searchParams.set('unread_only', 'true')

  const data = await authenticatedFetch(url.toString())
  return data // { notifications, unread_count, total, has_more }
}

export async function markNotificationsRead(ids?: string[]) {
  const body = ids ? { action: 'read', ids } : { action: 'read_all' }
  const data = await authenticatedFetch(`${getApiBase()}/notifications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return data
}

// === User Profile ===

export async function fetchUserProfile(userNumber: string) {
  const url = `${getApiBase()}/user/${userNumber}`
  const json = await requestJson(url)
  if (!json.success) throw new Error(json.error || 'Failed to fetch user profile')
  return json.data // { profile, stats, recentPosts, recentReviews, recentMods }
}

// === Mod Reviews ===

export async function submitModReview(modId: string, content: string, isPositive: boolean) {
  const data = await authenticatedFetch(`${getApiBase()}/mods/${modId}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, is_positive: isPositive }),
  })
  return data
}
