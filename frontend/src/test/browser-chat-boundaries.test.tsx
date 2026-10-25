import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type * as React from "react"
import { describe, expect, it, vi } from "vitest"
import type { ChatUIMessage, QueuedTurn } from "@/components/Chat/types"
import { useAIChatFeedState } from "@/hooks/useAIChatFeedState"
import { buildStreamHandlers } from "@/hooks/useChatTurnSender"
import { attachBrowserActivity } from "@/observation/reading/activity"
import { connectBrowserQuestion } from "@/observation/reading/questionStream"
import type { BrowserReadingSession } from "@/observation/reading/session"

const stream = vi.hoisted(() => ({ start: vi.fn() }))

vi.mock("@/hooks/useAIChatStream", () => ({
  useAIChatStream: () => ({
    isStreaming: false,
    streamingThreadId: null,
    clearObservationUsage: vi.fn(),
    startStream: stream.start,
    stop: vi.fn(),
  }),
}))

vi.mock("@/client", async () => {
  const actual = await vi.importActual<typeof import("@/client")>("@/client")
  return {
    ...actual,
    AiThreadsService: {
      ...actual.AiThreadsService,
      getChatThread: vi.fn(async ({ id }: { id: string }) => ({
        id,
        transcript: { messages: [] },
      })),
      createChatThread: vi.fn(),
    },
  }
})

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function stateSetter<T>(state: T[]) {
  return (update: T | ((previous: T) => T)) => {
    state[0] =
      typeof update === "function"
        ? (update as (previous: T) => T)(state[0])
        : update
  }
}

function browserSession() {
  return {
    isPreparedQuestionActive: () => true,
    finishQuestion: vi.fn(),
    interruptQuestion: vi.fn(),
    cancelPreparedQuestion: vi.fn(),
  } as unknown as BrowserReadingSession
}

