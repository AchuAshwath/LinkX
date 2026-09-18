import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AiThreadsService } from "@/client"
import { Route } from "@/routes/_layout/ai"

vi.mock("@/client", async () => {
  const actual = await vi.importActual("@/client")
  return {
    ...actual,
    AiThreadsService: {
      listChatThreads: vi.fn(),
      getChatThread: vi.fn(),
      createChatThread: vi.fn(),
      updateChatThread: vi.fn(),
      deleteChatThread: vi.fn(),
      listAiModels: vi.fn().mockResolvedValue({
        data: [{ id: "gpt-5.4", name: "GPT-5.4" }],
        default_model: "gpt-5.4",
      }),
    },
  }
})

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  )
}

describe("Multi-thread prompt queuing and stream isolation", () => {
  const mockThreads = [
    {
      id: "thread-A",
      title: "Thread Alpha",
      origin: "manual",
      message_count: 1,
      is_archived: false,
      created_at: new Date(Date.now() + 10000).toISOString(),
      updated_at: new Date().toISOString(),
      owner_id: "user-1",
    },
    {
      id: "thread-B",
      title: "Thread Beta",
      origin: "manual",
      message_count: 1,
      is_archived: false,
      created_at: new Date(Date.now() - 10000).toISOString(),
      updated_at: new Date().toISOString(),
      owner_id: "user-1",
    },
  ]

  const mockDetailA = {
    ...mockThreads[0],
    transcript: {
      messages: [
        {
          id: "m-a-1",
          role: "user",
          parts: [{ type: "text", text: "Alpha initial prompt" }],
        },
      ],
    },
  }

  const mockDetailB = {
    ...mockThreads[1],
    transcript: {
      messages: [
        {
          id: "m-b-1",
          role: "user",
          parts: [{ type: "text", text: "Beta initial prompt" }],
        },
      ],
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, "", "/")
    vi.mocked(AiThreadsService.listChatThreads).mockResolvedValue({
      data: mockThreads,
      count: mockThreads.length,
    })
    ;(vi.mocked(AiThreadsService.getChatThread) as any).mockImplementation(
      async ({ id }: { id: string }) => {
        if (id === "thread-A") return mockDetailA
        if (id === "thread-B") return mockDetailB
        return {
          id,
          title: "New Thread",
          origin: "composer",
          message_count: 0,
          is_archived: false,
          transcript: { messages: [] },
          owner_id: "user-1",
        }
      },
    )
    vi.mocked(AiThreadsService.createChatThread).mockResolvedValue({
      id: "thread-new",
      title: "New thread title",
      origin: "composer",
      message_count: 0,
      is_archived: false,
      transcript: { messages: [] },
      owner_id: "user-1",
    })
  })

  function createMockStream() {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        controller = ctrl
      },
    })
    return {
      stream,
      close: () => controller?.close(),
      enqueueText: (content: string) => {
        const encoder = new TextEncoder()
        controller?.enqueue(
          encoder.encode(
            `event: text_delta\ndata: {"content": "${content}"}\n\nevent: done\ndata: {}\n\n`,
          ),
        )
        controller?.close()
      },
    }
  }

  function submitPrompt(text: string) {
    const input = screen.getByPlaceholderText("Ask anything")
    fireEvent.change(input, { target: { value: text } })
    fireEvent.submit(input.closest("form")!)
  }

  function selectSidebarThread(threadName: string) {
    const btn = screen.getByText(threadName)
    fireEvent.click(btn)
  }

  async function expectQueuedIndicator() {
    expect(
      await screen.findByText(
        /Queued • Waiting for active generation to finish.../i,
      ),
    ).toBeInTheDocument()
  }

  it("queues Thread Beta when submitted while Thread Alpha is streaming", async () => {
    const mockA = createMockStream()
    const mockB = createMockStream()

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("thread-A")) {
        return new Response(mockA.stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      }
      if (url.includes("thread-B")) {
        return new Response(mockB.stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      }
      return new Response("Not found", { status: 404 })
    })
    globalThis.fetch = fetchMock

    const Component = Route.options.component as React.ComponentType
    renderWithClient(<Component />)

    await screen.findByText("Thread Alpha")
    await screen.findByText("Alpha initial prompt")

    submitPrompt("Run generation on Alpha")

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/ai/threads/thread-A/chat"),
        expect.anything(),
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId("thread-generating-badge")).toBeInTheDocument()
    })

    selectSidebarThread("Thread Beta")
    await screen.findByText("Beta initial prompt")

    submitPrompt("Run prompt on Beta")

    expect(await screen.findByText("Run prompt on Beta")).toBeInTheDocument()
    await expectQueuedIndicator()
    expect(screen.getByTestId("thread-queued-badge")).toBeInTheDocument()

    const betaCallsBefore = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("thread-B"),
    )
    expect(betaCallsBefore.length).toBe(0)

    mockA.enqueueText("Alpha completed successfully")

    await waitFor(
      () => {
        const betaCallsAfter = fetchMock.mock.calls.filter((c) =>
          String(c[0]).includes("thread-B"),
        )
        expect(betaCallsAfter.length).toBe(1)
      },
      { timeout: 3000 },
    )

    mockB.enqueueText("Beta response is here!")

    expect(
      await screen.findByText("Beta response is here!"),
    ).toBeInTheDocument()
  })

  it("can cancel a queued turn in Thread Beta without interrupting active Thread Alpha stream", async () => {
    const mockA = createMockStream()

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("thread-A")) {
        return new Response(mockA.stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      }
      return new Response("Not found", { status: 404 })
    })
    globalThis.fetch = fetchMock

    const Component = Route.options.component as React.ComponentType
    renderWithClient(<Component />)

    await screen.findByText("Thread Alpha")
    submitPrompt("Prompt on Alpha")

    await waitFor(() => {
      expect(screen.getByTestId("thread-generating-badge")).toBeInTheDocument()
    })

    selectSidebarThread("Thread Beta")
    await screen.findByText("Beta initial prompt")

    submitPrompt("Queued prompt on Beta")
    expect(await screen.findByText("Queued prompt on Beta")).toBeInTheDocument()
    await expectQueuedIndicator()

    const stopButton = screen.getByRole("button", {
      name: /stop generating/i,
    })
    fireEvent.click(stopButton)

    await waitFor(() => {
      expect(
        screen.queryByText(
          /Queued • Waiting for active generation to finish.../i,
        ),
      ).not.toBeInTheDocument()
    })

    expect(screen.getByPlaceholderText("Ask anything")).toHaveValue(
      "Queued prompt on Beta",
    )
    expect(screen.getByTestId("thread-generating-badge")).toBeInTheDocument()
    mockA.close()
  })

  it("deleting a queued thread purges it from the queue and prevents it from streaming when active stream finishes", async () => {
    const mockA = createMockStream()

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("thread-A")) {
        return new Response(mockA.stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      }
      return new Response("Not found", { status: 404 })
    })
    globalThis.fetch = fetchMock

    const Component = Route.options.component as React.ComponentType
    renderWithClient(<Component />)

    await screen.findByText("Thread Alpha")
    submitPrompt("Prompt on Alpha")

    await waitFor(() => {
      expect(screen.getByTestId("thread-generating-badge")).toBeInTheDocument()
    })

    selectSidebarThread("Thread Beta")
    await screen.findByText("Beta initial prompt")

    submitPrompt("Queued on Beta")
    expect(await screen.findByText("Queued on Beta")).toBeInTheDocument()

    const kebabButtons = await screen.findAllByRole("button", {
      name: /thread options/i,
    })
    fireEvent.click(kebabButtons[1])

    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }))
    fireEvent.click(screen.getByRole("button", { name: /^delete chat$/i }))

    await waitFor(() => {
      expect(AiThreadsService.deleteChatThread).toHaveBeenCalledWith({
        id: "thread-B",
      })
    })

    mockA.enqueueText("Alpha done")
    await new Promise((r) => setTimeout(r, 200))

    const betaCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("thread-B"),
    )
    expect(betaCalls.length).toBe(0)
  })

  it("queues follow-up prompt in the same thread while streaming and executes sequentially", async () => {
    const mock1 = createMockStream()
    const mock2 = createMockStream()

    let callCount = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return new Response(mock1.stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      }
      return new Response(mock2.stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    })
    globalThis.fetch = fetchMock

    const Component = Route.options.component as React.ComponentType
    renderWithClient(<Component />)

    await screen.findByText("Thread Alpha")
    await screen.findByText("Alpha initial prompt")

    submitPrompt("Turn 1 prompt")
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    submitPrompt("Turn 2 queued follow-up")

    expect(
      await screen.findByText("Turn 2 queued follow-up"),
    ).toBeInTheDocument()
    await expectQueuedIndicator()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    mock1.enqueueText("Turn 1 answer")

    await waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalledTimes(2)
      },
      { timeout: 3000 },
    )

    mock2.enqueueText("Turn 2 answer complete")

    expect(
      await screen.findByText("Turn 2 answer complete"),
    ).toBeInTheDocument()
  })
})
