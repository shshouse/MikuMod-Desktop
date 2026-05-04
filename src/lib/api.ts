import { getDesktopSettings } from "./desktop-config"
import { requestJson } from "./http"
import { supabase } from './supabase'

export function getApiBase() {
  if (typeof window !== "undefined") {
    return getDesktopSettings().apiBaseUrl
  }

  return import.meta.env.VITE_API_BASE_URL || 'https://mikumod.com/api'
}

function resolveApiBase(apiBaseOverride?: string) {
  if (!apiBaseOverride?.trim()) {
    return getApiBase()
  }

  const normalized = apiBaseOverride.trim().replace(/\/+$/, '')
  return normalized.endsWith('/api') ? normalized : `${normalized}/api`
}

export interface GameSummary {
  id: string
  name: string
  game_number?: string
  images?: string[]
  mod_count?: number
  steam_app_id?: string | null
}

export interface ModAuthorSummary {
  username?: string | null
}

export interface ModGameSummary {
  id?: string
  name?: string | null
  game_number?: string
}

export interface SearchModSummary {
  id: string
  title: string
  mod_number?: string
  game?: ModGameSummary | null
  game_id?: string
  author?: ModAuthorSummary | null
  thumbnail_url?: string | null
  download_count?: number
  created_at?: string | null
  tags?: string[] | null
}

export interface FetchModsResponse {
  mods: SearchModSummary[]
  total: number
}

export interface NotificationModSummary {
  mod_number?: string
}

export interface NotificationSummary {
  id: string
  type: string
  title?: string | null
  message?: string | null
  is_read: boolean
  created_at: string
  related_post_id?: string | null
  related_mod?: NotificationModSummary | null
}

export interface FetchNotificationsResponse {
  notifications: NotificationSummary[]
  unread_count: number
  total: number
  has_more: boolean
}

export interface CommunityUserSummary {
  username?: string | null
  avatar_url?: string | null
}

export interface CommunityPostSummary {
  id: string
  title?: string | null
  category?: string | null
  created_at?: string | null
  reply_count?: number | null
  like_count?: number | null
  view_count?: number | null
  image_urls?: string[] | null
  author?: CommunityUserSummary | null
  user?: CommunityUserSummary | null
}

export interface FetchPostsResponse {
  data: CommunityPostSummary[]
  total?: number
  page?: number
  limit?: number
}

export async function fetchMods(params: { q?: string; page?: number; limit?: number } = {}): Promise<FetchModsResponse> {
  const url = new URL(`${getApiBase()}/search`)
  if (params.q) url.searchParams.set('q', params.q)
  if (params.page !== undefined) url.searchParams.set('page', params.page.toString())
  if (params.limit !== undefined) url.searchParams.set('limit', params.limit.toString())

  const json = await requestJson<{ success: boolean; error?: string; data: FetchModsResponse }>(url.toString(), { timeoutMs: 12000 })
  
  if (!json.success) throw new Error(json.error || 'Failed to fetch mods')
  return json.data // { mods, total }
}

export async function getDownloadToken(modId: string, versionId?: string, apiBaseOverride?: string) {
  const url = new URL(`${resolveApiBase(apiBaseOverride)}/mods/${modId}/download`)
  if (versionId) url.searchParams.set('version_id', versionId)
  
  const json = await requestJson<{ success: boolean; error?: string; data: { url: string; fileName?: string; fileSize?: number; version?: string; expiresAt?: number } }>(url.toString(), { timeoutMs: 12000 })
  
  if (!json.success) throw new Error(json.error || 'Failed to get download token')
  return json.data // { url, fileName, fileSize, version, expiresAt }
}

export async function fetchGames(): Promise<GameSummary[]> {
  const url = new URL(`${getApiBase()}/games/list`)
  const json = await requestJson<{ success: boolean; error?: string; data: GameSummary[] }>(url.toString(), { timeoutMs: 12000 })
  if (!json.success) throw new Error(json.error || 'Failed to fetch games')
  return json.data
}

