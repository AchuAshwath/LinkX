import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
        data: [
          { id: "gpt-5.4", name: "GPT-5.4" },
          { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
          { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
        ],
        default_model: "gpt-5.4",
        observation_model: "gpt-5.6-luna",
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

function mockFirstNewThread() {
  vi.mocked(AiThreadsService.listChatThreads).mockResolvedValue({
    data: [],
    count: 0,
  })
  vi.mocked(AiThreadsService.createChatThread).mockResolvedValue({
    id: "thread-new",
    title: "New conversation",
    origin: "composer",
    message_count: 0,
    is_archived: false,
    transcript: { messages: [] },
    owner_id: "user-1",
  })
  vi.mocked(AiThreadsService.getChatThread).mockResolvedValue({
    id: "thread-new",
    title: "New conversation",
    origin: "composer",
    message_count: 0,
    is_archived: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    owner_id: "user-1",
    transcript: { messages: [] },
  })
}

function setupBrowserCapture() {
  const stopTrack = vi.fn()
  const trackListeners = new Map<string, EventListener>()
  const track = {
    kind: "video",
    readyState: "live",
    muted: false,
    getSettings: () => ({ displaySurface: "browser" }),
    stop: stopTrack,
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      trackListeners.set(type, listener)
    }),
    removeEventListener: vi.fn(),
  }
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getDisplayMedia: vi.fn().mockResolvedValue(stream) },
  })
  let previewStream: MediaStream | null = null
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
    configurable: true,
    get: () => previewStream,
    set: (value: MediaStream | null) => {
      previewStream = value
    },
  })
  return {
    stopTrack,
    trackListeners,
    track,
    stream,
    getPreviewStream: () => previewStream,
  }
}

function installBrowserPreviewRail() {
  const rail = document.createElement("div")
  rail.dataset.browserPreviewRail = ""
  rail.getBoundingClientRect = () => new DOMRect(0, 0, 272, 768)
  const start = document.createElement("button")
  start.dataset.browserPreviewStart = ""
  start.getBoundingClientRect = () => new DOMRect(16, 320, 240, 44)
  const profile = document.createElement("div")
  profile.dataset.browserPreviewEnd = ""
  profile.getBoundingClientRect = () => new DOMRect(16, 700, 240, 60)
  document.body.append(rail, start, profile)
}

afterEach(() => {
  document
    .querySelectorAll(
      "[data-browser-preview-rail], [data-browser-preview-start], [data-browser-preview-end]",
    )
    .forEach((element) => {
      element.remove()
    })
})

async function selectBrowserTab() {
  const trigger = await screen.findByRole("button", {
    name: "Add attachment or browser tab",
  })
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" })
  fireEvent.click(trigger)
  fireEvent.click(await screen.findByRole("menuitem", { name: "Browser tab" }))
  await screen.findByRole("button", { name: "Stop sharing browser tab" })
  return screen.getByLabelText("Preview of shared browser tab")
}

