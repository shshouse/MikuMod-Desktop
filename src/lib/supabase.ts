import { createClient } from "@supabase/supabase-js"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase env variables")
}

let supabaseInstance: ReturnType<typeof createClient> | null = null

function clearStoredSupabaseSessions() {
  if (typeof window === "undefined") {
    return
  }

  Object.keys(window.localStorage).forEach((key) => {
    if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
      window.localStorage.removeItem(key)
    }
  })
}

function createSupabaseFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

    const isRefresh =
      url.includes("/auth/v1/token") && url.includes("grant_type=refresh_token")

    const response = await fetch(input, init)

    if (isRefresh && (response.status === 429 || response.status === 400 || response.status === 403)) {
      if (response.status === 400 || response.status === 403) {
        try {
          const body = await response.clone().json()
          if (body?.error_code === "refresh_token_not_found" || body?.error === "invalid_grant" || body?.code === "session_not_found") {
            clearStoredSupabaseSessions()
          }
        } catch {
          // Ignore body parse failures; the refresh response is already being returned to the caller.
        }

        return response
      }

      return new Response(
        JSON.stringify({ error: "invalid_grant", error_description: "Rate limited" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    return response
  }
}

function getSupabaseClient() {
  if (supabaseInstance) {
    return supabaseInstance
  }

  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        "x-client-info": "mikumod-desktop",
      },
      fetch: createSupabaseFetch(),
    },
  })

  if (typeof window !== "undefined") {
    supabaseInstance.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" && !session) {
        clearStoredSupabaseSessions()
      }
    })
  }

  return supabaseInstance
}

export const supabase = getSupabaseClient()

export async function signOutDesktop() {
  try {
    await supabase.auth.signOut({ scope: "local" })
  } finally {
    clearStoredSupabaseSessions()
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("mikumod-auth-signed-out"))
    }
  }
}
