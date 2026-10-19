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

function createControlledResponse(
  controllers: ReadableStreamDefaultController<Uint8Array>[],
) {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controllers.push(controller)
      },
    }),
  }
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

  it("surfaces observation usage metadata without retaining image data", async () => {
    localStorage.setItem("access_token", createMockJwt(3600))
    const usage = {
      estimated_input_tokens: 1200,
      input_limit: 4000,
      output_reserve: 700,
      model_id: "vision-model",
      frame_count: 1,
      history_frames: 0,
      revision: 4,
      source_epoch: 2,
      width: 1280,
      height: 720,
      captured_at: "2026-10-19T09:00:00Z",
      delivered_at: "2026-10-19T09:00:01Z",
      frame_presented_at_ms: 120,
    }
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `event: observation_usage\ndata: ${JSON.stringify(usage)}\n\n`,
          ),
        )
        controller.close()
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, body }),
    )

    const onObservationUsage = vi.fn()
    const { result } = renderHook(() => useAIChatStream())
    await act(async () => {
      await result.current.startStream("thread-123", "Hello", {
        onObservationUsage,
      })
    })

    expect(onObservationUsage).toHaveBeenCalledWith(usage)
    expect(result.current.observationUsage).toEqual({
      threadId: "thread-123",
      data: usage,
    })
    act(() => result.current.clearObservationUsage())
    expect(result.current.observationUsage).toBeNull()
  })

  it("keeps cleared usage details cleared while the answer stream continues", async () => {
    localStorage.setItem("access_token", createMockJwt(3600))
    const encoder = new TextEncoder()
    let streamController: ReadableStreamDefaultController<Uint8Array> | null =
      null
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
      },
    })
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, body })
    vi.stubGlobal("fetch", fetchSpy)
    const onObservationUsage = vi.fn()
    const onTextDelta = vi.fn()
    const { result } = renderHook(() => useAIChatStream())
    let completed: Promise<void> = Promise.resolve()

    act(() => {
      completed = result.current.startStream("thread-123", "Hello", {
        onObservationUsage,
        onTextDelta,
      })
    })
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce())
    act(() => result.current.clearObservationUsage())
    expect(result.current.isStreaming).toBe(true)

    const usage = {
      estimated_input_tokens: 1200,
      input_limit: 4000,
      output_reserve: 700,
      model_id: "vision-model",
      frame_count: 1,
      history_frames: 0,
      revision: 4,
      source_epoch: 2,
      width: 1280,
      height: 720,
      captured_at: "2026-10-19T09:00:00Z",
      delivered_at: "2026-10-19T09:00:01Z",
      frame_presented_at_ms: 120,
    }
    act(() => {
      streamController?.enqueue(
        encoder.encode(
          `event: observation_usage\ndata: ${JSON.stringify(usage)}\n\n` +
            'event: text_delta\ndata: {"content":"The answer continues."}\n\n',
        ),
      )
      streamController?.close()
    })
    await act(async () => completed)

    expect(onObservationUsage).not.toHaveBeenCalled()
    expect(result.current.observationUsage).toBeNull()
    expect(onTextDelta).toHaveBeenCalledWith("The answer continues.")
  })

  it("ignores usage metadata that arrives from a replaced stream", async () => {
    localStorage.setItem("access_token", createMockJwt(3600))
    const encoder = new TextEncoder()
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = []
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(createControlledResponse(controllers))
      .mockResolvedValueOnce(createControlledResponse(controllers))
    vi.stubGlobal("fetch", fetchSpy)
    const onFirstUsage = vi.fn()
    const onSecondUsage = vi.fn()
    const { result } = renderHook(() => useAIChatStream())
    let firstStream: Promise<void> = Promise.resolve()
    let secondStream: Promise<void> = Promise.resolve()

    act(() => {
      firstStream = result.current.startStream("thread-a", "First", {
        onObservationUsage: onFirstUsage,
      })
    })
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    act(() => {
      secondStream = result.current.startStream("thread-b", "Second", {
        onObservationUsage: onSecondUsage,
      })
    })
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))

    const usage = {
      estimated_input_tokens: 1200,
      input_limit: 4000,
      output_reserve: 700,
      model_id: "vision-model",
      frame_count: 1,
      history_frames: 0,
      revision: 4,
      source_epoch: 2,
      width: 1280,
      height: 720,
      captured_at: "2026-10-19T09:00:00Z",
      delivered_at: "2026-10-19T09:00:01Z",
      frame_presented_at_ms: 120,
    }
    act(() => {
      controllers[0].enqueue(
        encoder.encode(
          `event: observation_usage\ndata: ${JSON.stringify(usage)}\n\n`,
        ),
      )
      controllers[0].close()
    })
    await act(async () => firstStream)
    expect(onFirstUsage).not.toHaveBeenCalled()
    act(() => {
      controllers[1].enqueue(
        encoder.encode(
          `event: observation_usage\ndata: ${JSON.stringify(usage)}\n\n`,
        ),
      )
      controllers[1].close()
    })
    await vi.waitFor(() => expect(onSecondUsage).toHaveBeenCalledOnce())
    await act(async () => secondStream)

    expect(onFirstUsage).not.toHaveBeenCalled()
    expect(result.current.observationUsage).toEqual({
      threadId: "thread-b",
      data: usage,
    })
  })

  it("sends the request-scoped observation packet in the chat request body", async () => {
    localStorage.setItem("access_token", createMockJwt(3600))
    const encoder = new TextEncoder()
    const responseBody = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"))
        controller.close()
      },
    })
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: responseBody,
    })
    vi.stubGlobal("fetch", fetchSpy)
    const observation = Object.freeze({
      session_id: "session-8",
      source_epoch: 2,
      revision: 19,
      captured_at: "2026-10-18T08:00:00.000Z",
      delivered_at: "2026-10-18T08:00:00.020Z",
      frame_presented_at_ms: 1234,
      width: 640,
      height: 480,
      image_data_url: "data:image/jpeg;base64,QUJD",
    })
    const { result } = renderHook(() => useAIChatStream())

    await act(async () => {
      await result.current.startStream(
        "thread-123",
        "What is on this page?",
        {},
        undefined,
        undefined,
        undefined,
        observation,
      )
    })

    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toMatchObject({
      message: "What is on this page?",
      observation,
    })
  })

  it("omits observation from a legacy chat request", async () => {
    localStorage.setItem("access_token", createMockJwt(3600))
    const encoder = new TextEncoder()
    const responseBody = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"))
        controller.close()
      },
    })
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: responseBody,
    })
    vi.stubGlobal("fetch", fetchSpy)
    const { result } = renderHook(() => useAIChatStream())

    await act(async () => {
      await result.current.startStream("thread-123", "Legacy question")
    })

    const requestBody = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(requestBody.message).toBe("Legacy question")
    expect(requestBody).not.toHaveProperty("observation")
  })
})
