import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type * as React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useAIChatFeedState } from "@/hooks/useAIChatFeedState"
import type { BrowserReadingSession } from "@/observation/reading/session"

vi.mock("@/client", async () => {
  const actual = await vi.importActual("@/client")
  return {
    ...actual,
    AiThreadsService: {
      listChatThreads: vi.fn().mockResolvedValue({ data: [] }),
      getChatThread: vi.fn().mockResolvedValue({
        id: "thread-1",
        transcript: {
          messages: [
            {
              id: "msg-user-1",
              role: "user",
              parts: [{ type: "text", text: "First prompt" }],
            },
            {
              id: "msg-asst-1",
              role: "assistant",
              parts: [{ type: "text", text: "First reply" }],
            },
          ],
        },
      }),
      createChatThread: vi.fn(),
      updateChatThread: vi.fn(),
      deleteChatThread: vi.fn(),
      listAiModels: vi.fn().mockResolvedValue({ data: [] }),
    },
  }
})

let mockIsStreaming = false
const mockStartStream = vi.fn()
const mockStopStream = vi.fn()

vi.mock("@/hooks/useAIChatStream", () => ({
  useAIChatStream: () => ({
    isStreaming: mockIsStreaming,
    streamingThreadId: mockIsStreaming ? "thread-1" : null,
    clearObservationUsage: vi.fn(),
    startStream: mockStartStream,
    stop: mockStopStream,
  }),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

function renderFeedHook(
  initialThreadId: string | null = "thread-1",
  browserReading?: BrowserReadingSession,
) {
  return renderHook(
    () =>
      useAIChatFeedState({
        threads: [],
        selectedModelId: "gpt-4o",
        initialThreadId: initialThreadId ?? undefined,
        browserReading,
      }),
    { wrapper: createWrapper() },
  )
}

function createBrowserQuestion(operationId: string) {
  return {
    operation_id: operationId,
    model: "model-1",
    context: {
      session_id: "session-1",
      generation: 1,
      cutoff: 0,
      summary: "",
      notes: [],
      pending_frames: [],
      current_view: null,
      gap_count: 0,
    },
  }
}

describe("useAIChatFeedState - message editing stream guard", () => {
  beforeEach(() => {
    mockIsStreaming = false
    vi.clearAllMocks()
  })

  it("manages editingMessageId lifecycle when idle", async () => {
    const { result } = renderFeedHook()

    act(() => {
      result.current.handleStartEdit("msg-user-1")
    })
    expect(result.current.editingMessageId).toBe("msg-user-1")

    act(() => {
      result.current.handleCancelEdit()
    })
    expect(result.current.editingMessageId).toBeNull()
  })

  it.each([
    {
      scenario: "restores the original draft when it stays empty",
      initialDraft: "  Question  ",
      editedDraft: undefined,
      expectedDraft: "  Question  ",
    },
    {
      scenario: "keeps later typing",
      initialDraft: "Question",
      editedDraft: "New question",
      expectedDraft: "New question",
    },
  ])("$scenario after browser question rejection", async ({
    initialDraft,
    editedDraft,
    expectedDraft,
  }) => {
    vi.useFakeTimers()
    try {
      const { result } = renderFeedHook()
      act(() => result.current.setThreadDraft("thread-1", initialDraft))

      await act(async () => {
        await expect(
          result.current.handleSendMessage("Question", undefined, undefined, {
            browserQuestion: createBrowserQuestion("operation-sync"),
          }),
        ).resolves.toBe(true)
      })
      expect(result.current.threadDrafts["thread-1"]).toBe("")
      if (editedDraft !== undefined)
        act(() => result.current.setThreadDraft("thread-1", editedDraft))

      await act(async () => vi.runAllTimersAsync())
      expect(result.current.threadDrafts["thread-1"]).toBe(expectedDraft)
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not restore after the draft changes and is cleared before a late failure", async () => {
    vi.useFakeTimers()
    let releaseStream: (() => void) | undefined
    mockStartStream.mockImplementation(() => {
      return new Promise<void>((resolve) => {
        releaseStream = resolve
      })
    })
    const browserReading = {
      isPreparedQuestionActive: () => true,
      interruptQuestion: vi.fn(),
    } as unknown as BrowserReadingSession
    try {
      const { result } = renderFeedHook("thread-1", browserReading)
      const browserQuestion = createBrowserQuestion("operation-late")
      act(() => result.current.setThreadDraft("thread-1", "Question"))

      await act(async () => {
        await expect(
          result.current.handleSendMessage("Question", undefined, undefined, {
            browserQuestion,
          }),
        ).resolves.toBe(true)
      })
      act(() => result.current.setThreadDraft("thread-1", "Later text"))
      act(() => result.current.setThreadDraft("thread-1", ""))

      await act(async () => {
        releaseStream?.()
        await Promise.resolve()
      })
      await act(async () => vi.runAllTimersAsync())
      expect(result.current.threadDrafts["thread-1"]).toBe("")
    } finally {
      mockStartStream.mockReset()
      vi.useRealTimers()
    }
  })

  it("restores a failed new-thread question only in the destination draft", async () => {
    vi.useFakeTimers()
    const { AiThreadsService } = await import("@/client")
    vi.mocked(AiThreadsService.createChatThread).mockResolvedValue({
      id: "thread-created",
    } as never)
    try {
      const { result } = renderFeedHook(null)
      act(() => result.current.setThreadDraft(null, "Question"))

      await act(async () => {
        await expect(
          result.current.handleSendMessage("Question", undefined, undefined, {
            browserQuestion: createBrowserQuestion("operation-new"),
          }),
        ).resolves.toBe(true)
      })
      await act(async () => vi.runAllTimersAsync())

      expect(result.current.threadDrafts["new-chat"]).toBe("")
      expect(result.current.threadDrafts["thread-created"]).toBe("Question")
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    {
      action: "startEdit",
      invoke: (hook: ReturnType<typeof renderFeedHook>["result"]) =>
        hook.current.handleStartEdit("msg-user-1"),
    },
    {
      action: "editLastUserMessage",
      invoke: (hook: ReturnType<typeof renderFeedHook>["result"]) =>
        hook.current.handleEditLastUserMessage(),
    },
  ])("blocks edit triggering ($action) while stream is active", ({
    invoke,
  }) => {
    mockIsStreaming = true
    const { result } = renderFeedHook()

    act(() => {
      invoke(result)
    })
    expect(result.current.editingMessageId).toBeNull()
  })

  it("resets active editing state if streaming begins midway", async () => {
    mockIsStreaming = false
    const { result, rerender } = renderFeedHook()

    act(() => {
      result.current.handleStartEdit("msg-user-1")
    })
    expect(result.current.editingMessageId).toBe("msg-user-1")

    mockIsStreaming = true
    rerender()
    expect(result.current.editingMessageId).toBeNull()
  })

  it("suppresses handleEditMessage submission while isStreaming is true", async () => {
    mockIsStreaming = true
    const { result } = renderFeedHook()

    await act(async () => {
      await result.current.handleEditMessage("msg-user-1", "New prompt text")
    })
    expect(mockStartStream).not.toHaveBeenCalled()
  })
})
