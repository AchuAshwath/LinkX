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

  it("queues Thread Beta when submitted while Thread Alpha is streaming", async () => {
    let controllerA: any = null
    const streamA = new ReadableStream<Uint8Array>({
      start(ctrl) {
        controllerA = ctrl
      },
    })

    let controllerB: any = null
    const streamB = new ReadableStream<Uint8Array>({
      start(ctrl) {
        controllerB = ctrl
      },
    })

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("thread-A")) {
        return new Response(streamA, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      }
      if (url.includes("thread-B")) {
        return new Response(streamB, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      }
      return new Response("Not found", { status: 404 })
    })
    globalThis.fetch = fetchMock

    const Component = Route.options.component as React.ComponentType
    renderWithClient(<Component />)

    // Wait for Thread Alpha to load initially
    await screen.findByText("Thread Alpha")
    await screen.findByText("Alpha initial prompt")

    // Send a message in Thread Alpha
    const input = screen.getByPlaceholderText("Ask anything")
    fireEvent.change(input, { target: { value: "Run generation on Alpha" } })
    fireEvent.submit(input.closest("form")!)

    // Verify fetch was called for thread-A
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/ai/threads/thread-A/chat"),
        expect.anything(),
      )
    })

    // Verify Thread Alpha shows generating badge in sidebar
    await waitFor(() => {
      expect(screen.getByTestId("thread-generating-badge")).toBeInTheDocument()
    })

    // Now switch to Thread Beta in sidebar WITHOUT aborting Thread Alpha
    const threadBetaBtn = screen.getByText("Thread Beta")
    fireEvent.click(threadBetaBtn)

    // Verify Thread Beta messages load
    await screen.findByText("Beta initial prompt")

    // In Thread Beta, input should NOT be disabled; user can submit
    const inputBeta = screen.getByPlaceholderText("Ask anything")
    fireEvent.change(inputBeta, { target: { value: "Run prompt on Beta" } })
    fireEvent.submit(inputBeta.closest("form")!)

    // Verify Thread Beta displays user message and queued assistant indicator
    expect(await screen.findByText("Run prompt on Beta")).toBeInTheDocument()
    expect(
      await screen.findByText(
        /Queued • Waiting for active generation to finish.../i,
      ),
    ).toBeInTheDocument()

    // Verify Thread Beta has queued badge in sidebar
    expect(screen.getByTestId("thread-queued-badge")).toBeInTheDocument()

    // Thread B should NOT have called fetch yet because Thread A is still streaming!
    const betaCallsBefore = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("thread-B"),
    )
    expect(betaCallsBefore.length).toBe(0)

    // Now finish Thread Alpha stream
    const encoder = new TextEncoder()
    controllerA?.enqueue(
      encoder.encode(
        'event: text_delta\ndata: {"content": "Alpha completed successfully"}\n\nevent: done\ndata: {}\n\n',
      ),
    )
    controllerA?.close()

    // Once Thread Alpha completes, the queue automatically triggers Thread Beta's stream!
    await waitFor(
      () => {
        const betaCallsAfter = fetchMock.mock.calls.filter((c) =>
          String(c[0]).includes("thread-B"),
        )
        expect(betaCallsAfter.length).toBe(1)
      },
      { timeout: 3000 },
    )

    // Send chunks to Thread Beta
    controllerB?.enqueue(
      encoder.encode(
        'event: text_delta\ndata: {"content": "Beta response is here!"}\n\nevent: done\ndata: {}\n\n',
      ),
    )
    controllerB?.close()

    // Verify Thread Beta receives response text
    expect(
      await screen.findByText("Beta response is here!"),
    ).toBeInTheDocument()
  })

  it("can cancel a queued turn in Thread Beta without interrupting active Thread Alpha stream", async () => {
    let controllerA: any = null
    const streamA = new ReadableStream<Uint8Array>({
      start(ctrl) {
        controllerA = ctrl
      },
    })

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("thread-A")) {
        return new Response(streamA, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      }
      return new Response("Not found", { status: 404 })
    })
    globalThis.fetch = fetchMock

    const Component = Route.options.component as React.ComponentType
    renderWithClient(<Component />)

    // Wait for Thread Alpha to load and start streaming
    await screen.findByText("Thread Alpha")
    const input = screen.getByPlaceholderText("Ask anything")
    fireEvent.change(input, { target: { value: "Prompt on Alpha" } })
    fireEvent.submit(input.closest("form")!)

    await waitFor(() => {
      expect(screen.getByTestId("thread-generating-badge")).toBeInTheDocument()
    })

    // Switch to Thread Beta and submit a prompt to queue it
    const threadBetaBtn = screen.getByText("Thread Beta")
    fireEvent.click(threadBetaBtn)
    await screen.findByText("Beta initial prompt")

    const inputBeta = screen.getByPlaceholderText("Ask anything")
    fireEvent.change(inputBeta, { target: { value: "Queued prompt on Beta" } })
    fireEvent.submit(inputBeta.closest("form")!)

    expect(await screen.findByText("Queued prompt on Beta")).toBeInTheDocument()
    expect(
      await screen.findByText(
        /Queued • Waiting for active generation to finish.../i,
      ),
    ).toBeInTheDocument()

    // PromptForm in Thread Beta now displays Stop button
    const stopButton = screen.getByRole("button", {
      name: /stop generating/i,
    })
    fireEvent.click(stopButton)

    // Queued indicator is removed from Thread Beta
    await waitFor(() => {
      expect(
        screen.queryByText(
          /Queued • Waiting for active generation to finish.../i,
        ),
      ).not.toBeInTheDocument()
    })

    // The user's prompt is restored to the input box so it is not lost
    expect(screen.getByPlaceholderText("Ask anything")).toHaveValue(
      "Queued prompt on Beta",
    )

    // Thread Alpha is STILL running and generating!
    expect(screen.getByTestId("thread-generating-badge")).toBeInTheDocument()

    // Clean up stream A
    controllerA?.close()
  })

  it("deleting a queued thread purges it from the queue and prevents it from streaming when active stream finishes", async () => {
    let controllerA: any = null
    const streamA = new ReadableStream<Uint8Array>({
      start(ctrl) {
        controllerA = ctrl
      },
    })

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("thread-A")) {
        return new Response(streamA, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      }
      return new Response("Not found", { status: 404 })
    })
    globalThis.fetch = fetchMock

    const Component = Route.options.component as React.ComponentType
    renderWithClient(<Component />)

    // Start Thread Alpha streaming
    await screen.findByText("Thread Alpha")
    const input = screen.getByPlaceholderText("Ask anything")
    fireEvent.change(input, { target: { value: "Prompt on Alpha" } })
    fireEvent.submit(input.closest("form")!)

    await waitFor(() => {
      expect(screen.getByTestId("thread-generating-badge")).toBeInTheDocument()
    })

    // Switch to Thread Beta and submit a prompt to queue it
    const threadBetaBtn = screen.getByText("Thread Beta")
    fireEvent.click(threadBetaBtn)
    await screen.findByText("Beta initial prompt")

    const inputBeta = screen.getByPlaceholderText("Ask anything")
    fireEvent.change(inputBeta, { target: { value: "Queued on Beta" } })
    fireEvent.submit(inputBeta.closest("form")!)

    expect(await screen.findByText("Queued on Beta")).toBeInTheDocument()

    // Open options menu for Thread Beta and click Delete
    const kebabButtons = await screen.findAllByRole("button", {
      name: /thread options/i,
    })
    fireEvent.click(kebabButtons[1]) // Thread Beta kebab

    const deleteMenuItem = screen.getByRole("menuitem", { name: /delete/i })
    fireEvent.click(deleteMenuItem)

    // Confirm deletion inside dialog
    const confirmDeleteBtn = screen.getByRole("button", {
      name: /^delete chat$/i,
    })
    fireEvent.click(confirmDeleteBtn)

    // Verify backend delete was invoked
    await waitFor(() => {
      expect(AiThreadsService.deleteChatThread).toHaveBeenCalledWith({
        id: "thread-B",
      })
    })

    // Now finish Thread Alpha stream
    const encoder = new TextEncoder()
    controllerA?.enqueue(
      encoder.encode(
        'event: text_delta\ndata: {"content": "Alpha done"}\n\nevent: done\ndata: {}\n\n',
      ),
    )
    controllerA?.close()

    // Wait 200ms to ensure no queued turn for Thread Beta is executed
    await new Promise((r) => setTimeout(r, 200))

    const betaCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("thread-B"),
    )
    expect(betaCalls.length).toBe(0)
  })
})
