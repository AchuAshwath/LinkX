import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearAuthAndRedirect,
  getStoredToken,
  isJwtExpired,
} from "@/utils/auth"

function createMockJwt(expSecondsFromNow: number): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = btoa(
    JSON.stringify({
      sub: "user-123",
      exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
    }),
  )
  return `${header}.${payload}.signature`
}

describe("auth utility functions", () => {
  const originalLocation = window.location

  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    delete (window as any).location
    window.location = {
      href: "http://localhost:5173/home",
      pathname: "/home",
    } as any
  })

  afterEach(() => {
    ;(window as any).location = originalLocation
  })

  describe("getStoredToken", () => {
    it("returns empty string if access_token is missing", () => {
      expect(getStoredToken()).toBe("")
    })

    it("returns token value when present in localStorage", () => {
      localStorage.setItem("access_token", "my-token")
      expect(getStoredToken()).toBe("my-token")
    })

    it("safely returns empty string if localStorage access throws", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("Access is denied", "SecurityError")
      })
      expect(getStoredToken()).toBe("")
    })
  })

  describe("isJwtExpired", () => {
    it("returns true for empty or missing tokens", () => {
      expect(isJwtExpired("")).toBe(true)
    })

    it("returns true for a token with past expiration", () => {
      const expiredToken = createMockJwt(-60)
      expect(isJwtExpired(expiredToken)).toBe(true)
    })

    it("returns false for a token with future expiration", () => {
      const validToken = createMockJwt(3600)
      expect(isJwtExpired(validToken)).toBe(false)
    })

    it("returns false for non-JWT opaque tokens", () => {
      expect(isJwtExpired("simple-test-token")).toBe(false)
    })
  })

  describe("clearAuthAndRedirect", () => {
    it("removes access_token and updates window.location.href to /login", () => {
      localStorage.setItem("access_token", "active-token")
      clearAuthAndRedirect()
      expect(localStorage.getItem("access_token")).toBeNull()
      expect(window.location.href).toBe("/login")
    })

    it("does not mutate window.location.href if already on login path", () => {
      window.location = {
        href: "http://localhost:5173/login",
        pathname: "/login",
      } as any
      clearAuthAndRedirect("/login")
      expect(window.location.href).toBe("http://localhost:5173/login")
    })

    it("survives localStorage.removeItem DOMException without throwing", () => {
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw new DOMException("Access is denied", "SecurityError")
      })
      expect(() => clearAuthAndRedirect()).not.toThrow()
      expect(window.location.href).toBe("/login")
    })
  })
})
