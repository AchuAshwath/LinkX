import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAIChatStream } from "@/hooks/useAIChatStream"

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

async function assertAuthFailureRedirection(options: {
  setup?: () => void
  expectedMessage?: string
}) {
  options.setup?.()
  const fetchSpy = vi.fn()
  vi.stubGlobal("fetch", fetchSpy)

  const onError = vi.fn()
  const { result } = renderHook(() => useAIChatStream())

  await act(async () => {
    await result.current.startStream("thread-123", "Draft a post", {
      onError,
    })
  })

  expect(fetchSpy).not.toHaveBeenCalled()
  expect(onError).toHaveBeenCalledWith(
    options.expectedMessage ??
      "Authentication session expired. Please log in again.",
  )
  expect(window.location.href).toBe("/login")
  expect(result.current.isStreaming).toBe(false)
}

describe("useAIChatStream auth handling (Issue #128)", () => {
  const originalLocation = window.location

  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    delete (window as any).location
    window.location = {
      href: "http://localhost:5173/ai",
      pathname: "/ai",
    } as any
  })

  afterEach(() => {
    ;(window as any).location = originalLocation
  })

  it("handles 401 response by invoking onError, clearing access_token, and redirecting to /login", async () => {
    localStorage.setItem("access_token", createMockJwt(3600))

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () =>
          Promise.resolve(
            JSON.stringify({ detail: "Could not validate credentials" }),
          ),
      }),
    )

    const onError = vi.fn()
    const { result } = renderHook(() => useAIChatStream())

    await act(async () => {
      await result.current.startStream("thread-123", "Draft a post", {
        onError,
      })
    })

    expect(onError).toHaveBeenCalledWith(
      "Your session has expired. Redirecting to login...",
    )
    expect(localStorage.getItem("access_token")).toBeNull()
    expect(window.location.href).toBe("/login")
    expect(result.current.isStreaming).toBe(false)
  })

  it("handles missing token by invoking onError and redirecting to /login without calling fetch", async () => {
    await assertAuthFailureRedirection({})
  })

  it("handles client-side expired JWT token by invoking onError and redirecting without calling fetch", async () => {
    await assertAuthFailureRedirection({
      setup: () => {
        localStorage.setItem("access_token", createMockJwt(-300))
      },
    })
  })

  it("handles storage security errors during token retrieval gracefully", async () => {
    await assertAuthFailureRedirection({
      setup: () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
          throw new DOMException("Access is denied", "SecurityError")
        })
      },
    })
  })

  it("handles storage security errors gracefully during 401 handling", async () => {
    localStorage.setItem("access_token", createMockJwt(3600))
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Access is denied", "SecurityError")
    })

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve(""),
      }),
    )

    const onError = vi.fn()
    const { result } = renderHook(() => useAIChatStream())

    await act(async () => {
      await result.current.startStream("thread-123", "Draft a post", {
        onError,
      })
    })

    expect(onError).toHaveBeenCalledWith(
      "Your session has expired. Redirecting to login...",
    )
    expect(window.location.href).toBe("/login")
    expect(result.current.isStreaming).toBe(false)
  })

  it("does not reassign window.location.href if already on /login", async () => {
    window.location = {
      href: "http://localhost:5173/login",
      pathname: "/login",
    } as any

    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const onError = vi.fn()
    const { result } = renderHook(() => useAIChatStream())

    await act(async () => {
      await result.current.startStream("thread-123", "Draft a post", {
        onError,
      })
    })

    expect(onError).toHaveBeenCalledWith(
      "Authentication session expired. Please log in again.",
    )
    expect(window.location.href).toBe("http://localhost:5173/login")
    expect(result.current.isStreaming).toBe(false)
  })

  it("does not redirect to /login on non-401 errors (e.g. 500 Internal Server Error)", async () => {
    const validToken = createMockJwt(3600)
    localStorage.setItem("access_token", validToken)

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      }),
    )

    const onError = vi.fn()
    const { result } = renderHook(() => useAIChatStream())

    await act(async () => {
      await result.current.startStream("thread-123", "Draft a post", {
        onError,
      })
    })

    expect(onError).toHaveBeenCalledWith("Internal Server Error")
    expect(localStorage.getItem("access_token")).toBe(validToken)
    expect(window.location.href).toBe("http://localhost:5173/ai")
    expect(result.current.isStreaming).toBe(false)
  })

  it("successfully streams SSE events when token is present and response is 200", async () => {
    localStorage.setItem("access_token", createMockJwt(3600))

    const ssePayload =
      'event: thought\ndata: {"content":"Thinking..."}\n\n' +
      'event: text_delta\ndata: {"content":"Hello world"}\n\n' +
      "event: done\ndata: {}\n\n"

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(ssePayload))
        controller.close()
      },
    })

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: stream,
      }),
    )

    const onThought = vi.fn()
    const onTextDelta = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()

    const { result } = renderHook(() => useAIChatStream())

    await act(async () => {
      await result.current.startStream("thread-123", "Hello", {
        onThought,
        onTextDelta,
        onDone,
        onError,
      })
    })

    expect(onThought).toHaveBeenCalledWith("Thinking...")
    expect(onTextDelta).toHaveBeenCalledWith("Hello world")
    expect(onDone).toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(result.current.isStreaming).toBe(false)
  })
})
