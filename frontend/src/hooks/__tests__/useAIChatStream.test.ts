import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAIChatStream } from "@/hooks/useAIChatStream"
import type { PreparedBrowserQuestion } from "@/observation/reading/types"

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

function createBrowserHandlers() {
  return {
    onBrowserNote: vi.fn(),
    onBrowserReceipt: vi.fn(),
    onBrowserStatus: vi.fn(),
    onBrowserDispatch: vi.fn(),
    onBrowserActivity: vi.fn(),
    onTextDelta: vi.fn(),
  }
}

function expectBrowserQuestionRoute(
  fetchSpy: ReturnType<typeof vi.fn>,
  question: PreparedBrowserQuestion,
) {
  expect(fetchSpy).toHaveBeenCalledWith(
    "/api/v1/ai/threads/thread-a/browser-chat",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        message: "What is shown?",
        model: "model-pinned",
        request_id: question.operation_id,
        browser_context: question.context,
      }),
    }),
  )
}

function expectBrowserEvents(
  question: PreparedBrowserQuestion,
  handlers: ReturnType<typeof createBrowserHandlers>,
) {
  expect(handlers.onBrowserDispatch).toHaveBeenCalledWith(question.operation_id)
  expect(handlers.onBrowserActivity).toHaveBeenCalledWith({
    state: "checking",
    message: "Checking browser context.",
  })
  expect(handlers.onBrowserActivity).toHaveBeenCalledWith({
    state: "reading",
    message: "Reading shared view.",
    tool_id: "frame-a",
    tool_state: "completed",
    view_index: 1,
    view_count: 1,
    note_chars: 15,
    note_preview: "A product page",
    preview_truncated: false,
    duration_ms: 42,
  })
  expect(handlers.onBrowserActivity).toHaveBeenCalledWith({
    state: "reading",
    message: "Reading shared view.",
    tool_id: "frame-failed",
    tool_state: "failed",
    failure_code: "output_truncated",
    failure_message: "The model response was truncated.",
  })
  expect(handlers.onBrowserActivity).toHaveBeenCalledWith({
    state: "reading",
    message: "Reading shared view.",
    tool_id: "frame-invalid",
  })
  expect(handlers.onBrowserNote).toHaveBeenCalledWith({
    id: "frame-a",
    sequence: 1,
    text: "A product page",
    model: "model-pinned",
    uncertainty: "",
  })
  expect(handlers.onBrowserReceipt).toHaveBeenCalledWith({
    operation_id: question.operation_id,
    completed_ids: ["frame-a"],
    failed_ids: [],
    unused_ids: [],
  })
  expect(handlers.onBrowserStatus).toHaveBeenCalledWith({
    state: "reading",
    operation_id: question.operation_id,
  })
  expect(handlers.onTextDelta).toHaveBeenCalledWith("The page shows a product.")
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
    await result.current.startStream({
      threadId: "thread-123",
      message: "Draft a post",
      handlers: {
        onError,
      },
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
      await result.current.startStream({
        threadId: "thread-123",
        message: "Draft a post",
        handlers: {
          onError,
        },
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
      await result.current.startStream({
        threadId: "thread-123",
        message: "Draft a post",
        handlers: {
          onError,
        },
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
      await result.current.startStream({
        threadId: "thread-123",
        message: "Draft a post",
        handlers: {
          onError,
        },
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
      await result.current.startStream({
        threadId: "thread-123",
        message: "Draft a post",
        handlers: {
          onError,
        },
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
      await result.current.startStream({
        threadId: "thread-123",
        message: "Hello",
        handlers: {
          onThought,
          onTextDelta,
          onDone,
          onError,
        },
      })
    })

    expect(onThought).toHaveBeenCalledWith("Thinking...")
    expect(onTextDelta).toHaveBeenCalledWith("Hello world")
    expect(onDone).toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    expect(result.current.isStreaming).toBe(false)
  })

  it("sends browser questions on the dedicated route and keeps browser events out of assistant text", async () => {
    localStorage.setItem("access_token", createMockJwt(3600))
    const question = browserQuestionFixture()
    const stream = browserStreamFixture()
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    })
    vi.stubGlobal("fetch", fetchSpy)
    const handlers = createBrowserHandlers()
    const { result } = renderHook(() => useAIChatStream())

    await act(async () => {
      await result.current.startStream({
        threadId: "thread-a",
        message: "What is shown?",
        handlers,
        model: "ignored-model",
        browserQuestion: question,
      })
    })

    expectBrowserQuestionRoute(fetchSpy, question)
    expectBrowserEvents(question, handlers)
  })

  it.each([
    {
      name: "EOF without a done event",
      data: 'event: text_delta\ndata: {"content":"partial"}\n\n',
      expectedError: "Stream ended before completion.",
      expectedText: "partial",
    },
    {
      name: "an explicit error followed by close",
      data: 'event: error\ndata: {"message":"Browser processing failed."}\n\n',
      expectedError: "Browser processing failed.",
    },
    {
      name: "an explicit error without a trailing newline",
      data: 'event: error\ndata: {"message":"Browser processing failed."}',
      expectedError: "Browser processing failed.",
    },
  ])("reports $name once without completing", async (scenario) => {
    localStorage.setItem("access_token", createMockJwt(3600))
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(scenario.data))
        controller.close()
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, body: stream }),
    )
    const onDone = vi.fn()
    const onError = vi.fn()
    const onTextDelta = vi.fn()
    const { result } = renderHook(() => useAIChatStream())

    await act(async () => {
      await result.current.startStream({
        threadId: "thread-a",
        message: "What is shown?",
        handlers: { onDone, onError, onTextDelta },
      })
    })

    expect(onDone).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(scenario.expectedError)
    if (scenario.expectedText)
      expect(onTextDelta).toHaveBeenCalledWith(scenario.expectedText)
  })

  it.each([
    {
      name: "EOF handling",
      body: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close()
          },
        }),
      expectedError: "Stream ended before completion.",
    },
    {
      name: "reader failure handling",
      body: () =>
        new ReadableStream<Uint8Array>({
          pull() {
            throw new Error("network read failed")
          },
        }),
      expectedError: "network read failed",
    },
  ])("does not retry a terminal callback that throws during $name", async (scenario) => {
    localStorage.setItem("access_token", createMockJwt(3600))
    const body = scenario.body()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, body }),
    )
    const onError = vi.fn(() => {
      throw new Error("consumer callback failed")
    })
    const { result } = renderHook(() => useAIChatStream())

    await act(async () => {
      await result.current.startStream({
        threadId: "thread-a",
        message: "hello",
        handlers: { onError },
      })
    })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(scenario.expectedError)
    expect(result.current.isStreaming).toBe(false)
  })

  it("preserves abort as the request's terminal outcome", async () => {
    localStorage.setItem("access_token", createMockJwt(3600))
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new DOMException("Request cancelled", "AbortError")
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, body }),
    )
    const onAbort = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useAIChatStream())

    await act(async () => {
      await result.current.startStream({
        threadId: "thread-a",
        message: "hello",
        handlers: { onAbort, onDone, onError },
      })
    })

    expect(onAbort).toHaveBeenCalledTimes(1)
    expect(onDone).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(result.current.isStreaming).toBe(false)
  })

  it("does not complete successfully if a done event follows a stream error", async () => {
    localStorage.setItem("access_token", createMockJwt(3600))
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: text_delta\ndata: {"content":"partial answer"}\n\n' +
              'event: error\ndata: {"message":"Browser processing failed."}\n\n' +
              "event: done\ndata: {}\n\n",
          ),
        )
        controller.close()
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, body }),
    )
    const onDone = vi.fn()
    const onError = vi.fn()
    const onTextDelta = vi.fn()
    const { result } = renderHook(() => useAIChatStream())

    await act(async () => {
      await result.current.startStream({
        threadId: "thread-a",
        message: "What is shown?",
        handlers: { onDone, onError, onTextDelta },
      })
    })

    expect(onTextDelta).toHaveBeenCalledWith("partial answer")
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onDone).not.toHaveBeenCalled()
  })

  it("surfaces observation usage metadata without retaining image data", async () => {
    localStorage.setItem("access_token", createMockJwt(3600))
    const usage = observationUsageFixture()
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
      await result.current.startStream({
        threadId: "thread-123",
        message: "Hello",
        handlers: {
          onObservationUsage,
        },
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
      completed = result.current.startStream({
        threadId: "thread-123",
        message: "Hello",
        handlers: {
          onObservationUsage,
          onTextDelta,
        },
      })
    })
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce())
    act(() => result.current.clearObservationUsage())
    expect(result.current.isStreaming).toBe(true)

    const usage = observationUsageFixture()
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
      firstStream = result.current.startStream({
        threadId: "thread-a",
        message: "First",
        handlers: {
          onObservationUsage: onFirstUsage,
        },
      })
    })
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    act(() => {
      secondStream = result.current.startStream({
        threadId: "thread-b",
        message: "Second",
        handlers: {
          onObservationUsage: onSecondUsage,
        },
      })
    })
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))

    const usage = observationUsageFixture()
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
      await result.current.startStream({
        threadId: "thread-123",
        message: "What is on this page?",
        handlers: {},
        observation: observation,
      })
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
      await result.current.startStream({
        threadId: "thread-123",
        message: "Legacy question",
      })
    })

    const requestBody = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(requestBody.message).toBe("Legacy question")
    expect(requestBody).not.toHaveProperty("observation")
  })
})

