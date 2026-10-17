import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type * as React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useAIChatFeedState } from "@/hooks/useAIChatFeedState"

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

function renderFeedHook() {
  return renderHook(
    () =>
      useAIChatFeedState({
        threads: [],
        selectedModelId: "gpt-4o",
        initialThreadId: "thread-1",
      }),
    { wrapper: createWrapper() },
  )
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
