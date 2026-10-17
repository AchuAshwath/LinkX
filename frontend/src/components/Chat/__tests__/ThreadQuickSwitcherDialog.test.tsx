import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ChatThreadPublic } from "@/client"
import { ThreadQuickSwitcherDialog } from "../ThreadQuickSwitcherDialog"

const MOCK_THREADS: ChatThreadPublic[] = [
  {
    id: "thread-1",
    title: "AI Strategy Brainstorm",
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    message_count: 5,
    is_archived: false,
    owner_id: "user-1",
  },
  {
    id: "thread-2",
    title: "Twitter Post Optimization",
    created_at: "2026-09-02T10:00:00Z",
    updated_at: "2026-09-02T10:00:00Z",
    message_count: 2,
    is_archived: false,
    owner_id: "user-1",
  },
  {
    id: "thread-3",
    title: "Archived Campaign Notes",
    created_at: "2026-08-15T10:00:00Z",
    updated_at: "2026-08-15T10:00:00Z",
    message_count: 10,
    is_archived: true,
    owner_id: "user-1",
  },
]

describe("ThreadQuickSwitcherDialog", () => {
  it("renders search input and list of threads when open", () => {
    render(
      <ThreadQuickSwitcherDialog
        isOpen={true}
        onClose={vi.fn()}
        onSelectThread={vi.fn()}
        threads={MOCK_THREADS}
      />,
    )

    expect(
      screen.getByPlaceholderText(/search conversations/i),
    ).toBeInTheDocument()
    expect(screen.getByText("AI Strategy Brainstorm")).toBeInTheDocument()
    expect(screen.getByText("Twitter Post Optimization")).toBeInTheDocument()
    expect(screen.getByText("Archived Campaign Notes")).toBeInTheDocument()
  })

  it("filters threads based on search input", () => {
    render(
      <ThreadQuickSwitcherDialog
        isOpen={true}
        onClose={vi.fn()}
        onSelectThread={vi.fn()}
        threads={MOCK_THREADS}
      />,
    )

    const searchInput = screen.getByPlaceholderText(/search conversations/i)
    fireEvent.change(searchInput, { target: { value: "twitter" } })

    expect(screen.getByText("Twitter Post Optimization")).toBeInTheDocument()
    expect(screen.queryByText("AI Strategy Brainstorm")).not.toBeInTheDocument()
  })

  it("shows empty state when no threads match query", () => {
    render(
      <ThreadQuickSwitcherDialog
        isOpen={true}
        onClose={vi.fn()}
        onSelectThread={vi.fn()}
        threads={MOCK_THREADS}
      />,
    )

    const searchInput = screen.getByPlaceholderText(/search conversations/i)
    fireEvent.change(searchInput, { target: { value: "nonexistent query" } })

    expect(screen.getByText(/no conversations found/i)).toBeInTheDocument()
  })

  it("navigates items with ArrowDown/ArrowUp and selects with Enter", () => {
    const handleSelect = vi.fn()
    const handleClose = vi.fn()

    render(
      <ThreadQuickSwitcherDialog
        isOpen={true}
        onClose={handleClose}
        onSelectThread={handleSelect}
        threads={MOCK_THREADS}
      />,
    )

    const searchInput = screen.getByPlaceholderText(/search conversations/i)

    // Initially first item is selected. Move to second item with ArrowDown.
    fireEvent.keyDown(searchInput, { key: "ArrowDown" })
    fireEvent.keyDown(searchInput, { key: "Enter" })

    expect(handleSelect).toHaveBeenCalledWith("thread-2")
    expect(handleClose).toHaveBeenCalled()
  })

  it("calls onSelectThread and onClose when an item is clicked", () => {
    const handleSelect = vi.fn()
    const handleClose = vi.fn()

    render(
      <ThreadQuickSwitcherDialog
        isOpen={true}
        onClose={handleClose}
        onSelectThread={handleSelect}
        threads={MOCK_THREADS}
      />,
    )

    fireEvent.click(screen.getByText("AI Strategy Brainstorm"))

    expect(handleSelect).toHaveBeenCalledWith("thread-1")
    expect(handleClose).toHaveBeenCalled()
  })

  describe("adversarial edge cases", () => {
    const SPECIAL_THREADS: ChatThreadPublic[] = [
      {
        id: "special-1",
        title: "Regex: [WIP] Feature (v2)",
        created_at: "2026-09-01T10:00:00Z",
        updated_at: "2026-09-01T10:00:00Z",
        message_count: 1,
        is_archived: false,
        owner_id: "user-1",
      },
      {
        id: "special-2",
        title: "Math: 1 + 1 = 2?",
        created_at: "2026-09-02T10:00:00Z",
        updated_at: "2026-09-02T10:00:00Z",
        message_count: 2,
        is_archived: false,
        owner_id: "user-1",
      },
      {
        id: "special-3",
        title: "Path: C:\\Users\\test\\file.txt",
        created_at: "2026-09-03T10:00:00Z",
        updated_at: "2026-09-03T10:00:00Z",
        message_count: 3,
        is_archived: false,
        owner_id: "user-1",
      },
      {
        id: "special-4",
        title: "Wildcard: .* all threads",
        created_at: "2026-09-04T10:00:00Z",
        updated_at: "2026-09-04T10:00:00Z",
        message_count: 4,
        is_archived: false,
        owner_id: "user-1",
      },
    ]

    it("handles regex special characters in search query safely without throwing", () => {
      render(
        <ThreadQuickSwitcherDialog
          isOpen={true}
          onClose={vi.fn()}
          onSelectThread={vi.fn()}
          threads={SPECIAL_THREADS}
        />,
      )

      const searchInput = screen.getByPlaceholderText(/search conversations/i)

      // Query with unclosed bracket / parens - would crash if passed to new RegExp
      expect(() => {
        fireEvent.change(searchInput, { target: { value: "[WIP" } })
      }).not.toThrow()
      expect(screen.getByText("Regex: [WIP] Feature (v2)")).toBeInTheDocument()
      expect(screen.queryByText("Math: 1 + 1 = 2?")).not.toBeInTheDocument()

      // Query with plus sign
      fireEvent.change(searchInput, { target: { value: "1 + 1" } })
      expect(screen.getByText("Math: 1 + 1 = 2?")).toBeInTheDocument()
      expect(
        screen.queryByText("Regex: [WIP] Feature (v2)"),
      ).not.toBeInTheDocument()

      // Query with backslash
      fireEvent.change(searchInput, { target: { value: "C:\\Users" } })
      expect(
        screen.getByText("Path: C:\\Users\\test\\file.txt"),
      ).toBeInTheDocument()

      // Query with wildcard .* - matches literal substring only
      fireEvent.change(searchInput, { target: { value: ".*" } })
      expect(screen.getByText("Wildcard: .* all threads")).toBeInTheDocument()
      expect(
        screen.queryByText("Regex: [WIP] Feature (v2)"),
      ).not.toBeInTheDocument()

      // Unmatched regex characters should show empty state safely
      fireEvent.change(searchInput, { target: { value: "^(?=.*abc)[def]+$" } })
      expect(screen.getByText(/no conversations found/i)).toBeInTheDocument()
    })

    it("handles whitespace queries safely", () => {
      render(
        <ThreadQuickSwitcherDialog
          isOpen={true}
          onClose={vi.fn()}
          onSelectThread={vi.fn()}
          threads={MOCK_THREADS}
        />,
      )

      const searchInput = screen.getByPlaceholderText(/search conversations/i)

      // Only spaces -> trimmed query is empty -> shows all threads
      fireEvent.change(searchInput, { target: { value: "     " } })
      expect(screen.getByText("AI Strategy Brainstorm")).toBeInTheDocument()
      expect(screen.getByText("Twitter Post Optimization")).toBeInTheDocument()
      expect(screen.getByText("Archived Campaign Notes")).toBeInTheDocument()

      // Leading and trailing spaces trimmed correctly
      fireEvent.change(searchInput, { target: { value: "   twitter   " } })
      expect(screen.getByText("Twitter Post Optimization")).toBeInTheDocument()
      expect(
        screen.queryByText("AI Strategy Brainstorm"),
      ).not.toBeInTheDocument()
    })

    it("does nothing when Enter is pressed on empty filtered results", () => {
      const handleSelect = vi.fn()
      const handleClose = vi.fn()

      render(
        <ThreadQuickSwitcherDialog
          isOpen={true}
          onClose={handleClose}
          onSelectThread={handleSelect}
          threads={MOCK_THREADS}
        />,
      )

      const searchInput = screen.getByPlaceholderText(/search conversations/i)
      fireEvent.change(searchInput, { target: { value: "no-match-at-all" } })

      expect(screen.getByText(/no conversations found/i)).toBeInTheDocument()

      fireEvent.keyDown(searchInput, { key: "Enter" })
      expect(handleSelect).not.toHaveBeenCalled()
      expect(handleClose).not.toHaveBeenCalled()
    })

    it("clamps navigation to bounds when pressing ArrowUp at 0 or ArrowDown at max", () => {
      const handleSelect = vi.fn()
      const handleClose = vi.fn()

      render(
        <ThreadQuickSwitcherDialog
          isOpen={true}
          onClose={handleClose}
          onSelectThread={handleSelect}
          threads={MOCK_THREADS}
        />,
      )

      const searchInput = screen.getByPlaceholderText(/search conversations/i)

      // Press ArrowUp multiple times while at index 0 -> stays at index 0
      fireEvent.keyDown(searchInput, { key: "ArrowUp" })
      fireEvent.keyDown(searchInput, { key: "ArrowUp" })
      fireEvent.keyDown(searchInput, { key: "Enter" })

      expect(handleSelect).toHaveBeenCalledWith("thread-1")
      handleSelect.mockClear()

      // Navigate past the bottom (3 items: 0, 1, 2)
      fireEvent.keyDown(searchInput, { key: "ArrowDown" }) // 1
      fireEvent.keyDown(searchInput, { key: "ArrowDown" }) // 2
      fireEvent.keyDown(searchInput, { key: "ArrowDown" }) // clamp to 2
      fireEvent.keyDown(searchInput, { key: "ArrowDown" }) // clamp to 2
      fireEvent.keyDown(searchInput, { key: "Enter" })

      expect(handleSelect).toHaveBeenCalledWith("thread-3")
    })

    it("ignores Arrow and Enter keys during IME composition mode", () => {
      const handleSelect = vi.fn()
      const handleClose = vi.fn()

      render(
        <ThreadQuickSwitcherDialog
          isOpen={true}
          onClose={handleClose}
          onSelectThread={handleSelect}
          threads={MOCK_THREADS}
        />,
      )

      const searchInput = screen.getByPlaceholderText(/search conversations/i)

      // IME composition Enter (e.g. confirming Japanese kanji candidate)
      fireEvent.keyDown(searchInput, {
        key: "Enter",
        isComposing: true,
      })

      expect(handleSelect).not.toHaveBeenCalled()
      expect(handleClose).not.toHaveBeenCalled()

      // IME composition ArrowDown (e.g. browsing kanji candidate menu)
      fireEvent.keyDown(searchInput, {
        key: "ArrowDown",
        isComposing: true,
      })

      // Process key or keyCode 229 during IME
      fireEvent.keyDown(searchInput, { key: "Process", keyCode: 229 })
      expect(handleSelect).not.toHaveBeenCalled()

      // Now normal Enter selects thread-1 (index was NOT moved by IME arrow)
      fireEvent.keyDown(searchInput, { key: "Enter" })
      expect(handleSelect).toHaveBeenCalledWith("thread-1")
    })

    it("dynamically clamps selectedIndex if thread list length shrinks", () => {
      const handleSelect = vi.fn()
      const { rerender } = render(
        <ThreadQuickSwitcherDialog
          isOpen={true}
          onClose={vi.fn()}
          onSelectThread={handleSelect}
          threads={MOCK_THREADS}
        />,
      )

      const searchInput = screen.getByPlaceholderText(/search conversations/i)

      // Navigate to index 2 (thread-3)
      fireEvent.keyDown(searchInput, { key: "ArrowDown" })
      fireEvent.keyDown(searchInput, { key: "ArrowDown" })

      // Rerender with only 1 thread
      rerender(
        <ThreadQuickSwitcherDialog
          isOpen={true}
          onClose={vi.fn()}
          onSelectThread={handleSelect}
          threads={[MOCK_THREADS[0]]}
        />,
      )

      // Press Enter - selectedIndex should have clamped to 0
      fireEvent.keyDown(searchInput, { key: "Enter" })
      expect(handleSelect).toHaveBeenCalledWith("thread-1")
    })

    it("safely displays fallback title for threads with null or missing title", () => {
      const namelessThread: ChatThreadPublic[] = [
        {
          id: "thread-no-title",
          title: "",
          created_at: "2026-09-01T10:00:00Z",
          updated_at: "2026-09-01T10:00:00Z",
          message_count: 0,
          is_archived: false,
          owner_id: "user-1",
        },
      ]

      render(
        <ThreadQuickSwitcherDialog
          isOpen={true}
          onClose={vi.fn()}
          onSelectThread={vi.fn()}
          threads={namelessThread}
        />,
      )

      expect(screen.getByText("Untitled Thread")).toBeInTheDocument()
    })

    it("resets query and selected index when dialog reopens", () => {
      const { rerender } = render(
        <ThreadQuickSwitcherDialog
          isOpen={true}
          onClose={vi.fn()}
          onSelectThread={vi.fn()}
          threads={MOCK_THREADS}
        />,
      )

      const searchInput = screen.getByPlaceholderText(/search conversations/i)
      fireEvent.change(searchInput, { target: { value: "twitter" } })
      expect(searchInput).toHaveValue("twitter")

      // Close dialog
      rerender(
        <ThreadQuickSwitcherDialog
          isOpen={false}
          onClose={vi.fn()}
          onSelectThread={vi.fn()}
          threads={MOCK_THREADS}
        />,
      )

      // Re-open dialog
      rerender(
        <ThreadQuickSwitcherDialog
          isOpen={true}
          onClose={vi.fn()}
          onSelectThread={vi.fn()}
          threads={MOCK_THREADS}
        />,
      )

      const newSearchInput =
        screen.getByPlaceholderText(/search conversations/i)
      expect(newSearchInput).toHaveValue("")
    })
  })
})
