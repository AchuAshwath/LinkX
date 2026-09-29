export function clearAuthAndRedirect(loginPath = "/login") {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem("access_token")
    } catch {
      // Storage access may be restricted in private/sandboxed contexts
    }
  }
  if (typeof window !== "undefined") {
    if (window.location.pathname !== loginPath) {
      window.location.href = loginPath
    }
  }
}

export function isJwtExpired(token: string): boolean {
  if (!token) return true
  try {
    const parts = token.split(".")
    if (parts.length < 2) return false
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    )
    if (typeof payload.exp === "number") {
      return Date.now() >= payload.exp * 1000
    }
    return false
  } catch {
    return false
  }
}

export function getStoredToken(): string {
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    try {
      return localStorage.getItem("access_token") || ""
    } catch {
      return ""
    }
  }
  return ""
}