function browserQuestion() {
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

async function startOrdinaryQueueFeed() {
  stream.start.mockReset().mockImplementation(() => new Promise<void>(() => {}))
  const { result } = renderHook(
    () =>
      useAIChatFeedState({
        threads: [],
        selectedModelId: "model-1",
        initialThreadId: "thread-A",
      }),
    { wrapper: wrapper() },
  )

  await act(async () => {
    await result.current.handleSendMessage("active A")
  })
  await waitFor(() => expect(stream.start).toHaveBeenCalledOnce())
  act(() => result.current.setActiveThreadId("thread-B"))
  return result
}

describe("chat turn boundary regressions", () => {
  it("retains browser activity when an empty assistant turn is aborted", () => {
    const assistant: ChatUIMessage = {
      id: "assistant-browser",
      role: "assistant",
      parts: [],
      status: "streaming",
    }
    const withActivity = attachBrowserActivity({
      turn: {
        userMsg: {
          id: "user",
          role: "user",
          parts: [{ type: "text", text: "question" }],
        },
        assistantMsg: assistant,
      },
      question: { operation_id: "operation-1" },
    }).assistantMsg
    const state: [Record<string, ChatUIMessage[]>] = [
      { "thread-1": [withActivity] },
    ]
    const handlers = buildStreamHandlers({
      assistantMsgId: withActivity.id,
      targetThreadId: "thread-1",
      setMessagesByThread: stateSetter(state) as never,
      queryClient: { invalidateQueries: vi.fn() } as never,
    })
    const turn = {
      threadId: "thread-1",
      assistantMsgId: withActivity.id,
      requestId: "operation-1",
      browserQuestion: { operation_id: "operation-1" },
    } as QueuedTurn
    connectBrowserQuestion({ turn, session: browserSession(), handlers })
    handlers.onBrowserActivity?.({
      state: "reading",
      message: "Reading image",
      tool_id: "tool-1",
      tool_state: "running",
    })
    expect(state[0]["thread-1"][0].browserActivity?.tools).toHaveLength(1)

    const plainState: [Record<string, ChatUIMessage[]>] = [
      {
        "thread-1": [{ ...assistant, id: "assistant-plain" }],
      },
    ]
    const plainHandlers = buildStreamHandlers({
      assistantMsgId: "assistant-plain",
      targetThreadId: "thread-1",
      setMessagesByThread: stateSetter(plainState) as never,
      queryClient: { invalidateQueries: vi.fn() } as never,
    })
    plainHandlers.onAbort?.()
    expect(plainState[0]["thread-1"]).toHaveLength(0)

    handlers.onAbort?.()
    expect(state[0]["thread-1"]).toHaveLength(1)
    expect(state[0]["thread-1"][0].browserActivity).toBeDefined()
    expect(state[0]["thread-1"][0]).toMatchObject({
      status: "done",
      interrupted: true,
    })
  })

  it.each([
    "newer draft",
    "",
  ])("preserves the editor draft %s when canceling a browser question queued behind active A", async (editorDraft) => {
    stream.start
      .mockReset()
      .mockImplementation(() => new Promise<void>(() => {}))
    const session = {
      cancelPreparedQuestion: vi.fn(),
    } as unknown as BrowserReadingSession
    const { result, rerender } = renderHook(
      () =>
        useAIChatFeedState({
          threads: [],
          selectedModelId: "model-1",
          initialThreadId: "thread-A",
          browserReading: session,
        }),
      { wrapper: wrapper() },
    )

    await act(async () => {
      await result.current.handleSendMessage("active A")
    })
    await waitFor(() => expect(stream.start).toHaveBeenCalledOnce())
    act(() => result.current.setActiveThreadId("thread-B"))
    rerender()

    // Model the real PromptForm: it stores the submitted text before sending.
    act(() => result.current.setThreadDraft("thread-B", "queued B"))
    await act(async () => {
      await result.current.handleSendMessage("queued B", undefined, undefined, {
        browserQuestion: browserQuestion(),
      })
    })
    expect(result.current.turnQueue).toHaveLength(1)
    expect(result.current.threadDrafts["thread-B"]).toBe("")

    act(() => result.current.setThreadDraft("thread-B", "newer draft"))
    if (!editorDraft) act(() => result.current.setThreadDraft("thread-B", ""))
    expect(result.current.threadDrafts["thread-B"]).toBe(editorDraft || "")
    await act(async () => {
      result.current.cancelQueuedTurn("thread-B")
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(result.current.threadDrafts["thread-B"]).toBe(editorDraft || "")
    expect(session.cancelPreparedQuestion).toHaveBeenCalledWith("operation-1")
  })

  it("restores an unchanged browser prompt when its queued turn is canceled", async () => {
    stream.start
      .mockReset()
      .mockImplementation(() => new Promise<void>(() => {}))
    const session = {
      cancelPreparedQuestion: vi.fn(),
    } as unknown as BrowserReadingSession
    const { result } = renderHook(
      () =>
        useAIChatFeedState({
          threads: [],
          selectedModelId: "model-1",
          initialThreadId: "thread-A",
          browserReading: session,
        }),
      { wrapper: wrapper() },
    )

    await act(async () => {
      await result.current.handleSendMessage("active A")
    })
    await waitFor(() => expect(stream.start).toHaveBeenCalledOnce())
    act(() => result.current.setActiveThreadId("thread-B"))
    act(() => result.current.setThreadDraft("thread-B", "queued B"))
    await act(async () => {
      await result.current.handleSendMessage("queued B", undefined, undefined, {
        browserQuestion: browserQuestion(),
      })
    })

    act(() => result.current.cancelQueuedTurn("thread-B"))
    await waitFor(() => {
      expect(result.current.threadDrafts["thread-B"]).toBe("queued B")
    })
  })

  it.each([
    {
      scenario: "untouched single prompt",
      prompts: ["queued B"],
      laterDrafts: [],
      expectedDraft: "queued B",
    },
    {
      scenario: "newer nonempty draft",
      prompts: ["queued B"],
      laterDrafts: ["newer draft"],
      expectedDraft: "newer draft",
    },
    {
      scenario: "newer draft typed and cleared",
      prompts: ["queued B"],
      laterDrafts: ["newer draft", ""],
      expectedDraft: "",
    },
    {
      scenario: "multiple unchanged queued turns",
      prompts: ["queued B1", "queued B2"],
      laterDrafts: [],
      expectedDraft: "queued B1",
    },
  ])("keeps the appropriate draft for $scenario", async ({
    prompts,
    laterDrafts,
    expectedDraft,
  }) => {
    const result = await startOrdinaryQueueFeed()

    for (const prompt of prompts) {
      act(() => result.current.setThreadDraft("thread-B", prompt))
      await act(async () => {
        await result.current.handleSendMessage(prompt)
      })
    }
    for (const draft of laterDrafts) {
      act(() => result.current.setThreadDraft("thread-B", draft))
    }

    act(() => result.current.cancelQueuedTurn("thread-B"))
    expect(result.current.threadDrafts["thread-B"] ?? "").toBe(expectedDraft)
  })
})