function presentPreviewFrame(preview: HTMLElement) {
  Object.defineProperties(preview, {
    readyState: {
      configurable: true,
      value: HTMLMediaElement.HAVE_CURRENT_DATA,
    },
    videoWidth: { configurable: true, value: 640 },
    videoHeight: { configurable: true, value: 480 },
  })
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,QUJD",
  )
  fireEvent.loadedData(preview)
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
    document.getElementById("browser-tab-preview-slot")?.remove()
    const previewSlot = document.createElement("div")
    previewSlot.id = "browser-tab-preview-slot"
    document.body.append(previewSlot)
    localStorage.setItem("access_token", "test-token")
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
          model: "gpt-5.4",
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
          model: "gpt-5.4",
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
          model: "gpt-5.4",
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

  it("updates URL with threadId when a thread is clicked in sidebar", async () => {
    window.history.replaceState({}, "", "/ai")
    const Component = Route.options.component as React.ComponentType
    renderWithClient(
      <AIChatProvider>
        <Component />
      </AIChatProvider>,
    )

    await screen.findByText("Showcase markdown capabilities")

    const archivedThreadBtn = await screen.findByText("Archived Discussion")
    fireEvent.click(archivedThreadBtn)

    await waitFor(() => {
      expect(window.location.search).toContain("threadId=thread-archived")
    })
  })

  it("returns to previous thread or new chat on browser Back button popstate", async () => {
    window.history.replaceState({}, "", "/ai?threadId=thread-1")
    const Component = Route.options.component as React.ComponentType
    renderWithClient(
      <AIChatProvider>
        <Component />
      </AIChatProvider>,
    )

    await screen.findByText("Rich Markdown & Typography")

    // Click Archived Discussion
    const archivedThreadBtn = await screen.findByText("Archived Discussion")
    fireEvent.click(archivedThreadBtn)

    await waitFor(() => {
      expect(window.location.search).toContain("threadId=thread-archived")
    })

    // Simulate browser Back button: URL goes back to /ai?threadId=thread-1
    window.history.pushState(
      { threadId: "thread-1" },
      "",
      "/ai?threadId=thread-1",
    )
    window.dispatchEvent(new PopStateEvent("popstate"))

    await waitFor(() => {
      expect(AiThreadsService.getChatThread).toHaveBeenLastCalledWith({
        id: "thread-1",
      })
    })
  })

  it("clears threadId from URL and switches to New Chat view on clicking New Chat", async () => {
    window.history.replaceState({}, "", "/ai?threadId=thread-1")
    const Component = Route.options.component as React.ComponentType
    renderWithClient(
      <AIChatProvider>
        <Component />
      </AIChatProvider>,
    )

    await screen.findByText("Rich Markdown & Typography")

    const newChatBtns = await screen.findAllByRole("button", {
      name: /new chat/i,
    })
    fireEvent.click(newChatBtns[0])

    await waitFor(() => {
      expect(window.location.search).not.toContain("threadId=")
      expect(
        screen.getByText("What would you like to create?"),
      ).toBeInTheDocument()
    })
  })

  it("transitions URL cleanly to next thread when deleting active thread", async () => {
    window.history.replaceState({}, "", "/ai?threadId=thread-1")
    const Component = Route.options.component as React.ComponentType
    renderWithClient(
      <AIChatProvider>
        <Component />
      </AIChatProvider>,
    )

    await screen.findByText("Rich Markdown & Typography")

    // Open kebab menu for thread-1 and click Delete
    const kebabButtons = await screen.findAllByRole("button", {
      name: /thread options/i,
    })
    fireEvent.click(kebabButtons[0])

    const deleteBtn = await screen.findByRole("menuitem", { name: /delete/i })
    fireEvent.click(deleteBtn)

    // Confirm delete in dialog
    const confirmBtn = await screen.findByRole("button", {
      name: /^delete chat$/i,
    })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(AiThreadsService.deleteChatThread).toHaveBeenCalledWith({
        id: "thread-1",
      })
      expect(window.location.search).toContain("threadId=thread-archived")
    })
  })

  it("synchronizes selected model when loading a thread with persisted model", async () => {
    vi.mocked(AiThreadsService.listChatThreads).mockResolvedValue({
      data: [
        {
          id: "thread-model",
          title: "Model Persistence Thread",
          origin: "manual",
          model: "gpt-5.6-sol",
          message_count: 2,
          is_archived: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          owner_id: "user-1",
        },
      ],
      count: 1,
    })
    vi.mocked(AiThreadsService.getChatThread).mockResolvedValue({
      id: "thread-model",
      title: "Model Persistence Thread",
      origin: "manual",
      model: "gpt-5.6-sol",
      message_count: 2,
      is_archived: false,
      transcript: { messages: [] },
      owner_id: "user-1",
    })

    window.history.replaceState({}, "", "/ai?threadId=thread-model")

    const Component = Route.options.component as React.ComponentType
    renderWithClient(
      <AIChatProvider>
        <Component />
      </AIChatProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText("GPT-5.6 Sol")).toBeInTheDocument()
    })
  })

  it("opens quick switcher on Cmd+K and navigates to selected thread", async () => {
    vi.mocked(AiThreadsService.listChatThreads).mockResolvedValue({
      data: mockThreads,
      count: mockThreads.length,
    })
    vi.mocked(AiThreadsService.getChatThread).mockImplementation((async ({
      id,
    }: {
      id: string
    }) => {
      const found = mockThreads.find((t) => t.id === id)
      return {
        id,
        title: found?.title || "Untitled",
        origin: "manual",
        message_count: found?.message_count ?? 0,
        is_archived: found?.is_archived ?? false,
        transcript: { messages: [] },
        owner_id: "user-1",
      }
    }) as any)

    window.history.replaceState({}, "", "/ai")

    const Component = Route.options.component as React.ComponentType
    renderWithClient(
      <AIChatProvider>
        <Component />
      </AIChatProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText("Rich Markdown & Typography")).toBeInTheDocument()
    })

    // Press Cmd+K to open Quick Switcher
    fireEvent.keyDown(window, { key: "k", metaKey: true })

    // Quick Switcher dialog should be visible
    const searchInput =
      await screen.findByPlaceholderText(/search conversations/i)
    expect(searchInput).toBeInTheDocument()

    // Filter threads
    fireEvent.change(searchInput, { target: { value: "Archived" } })
    const listbox = screen.getByRole("listbox")
    expect(within(listbox).getByText("Archived Discussion")).toBeInTheDocument()

    // Select with Enter
    fireEvent.keyDown(searchInput, { key: "Enter" })

    // URL should have navigated to thread-archived
    await waitFor(() => {
      expect(window.location.search).toContain("threadId=thread-archived")
    })
  })

  it("creates new chat on Cmd+N and focuses textarea", async () => {
    vi.mocked(AiThreadsService.listChatThreads).mockResolvedValue({
      data: mockThreads,
      count: mockThreads.length,
    })
    vi.mocked(AiThreadsService.getChatThread).mockResolvedValue({
      id: "thread-1",
      title: "Rich Markdown & Typography",
      origin: "manual",
      message_count: 2,
      is_archived: false,
      transcript: { messages: [] },
      owner_id: "user-1",
    })

    window.history.replaceState({}, "", "/ai?threadId=thread-1")

    const Component = Route.options.component as React.ComponentType
    renderWithClient(
      <AIChatProvider>
        <Component />
      </AIChatProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText("Rich Markdown & Typography")).toBeInTheDocument()
    })

    // Press Cmd+N to start new chat
    fireEvent.keyDown(window, { key: "n", metaKey: true })

    await waitFor(() => {
      expect(window.location.search).not.toContain("threadId=thread-1")
    })
  })

  it("closes quick switcher dialog on Escape", async () => {
    vi.mocked(AiThreadsService.listChatThreads).mockResolvedValue({
      data: mockThreads,
      count: mockThreads.length,
    })

    window.history.replaceState({}, "", "/ai")

    const Component = Route.options.component as React.ComponentType
    renderWithClient(
      <AIChatProvider>
        <Component />
      </AIChatProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText("Rich Markdown & Typography")).toBeInTheDocument()
    })

    // Open switcher
    fireEvent.keyDown(window, { key: "k", metaKey: true })
    const searchInput =
      await screen.findByPlaceholderText(/search conversations/i)
    expect(searchInput).toBeInTheDocument()

    // Press Escape
    fireEvent.keyDown(window, { key: "Escape" })

    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText(/search conversations/i),
      ).not.toBeInTheDocument()
    })
  })
})