export async function fetchPosts(params: { category?: string; gameId?: string; page?: number; limit?: number } = {}): Promise<FetchPostsResponse> {
  const url = new URL(`${getApiBase()}/community/forum`)
  if (params.category) url.searchParams.set('category', params.category)
  if (params.gameId) url.searchParams.set('game_id', params.gameId)
  if (params.page !== undefined) url.searchParams.set('page', params.page.toString())
  if (params.limit !== undefined) url.searchParams.set('limit', params.limit.toString())

  const json = await requestJson<{ success: boolean; error?: string; data: FetchPostsResponse }>(url.toString(), { timeoutMs: 12000 })
  
  if (!json.success) throw new Error(json.error || 'Failed to fetch posts')
  return json.data
}

export async function authenticatedFetch<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  
  const headers = new Headers(options.headers || {})
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }

  const json = await requestJson<{ success: boolean; error?: string; data: T }>(url, { ...options, headers, timeoutMs: 15000 })
  if (!json.success) throw new Error(json.error || 'API Request Failed')
  return json.data
}

export interface MyProfileSummary {
  username: string
  avatar_url: string | null
}

export async function fetchMyProfile(userId: string): Promise<MyProfileSummary> {
  const url = new URL(`${getApiBase()}/profile?userId=${userId}`)
  const json = await requestJson<{ success: boolean; error?: string; data: MyProfileSummary }>(url.toString(), { timeoutMs: 12000 })
  if (!json.success) throw new Error(json.error || 'Failed to fetch profile')
  return json.data
}

export async function fetchUnreadNotifications() {
  const data = await authenticatedFetch<FetchNotificationsResponse>(`${getApiBase()}/notifications?limit=1&unread_only=true`)
  return data.unread_count
}

export interface ModDetailAuthorSummary {
  id?: string
  user_number?: string | number
  username?: string | null
  avatar_url?: string | null
  bio?: string | null
}

export interface ModDetailGameSummary {
  id?: string
  name?: string | null
  game_number?: string
}

export interface ModDetailSummary {
  id: string
  mod_number: string
  title: string
  summary?: string | null
  description?: string | null
  thumbnail_url?: string | null
  image_urls?: string[] | null
  screenshot_urls?: string[] | null
  tags?: string[] | null
  created_at: string
  download_count?: number | null
  view_count?: number | null
  latest_version?: string | null
  game_id?: string
  game?: ModDetailGameSummary | null
  author?: ModDetailAuthorSummary | null
}

export interface ModVersionSummary {
  id: string
  version_number?: string | null
  changelog?: string | null
  file_size?: number | null
  created_at: string
}

export interface ModReviewSummary {
  id: string
  content: string
  is_positive: boolean
  created_at: string
  user?: ModDetailAuthorSummary | null
}

export interface ModDetailResponse {
  mod: ModDetailSummary
  versions: ModVersionSummary[]
  reviews: ModReviewSummary[]
}

export interface PostUserSummary {
  id?: string
  user_number?: string | number
  username?: string | null
  avatar_url?: string | null
}

export interface PostGameSummary {
  id?: string
  name?: string | null
}

export interface PostDetailSummary {
  id: string
  title?: string | null
  content?: string | null
  category?: string | null
  created_at: string
  image_urls?: string[] | null
  user?: PostUserSummary | null
  game?: PostGameSummary | null
}

export interface PostReplySummary {
  id: string | number
  content: string
  created_at: string
  // post_replies 实际列名：parent_reply_id（楼中楼指向父回复的 ID）
  parent_reply_id?: string | number | null
  reply_to_user?: PostUserSummary | null
  user?: PostUserSummary | null
}

export interface PostLikeStatus {
  count: number
  liked: boolean
}

// === Mod Detail ===

export async function fetchModDetail(modNumber: string): Promise<ModDetailResponse | null> {
  const url = `${getApiBase()}/mods/${encodeURIComponent(modNumber)}/detail`
  const json = await requestJson<{ success: boolean; error?: string; data?: ModDetailResponse }>(url, { timeoutMs: 12000 })

  if (!json.success) {
    if (json.error?.includes("不存在") || json.error?.includes("未通过审核")) {
      return null
    }

    throw new Error(json.error || 'Failed to fetch mod detail')
  }

  return json.data || null
}