function browserQuestionFixture(): PreparedBrowserQuestion {
  const question: PreparedBrowserQuestion = {
    operation_id: "00000000-0000-4000-8000-000000000123",
    model: "model-pinned",
    context: {
      session_id: "00000000-0000-4000-8000-000000000456",
      generation: 1,
      cutoff: 1,
      summary: "",
      notes: [],
      pending_frames: [],
      current_view: null,
      gap_count: 0,
    },
  }
  return question
}

describe("browser question waiting for background reading", () => {
  it("shows the useful budget error message without rendering its JSON envelope", async () => {
    localStorage.setItem("access_token", createMockJwt(3600))
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: async () =>
          JSON.stringify({
            detail: {
              code: "input_too_large",
              message:
                "Your browser notes are retained. Choose a larger-context model.",
              budget: null,
            },
          }),
      }),
    )
    const onError = vi.fn()
    const { result } = renderHook(() => useAIChatStream())
    await act(async () =>
      result.current.startStream({
        threadId: "owner",
        message: "Question",
        handlers: { onError },
        browserQuestion: browserQuestionFixture(),
      }),
    )
    expect(onError).toHaveBeenCalledWith(
      "Your browser notes are retained. Choose a larger-context model.",
    )
  })
  it("shows a running question immediately but sends refreshed browser memory only after the read settles", async () => {
    localStorage.setItem("access_token", createMockJwt(3600))
    const question = browserQuestionFixture()
    let release: ((context: typeof question.context) => void) | undefined
    question.ready = () =>
      new Promise((resolve) => {
        release = resolve
      })
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: browserStreamFixture(),
    })
    vi.stubGlobal("fetch", fetchSpy)
    const { result } = renderHook(() => useAIChatStream())
    let finished: Promise<void> | undefined
    act(() => {
      finished = result.current.startStream({
        threadId: "owner",
        message: "What opens at noon?",
        handlers: {},
        browserQuestion: question,
      })
    })
    expect(result.current.isStreaming).toBe(true)
    expect(result.current.streamingThreadId).toBe("owner")
    expect(fetchSpy).not.toHaveBeenCalled()
    await act(async () => {
      release?.({
        ...question.context,
        notes: [
          {
            id: "frame-a",
            sequence: 1,
            text: "Aster opens at noon.",
            uncertainty: "",
            model: "model-pinned",
          },
        ],
      })
      await finished
    })
    expect(
      JSON.parse(fetchSpy.mock.calls[0][1].body).browser_context.notes[0].text,
    ).toBe("Aster opens at noon.")
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).not.toHaveProperty(
      "ready",
    )
  })
})