it("makes browser tab observation available in the chat composer", async () => {
  const Component = Route.options.component as React.ComponentType
  renderWithClient(
    <AIChatProvider>
      <Component />
    </AIChatProvider>,
  )

  expect(
    await screen.findByRole("button", {
      name: "Add attachment or browser tab",
    }),
  ).toBeInTheDocument()
})

it("starts browser tab sharing from the chat composer", async () => {
  installBrowserPreviewRail()
  mockFirstNewThread()
  window.history.replaceState({}, "", "/ai")
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
  setupBrowserCapture()
  const Component = Route.options.component as React.ComponentType
  renderWithClient(
    <AIChatProvider>
      <Component />
    </AIChatProvider>,
  )

  const preview = await selectBrowserTab()

  expect(preview).toBeInTheDocument()
  expect(
    screen.getByRole("button", { name: "Stop sharing browser tab" }),
  ).toBeInTheDocument()
})

it("keeps browser tab preview when a new chat creates its first thread", async () => {
  installBrowserPreviewRail()
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
  localStorage.setItem("access_token", "test-token")
  window.history.replaceState({}, "", "/ai")
  mockFirstNewThread()
  const { stopTrack, trackListeners, stream, getPreviewStream } =
    setupBrowserCapture()
  const Component = Route.options.component as React.ComponentType
  renderWithClient(
    <AIChatProvider>
      <Component />
    </AIChatProvider>,
  )
  await screen.findByText("What would you like to create?")
  const preview = await selectBrowserTab()
  presentPreviewFrame(preview)
  const previewWindow = await screen.findByRole("region", {
    name: "Shared browser tab preview",
  })
  const initialPreviewLeft = Number.parseFloat(previewWindow.style.left)
  previewWindow.focus()
  expect(previewWindow).toHaveFocus()
  fireEvent.keyDown(previewWindow, { key: "ArrowRight" })
  expect(previewWindow.style.left).toBe(`${initialPreviewLeft + 10}px`)

  const prompt = screen.getByPlaceholderText("Ask anything")
  const form = prompt.closest("form")!
  fireEvent.change(prompt, {
    target: { value: "What is on this page?" },
  })
  vi.mocked(AiThreadsService.createChatThread).mockClear()
  vi.mocked(AiThreadsService.getChatThread).mockClear()
  globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    const operation_id = body.request_id
    const events = [
      ["browser_status", { state: "processing", operation_id }],
      [
        "browser_receipt",
        { operation_id, completed_ids: [], failed_ids: [], unused_ids: [] },
      ],
      ["text_delta", { content: "No page details were available yet." }],
      ["done", {}],
    ]
      .map(
        ([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
      )
      .join("")
    return new Response(events, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })
  })
  fireEvent.submit(form)

  await waitFor(() => {
    expect(AiThreadsService.createChatThread).toHaveBeenCalled()
    expect(AiThreadsService.getChatThread).toHaveBeenCalledWith({
      id: "thread-new",
    })
  })
  expect(
    screen.getByLabelText("Preview of shared browser tab"),
  ).toBeInTheDocument()
  const floatingPreview = screen.getByRole("region", {
    name: "Shared browser tab preview",
  })
  expect(floatingPreview.parentElement).toBe(document.body)
  expect(floatingPreview).toHaveStyle({ position: "fixed" })
  expect(screen.queryByText("Browser tab")).not.toBeInTheDocument()
  expect(stopTrack).not.toHaveBeenCalled()
  expect(getPreviewStream()).toBe(stream)

  const activePrompt = screen.getByPlaceholderText("Ask anything")
  activePrompt.focus()
  expect(activePrompt).toHaveFocus()
  act(() => {
    stopTrack()
    trackListeners.get("ended")?.(new Event("ended"))
    screen
      .getByRole("button", { name: "Add attachment or browser tab" })
      .focus()
  })
  await screen.findByRole("button", { name: "Add attachment or browser tab" })
  expect(activePrompt).toHaveFocus()
})
