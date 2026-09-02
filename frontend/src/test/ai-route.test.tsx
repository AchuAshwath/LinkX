import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AiThreadsService } from "@/client"
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
})