function browserStreamFixture() {
  const payload =
    'event: browser_status\ndata: {"state":"reading","operation_id":"00000000-0000-4000-8000-000000000123"}\n\n' +
    'event: browser_activity\ndata: {"state":"checking","message":"Checking browser context."}\n\n' +
    'event: browser_activity\ndata: {"state":"reading","message":"Reading shared view.","tool_id":"frame-a","tool_state":"completed","view_index":1,"view_count":1,"note_chars":15,"note_preview":"A product page","preview_truncated":false,"duration_ms":42}\n\n' +
    'event: browser_activity\ndata: {"state":"reading","message":"Reading shared view.","tool_id":"frame-failed","tool_state":"failed","failure_code":"output_truncated","failure_message":"The model response was truncated."}\n\n' +
    'event: browser_activity\ndata: {"state":"reading","message":"Reading shared view.","tool_id":"frame-invalid","tool_state":"unknown","view_index":0,"view_count":1.5,"note_chars":-3,"duration_ms":-1}\n\n' +
    'event: browser_note\ndata: {"id":"frame-a","sequence":1,"text":"A product page","model":"model-pinned","uncertainty":""}\n\n' +
    'event: browser_receipt\ndata: {"operation_id":"00000000-0000-4000-8000-000000000123","completed_ids":["frame-a"],"failed_ids":[],"unused_ids":[]}\n\n' +
    'event: text_delta\ndata: {"content":"The page shows a product."}\n\n' +
    "event: done\ndata: {}\n\n"
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload))
      controller.close()
    },
  })
  return stream
}

function observationUsageFixture() {
  return {
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
}
