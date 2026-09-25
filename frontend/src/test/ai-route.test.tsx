import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AiThreadsService } from "@/client"
import { AIChatProvider } from "@/context/AIChatContext"
import { Route } from "@/routes/_layout/ai"

// Mock AiThreadsService
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

describe("AIPage component with PostgreSQL backend persistence", () => {
  const mockThreads = [
    {
      id: "thread-1",
      title: "Rich Markdown & Typography",
      origin: "manual",
      message_count: 2,
      is_archived: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      owner_id: "user-1",
    },
    {
      id: "thread-archived",
      title: "Archived Discussion",
      origin: "composer",
      message_count: 1,
      is_archived: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      owner_id: "user-1",
    },
  ]

  const mockThreadDetail = {
    ...mockThreads[0],
    transcript: {
      messages: [
        {
          id: "m-101",
          role: "user",
          parts: [{ type: "text", text: "Showcase markdown capabilities" }],
        },
        {
          id: "m-102",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "Launching Next-Gen Social Growth with LinkX",
            },
          ],
        },
      ],
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    try {
      window.history.replaceState({}, "", "/")
    } catch {
      // ignore
    }
    vi.mocked(AiThreadsService.listChatThreads).mockResolvedValue({
      data: mockThreads,
      count: mockThreads.length,
    })
    vi.mocked(AiThreadsService.getChatThread).mockResolvedValue(
      mockThreadDetail,
    )
    vi.mocked(AiThreadsService.createChatThread).mockResolvedValue({
      id: "thread-new",
      title: "New conversation",
      origin: "composer",
      message_count: 0,
      is_archived: false,
      transcript: { messages: [] },
      owner_id: "user-1",
    })
    vi.mocked(AiThreadsService.updateChatThread).mockResolvedValue(
      mockThreads[0],
    )
    vi.mocked(AiThreadsService.deleteChatThread).mockResolvedValue({
      message: "Chat thread deleted successfully",
    })
  })

  it("renders AIPage with persistent threads from backend", async () => {
    const Component = Route.options.component as React.ComponentType
    renderWithClient(<Component />)

    await waitFor(() => {
      expect(
        screen.getAllByLabelText(/New Chat/i).length,
      ).toBeGreaterThanOrEqual(1)
      expect(
        screen.getAllByText("Rich Markdown & Typography").length,
      ).toBeGreaterThanOrEqual(1)
    })

    expect(
      await screen.findByText(/Launching Next-Gen Social Growth with LinkX/),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Ask anything")).toBeInTheDocument()
  })

  it("can switch to another thread and load its transcript", async () => {
    const Component = Route.options.component as React.ComponentType
    renderWithClient(<Component />)

    const archivedThreadBtn = await screen.findByText("Archived Discussion")
    fireEvent.click(archivedThreadBtn)

    await waitFor(() => {
      expect(AiThreadsService.getChatThread).toHaveBeenCalledWith({
        id: "thread-archived",
      })
    })
  })

  it("can switch to new chat view and create a new chat on message", async () => {
    const Component = Route.options.component as React.ComponentType
    renderWithClient(<Component />)

    // Wait for initial thread to load first
    await screen.findByText("Rich Markdown & Typography")

    const newChatBtns = await screen.findAllByRole("button", {
      name: /new chat/i,
    })
    fireEvent.click(newChatBtns[0])

    // Should switch to empty New Chat state
    expect(
      await screen.findByText("What would you like to create?"),
    ).toBeInTheDocument()

    // Clicking a suggestion creates the new chat with that prompt
    const suggestionBtn = screen.getByText("Viral Launch Post")
    fireEvent.click(suggestionBtn)

    await waitFor(() => {
      expect(AiThreadsService.createChatThread).toHaveBeenCalled()
    })
  })

  it("can rename a thread via kebab menu and persist to backend", async () => {
    const Component = Route.options.component as React.ComponentType
    renderWithClient(<Component />)

    const kebabButtons = await screen.findAllByRole("button", {
      name: /thread options/i,
    })
    fireEvent.click(kebabButtons[0])

    const renameBtn = screen.getByRole("menuitem", { name: /rename/i })
    fireEvent.click(renameBtn)

    const editInput = screen.getByDisplayValue("Rich Markdown & Typography")
    fireEvent.change(editInput, { target: { value: "Renamed Thread Title" } })
    fireEvent.submit(editInput.closest("form")!)

    await waitFor(() => {
      expect(AiThreadsService.updateChatThread).toHaveBeenCalledWith({
        id: "thread-1",
        requestBody: { title: "Renamed Thread Title" },
      })
    })
  })

  it("shows Archive button on recent threads and Delete button on archived threads", async () => {
    const Component = Route.options.component as React.ComponentType
    renderWithClient(<Component />)

    const archiveButtons = await screen.findAllByRole("button", {
      name: /archive thread/i,
    })
    expect(archiveButtons.length).toBeGreaterThanOrEqual(1)

    const deleteButtons = screen.getAllByRole("button", {
      name: /delete thread/i,
    })
    expect(deleteButtons.length).toBeGreaterThanOrEqual(1)

    // Archive the recent thread
    fireEvent.click(archiveButtons[0])
    await waitFor(() => {
      expect(AiThreadsService.updateChatThread).toHaveBeenCalledWith({
        id: "thread-1",
        requestBody: { is_archived: true },
      })
    })

    // Click delete on the archived thread (opens confirmation dialog)
    fireEvent.click(deleteButtons[0])

    // Verify modal appeared
    expect(
      await screen.findByText(/This will permanently delete/i),
    ).toBeInTheDocument()

    // Confirm deletion inside modal
    const confirmDeleteBtn = screen.getByRole("button", {
      name: /^delete chat$/i,
    })
    fireEvent.click(confirmDeleteBtn)

    await waitFor(() => {
      expect(AiThreadsService.deleteChatThread).toHaveBeenCalledWith({
        id: "thread-archived",
      })
    })
  })

  it("does not switch to older thread when threads list loads after a new chat is created (Issue #127)", async () => {
    // Simulate threads list initially empty (loading delay)
    let threadListResponse: Array<(typeof mockThreads)[0]> = []
    vi.mocked(AiThreadsService.listChatThreads).mockImplementation(
      () =>
        Promise.resolve({
          data: threadListResponse,
          count: threadListResponse.length,
        }) as any,
    )

    const newThread = {
      id: "thread-new",
      title: "Newly Created Conversation",
      origin: "composer",
      message_count: 1,
      is_archived: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      transcript: { messages: [] },
      owner_id: "user-1",
    }
    vi.mocked(AiThreadsService.createChatThread).mockResolvedValue(newThread)
    vi.mocked(AiThreadsService.getChatThread).mockResolvedValue({
      ...newThread,
      transcript: {
        messages: [
          {
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "New conversation prompt" }],
          },
        ],
      },
    })

    const Component = Route.options.component as React.ComponentType
    renderWithClient(<Component />)

    // User is on empty new chat view
    expect(
      await screen.findByText("What would you like to create?"),
    ).toBeInTheDocument()

    // When new thread is created, update the thread list query response
    // to include the old threads plus the new one
    threadListResponse = [mockThreads[0], newThread]

    // User submits prompt via suggestion
    const suggestionBtn = screen.getByText("Viral Launch Post")
    fireEvent.click(suggestionBtn)

    await waitFor(() => {
      expect(AiThreadsService.createChatThread).toHaveBeenCalled()
    })

    // Wait for the new thread to be selected
    await waitFor(() => {
      expect(AiThreadsService.getChatThread).toHaveBeenCalledWith({
        id: "thread-new",
      })
    })

    // Give React Query time to refetch threads
    await new Promise((r) => setTimeout(r, 100))

    // The active thread MUST NOT switch to mockThreads[0] ("thread-1")!
    expect(AiThreadsService.getChatThread).not.toHaveBeenCalledWith({
      id: "thread-1",
    })
    expect(AiThreadsService.getChatThread).toHaveBeenLastCalledWith({
      id: "thread-new",
    })
  })

  it("allows switching to new chat when initialThreadId is present in URL", async () => {
    window.history.replaceState({}, "", "/ai?threadId=thread-1")
    const Component = Route.options.component as React.ComponentType
    renderWithClient(<Component />)

    // Wait for thread-1 to load
    await screen.findByText("Rich Markdown & Typography")

    // Click New Chat button
    const newChatBtns = await screen.findAllByRole("button", {
      name: /new chat/i,
    })
    fireEvent.click(newChatBtns[0])

    // Should switch to empty New Chat state and stay there!
    expect(
      await screen.findByText("What would you like to create?"),
    ).toBeInTheDocument()
  })

  it("preserves active streaming when unmounting and remounting AIPage under AIChatProvider (navigation resilience)", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        controller = ctrl
      },
    })
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    })
    globalThis.fetch = fetchMock

    const Component = Route.options.component as React.ComponentType

    function TestApp({ showPage }: { showPage: boolean }) {
      return (
        <AIChatProvider>
          {showPage ? <Component /> : <div>Navigated Away to Home</div>}
        </AIChatProvider>
      )
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <TestApp showPage={true} />
      </QueryClientProvider>,
    )

    await screen.findByText("Rich Markdown & Typography")
    const input = screen.getByPlaceholderText("Ask anything")
    fireEvent.change(input, { target: { value: "Streaming prompt" } })
    fireEvent.submit(input.closest("form")!)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    // Simulate navigation away to another page (e.g. /home)
    rerender(
      <QueryClientProvider client={queryClient}>
        <TestApp showPage={false} />
      </QueryClientProvider>,
    )
    expect(screen.getByText("Navigated Away to Home")).toBeInTheDocument()

    // While away on another page, the stream emits text delta
    const encoder = new TextEncoder()
    controller!.enqueue(
      encoder.encode(
        `event: text_delta\ndata: {"content": "Data arrived while away"}\n\n`,
      ),
    )

    // Simulate navigation back to /ai
    rerender(
      <QueryClientProvider client={queryClient}>
        <TestApp showPage={true} />
      </QueryClientProvider>,
    )

    // The text delta should be visible and retained!
    expect(
      await screen.findByText("Data arrived while away"),
    ).toBeInTheDocument()

    controller!.close()
  })

  it("handles autoRun prompt navigation without clobbering to older thread-1 (Issue #135)", async () => {
    window.history.replaceState(
      {},
      "",
      "/ai?prompt=What%20are%20the%20trending%20topics&autoRun=true",
    )
    const Component = Route.options.component as React.ComponentType
    renderWithClient(
      <AIChatProvider>
        <Component />
      </AIChatProvider>,
    )

    await waitFor(() => {
      expect(AiThreadsService.createChatThread).toHaveBeenCalledWith({
        requestBody: {
          origin: "composer",
          prompt: "What are the trending topics",
        },
      })
    })

    // Must not have selected older thread-1
    expect(AiThreadsService.getChatThread).not.toHaveBeenCalledWith({
      id: "thread-1",
    })
  })

  it("isolates autoRun prompt into a new thread when transitioning from an existing thread", async () => {
    window.history.replaceState({}, "", "/ai?threadId=thread-1")
    const Component = Route.options.component as React.ComponentType

    function TestApp({ url }: { url: string }) {
      window.history.replaceState({}, "", url)
      return (
        <AIChatProvider>
          <Component />
        </AIChatProvider>
      )
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <TestApp url="/ai?threadId=thread-1" />
      </QueryClientProvider>,
    )

    await screen.findByText("Rich Markdown & Typography")
    vi.mocked(AiThreadsService.createChatThread).mockClear()

    rerender(
      <QueryClientProvider client={queryClient}>
        <TestApp url="/ai?prompt=What%20is%20trending&autoRun=true" />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(AiThreadsService.createChatThread).toHaveBeenCalledWith({
        requestBody: {
          origin: "composer",
          prompt: "What is trending",
        },
      })
    })
  })

  function setupScrapeThreadScenario({
    title,
    transcriptText,
    searchUrl,
  }: {
    title: string
    transcriptText: string
    searchUrl: string
  }) {
    const scrapeThread = {
      id: "thread-scrape-dedicated",
      title,
      origin: "trending",
      message_count: 2,
      is_archived: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      owner_id: "user-1",
    }

    vi.mocked(AiThreadsService.listChatThreads).mockResolvedValue({
      data: [scrapeThread, mockThreads[0]],
      count: 2,
    })
    vi.mocked(AiThreadsService.getChatThread).mockResolvedValue({
      ...scrapeThread,
      transcript: {
        messages: [
          {
            id: "m-scrape-1",
            role: "assistant",
            parts: [{ type: "text", text: transcriptText }],
          },
        ],
      },
    })
    vi.mocked(AiThreadsService.createChatThread).mockClear()
    window.history.replaceState({}, "", searchUrl)
  }

  it("always creates a new thread on 'Refresh trending topics from X' even if an older scrape thread exists", async () => {
    setupScrapeThreadScenario({
      title: "Trending Topics",
      transcriptText: "Previous trending topics report",
      searchUrl:
        "/ai?prompt=Refresh%20trending%20topics%20from%20X&autoRun=true",
    })

    const Component = Route.options.component as React.ComponentType
    renderWithClient(
      <AIChatProvider>
        <Component />
      </AIChatProvider>,
    )

    // Should create a brand new thread for this scrape run
    await waitFor(() => {
      expect(AiThreadsService.createChatThread).toHaveBeenCalledWith({
        requestBody: {
          origin: "trending",
          prompt: "Refresh trending topics from X",
          topic_keyword: "trending_scrape",
        },
      })
    })
  })

  it("targets explicit scrape threadId when provided in search params without creating a new thread", async () => {
    setupScrapeThreadScenario({
      title: "Refresh trending topics from X",
      transcriptText: "Dedicated scrape transcript",
      searchUrl:
        "/ai?threadId=thread-scrape-dedicated&prompt=Refresh%20trending%20topics%20from%20X&autoRun=true",
    })

    const Component = Route.options.component as React.ComponentType
    renderWithClient(
      <AIChatProvider>
        <Component />
      </AIChatProvider>,
    )

    await screen.findByText("Dedicated scrape transcript")
    expect(AiThreadsService.createChatThread).not.toHaveBeenCalled()
  })
})