// === Post Detail ===

export async function fetchPostDetail(postId: string): Promise<PostDetailSummary> {
  const url = `${getApiBase()}/community/posts/${postId}`
  const json = await requestJson<{ success: boolean; error?: string; data: PostDetailSummary }>(url, { timeoutMs: 12000 })
  if (!json.success) throw new Error(json.error || 'Failed to fetch post')
  return json.data
}

export async function fetchPostReplies(postId: string): Promise<PostReplySummary[]> {
  const url = `${getApiBase()}/community/posts/${postId}/replies`
  const json = await requestJson<{ success: boolean; error?: string; data: PostReplySummary[] | { data?: PostReplySummary[] } }>(url, { timeoutMs: 12000 })
  if (!json.success) throw new Error(json.error || 'Failed to fetch replies')
  return Array.isArray(json.data) ? json.data : (json.data.data || [])
}

export async function fetchPostLikeStatus(postId: string): Promise<PostLikeStatus> {
  try {
    const data = await authenticatedFetch<PostLikeStatus>(`${getApiBase()}/community/posts/${postId}/like`)
    return data // { count, liked }
  } catch {
    // Not logged in or error — return defaults
    const url = `${getApiBase()}/community/posts/${postId}/like`
    const json = await requestJson<{ success: boolean; data?: PostLikeStatus }>(url, { timeoutMs: 12000 })
    if (json.success && json.data) return json.data
    return { count: 0, liked: false }
  }
}

export async function togglePostLike(postId: string): Promise<PostLikeStatus> {
  const data = await authenticatedFetch<PostLikeStatus>(`${getApiBase()}/community/posts/${postId}/like`, {
    method: 'POST',
  })
  return data // { liked, count }
}

export async function submitPostReply(postId: string, content: string, parentReplyId?: string | number) {
  const body: Record<string, unknown> = { content }
  // 主站 /community/posts/[id]/replies POST 接收字段名为 reply_to_id
  if (parentReplyId) body.reply_to_id = parentReplyId

  const data = await authenticatedFetch(`${getApiBase()}/community/posts/${postId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return data
}

// === Notifications ===

export async function fetchNotifications(params: { limit?: number; offset?: number; unread_only?: boolean } = {}): Promise<FetchNotificationsResponse> {
  const url = new URL(`${getApiBase()}/notifications`)
  if (params.limit) url.searchParams.set('limit', params.limit.toString())
  if (params.offset) url.searchParams.set('offset', params.offset.toString())
  if (params.unread_only) url.searchParams.set('unread_only', 'true')

  const data = await authenticatedFetch<FetchNotificationsResponse>(url.toString())
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

export async function publishPost(postId: string) {
  const data = await authenticatedFetch(`${getApiBase()}/community/forum/${postId}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  return data
}

export interface UserProfileSummary {
  id: string
  user_number: string | number
  username: string
  avatar_url?: string | null
  bio?: string | null
  created_at: string
}

export interface UserProfileStats {
  posts: number
  replies: number
  reviews: number
  mods: number
}

export interface UserProfileModSummary {
  id: string
  mod_number: string
  title: string
  thumbnail_url?: string | null
  created_at: string
  game?: {
    name?: string | null
  } | null
}

export interface UserProfilePostSummary {
  id: string
  category: string
  title: string
  created_at: string
}

export interface UserProfileReviewSummary {
  id: string
  is_positive: boolean
  content: string
  created_at: string
  mod?: {
    mod_number?: string
    title?: string | null
  } | null
}

export interface UserProfileResponse {
  profile: UserProfileSummary
  stats: UserProfileStats
  recentPosts?: UserProfilePostSummary[]
  recentReviews?: UserProfileReviewSummary[]
  recentMods?: UserProfileModSummary[]
}

// === User Profile ===

export async function fetchUserProfile(userNumber: string): Promise<UserProfileResponse> {
  const url = `${getApiBase()}/user/${userNumber}`
  const json = await requestJson<{ success: boolean; error?: string; data: UserProfileResponse }>(url, { timeoutMs: 12000 })
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
