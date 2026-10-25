import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type * as React from "react"
import { describe, expect, it, vi } from "vitest"
import { AiThreadsService } from "@/client"
import { PromptForm } from "@/components/Chat/PromptForm"
import { useAIChatFeedState } from "@/hooks/useAIChatFeedState"
import type { BrowserReadingSession } from "@/observation/reading/session"

const stream = vi.hoisted(() => ({ start: vi.fn() }))

vi.mock("@/client", async () => {
  const actual = await vi.importActual<typeof import("@/client")>("@/client")
  return {
    ...actual,
    AiThreadsService: {
      listChatThreads: vi.fn().mockResolvedValue({ data: [] }),
      getChatThread: vi.fn().mockResolvedValue({
        id: "thread-1",
        transcript: { messages: [] },
      }),
      createChatThread: vi.fn(),
      updateChatThread: vi.fn(),
      deleteChatThread: vi.fn(),
      listAiModels: vi.fn().mockResolvedValue({ data: [] }),
    },
  }
})

vi.mock("@/hooks/useAIChatStream", () => ({
  useAIChatStream: () => ({
    isStreaming: false,
    streamingThreadId: null,
    clearObservationUsage: vi.fn(),
    startStream: stream.start,
    stop: vi.fn(),
  }),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

function createBrowserSession() {
  return {
    isPreparedQuestionActive: () => true,
    markQuestionDispatched: vi.fn(),
    finishQuestion: vi.fn(),
    interruptQuestion: vi.fn(),
    cancelPreparedQuestion: vi.fn(),
    receiveNote: vi.fn(),
  } as unknown as BrowserReadingSession
}

function createBrowserQuestion() {
  return {
    operation_id: "operation-1",
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

function ConnectedPromptForm({
  browserReading,
}: {
  browserReading: BrowserReadingSession
}) {
  const feed = useAIChatFeedState({
    threads: [],
    selectedModelId: "model-1",
    initialThreadId: "thread-1",
    browserReading,
  })
  const key = feed.activeThreadId ?? "new-chat"
  return (
    <PromptForm
      initialValue={feed.threadDrafts[key] ?? ""}
      onValueChange={(value) => feed.setThreadDraft(feed.activeThreadId, value)}
      onSubmit={(text, images) =>
        feed.handleSendMessage(text, images, undefined, {
          browserQuestion: createBrowserQuestion(),
        })
      }
      placeholder="Ask anything…"
    />
  )
}

describe("PromptForm with the real chat draft sender", () => {
  it.each([
    "Send button",
    "Enter",
  ] as const)("clears a browser question after the sender and stream acknowledge it via %s", async (submitMethod) => {
    stream.start.mockClear()
    let acknowledgeProcessing:
      | ((status: { state: string; operation_id: string }) => void)
      | undefined
    let finishStream: (() => void) | undefined
    vi.mocked(AiThreadsService.getChatThread).mockResolvedValue({
      id: "thread-1",
      transcript: { messages: [] },
    } as never)
    stream.start.mockImplementation(
      ({
        handlers,
      }: {
        handlers: { onBrowserStatus?: typeof acknowledgeProcessing }
      }) =>
        new Promise<void>((resolve) => {
          acknowledgeProcessing = handlers.onBrowserStatus
          finishStream = resolve
        }),
    )
    render(<ConnectedPromptForm browserReading={createBrowserSession()} />, {
      wrapper: createWrapper(),
    })

    const input = screen.getByPlaceholderText("Ask anything…")
    fireEvent.change(input, {
      target: { value: "What does Karpagam say about her post?" },
    })
    if (submitMethod === "Send button") {
      fireEvent.click(screen.getByRole("button", { name: "Send message" }))
    } else {
      fireEvent.keyDown(input, { key: "Enter" })
    }

    await waitFor(() => expect(input).toHaveValue(""))
    expect(stream.start).toHaveBeenCalledOnce()
    await act(async () => {
      acknowledgeProcessing?.({
        state: "processing",
        operation_id: "operation-1",
      })
    })
    await act(async () => finishStream?.())
    await waitFor(() => expect(input).toHaveValue(""))
  })
})
