import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChatMessage } from "../ChatMessage"
import type { ChatUIMessage } from "../types"

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

describe("ChatMessage component", () => {
  it("renders user message in an end-aligned bubble", () => {
    const message: ChatUIMessage = {
      id: "msg-1",
      role: "user",
      parts: [{ type: "text", text: "Create a tweet about LinkX" }],
    }

    render(<ChatMessage message={message} />)
    expect(screen.getByText("Create a tweet about LinkX")).toBeInTheDocument()
  })

  it("renders assistant message markdown text part", () => {
    const message: ChatUIMessage = {
      id: "msg-2",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "**LinkX** is the next-gen social media manager.\n\n- Multi-channel\n- Autonomous",
        },
      ],
    }

    render(<ChatMessage message={message} />)
    expect(screen.getByText("LinkX")).toBeInTheDocument()
    expect(screen.getByText("Multi-channel")).toBeInTheDocument()
    expect(screen.getByText("Autonomous")).toBeInTheDocument()
  })

  it("renders abstract collapsible web search tool call", () => {
    const message: ChatUIMessage = {
      id: "msg-3",
      role: "assistant",
      parts: [
        {
          type: "tool-web_search",
          toolCallId: "search-1",
          state: "output-available",
          input: { query: "trending tech hashtags" },
        },
      ],
    }

    render(<ChatMessage message={message} />)
    const toggleBtn = screen.getByRole("button", {
      name: /toggle web search details/i,
    })
    expect(toggleBtn).toBeInTheDocument()
    expect(screen.getByText(/searched the web/i)).toBeInTheDocument()

    // Expand accordion to see the searched query
    fireEvent.click(toggleBtn)
    expect(screen.getByText(/trending tech hashtags/)).toBeInTheDocument()
  })

  it("renders visited sites inside the expanded web search accordion", () => {
    const message: ChatUIMessage = {
      id: "msg-4",
      role: "assistant",
      parts: [
        {
          type: "tool-web_search",
          toolCallId: "search-2",
          state: "output-available",
          input: { query: "AI agent frameworks" },
        },
        {
          type: "source-url",
          sourceId: "src-1",
          url: "https://techcrunch.com/article",
          title: "TechCrunch Article",
        },
      ],
    }

    render(<ChatMessage message={message} isStreaming={false} />)
    const toggleBtn = screen.getByRole("button", {
      name: /toggle web search details/i,
    })

    // Click to expand and view the visited sites
    fireEvent.click(toggleBtn)
    expect(screen.getByText(/TechCrunch Article/i)).toBeInTheDocument()
    expect(screen.getByText(/techcrunch\.com/i)).toBeInTheDocument()
  })

  it("renders user attached image thumbnails", () => {
    const message: ChatUIMessage = {
      id: "msg-5",
      role: "user",
      parts: [
        { type: "text", text: "Look at this preview" },
        { type: "image_url", url: "https://example.com/chart.png" },
      ],
    }

    render(<ChatMessage message={message} />)
    expect(screen.getByText("Look at this preview")).toBeInTheDocument()
    const img = screen.getByAltText("Attachment 1")
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute("src", "https://example.com/chart.png")
  })

  it("filters out unsafe image URL schemes", () => {
    const message: ChatUIMessage = {
      id: "msg-unsafe",
      role: "user",
      parts: [
        { type: "text", text: "Malicious test" },
        { type: "image_url", url: "javascript:alert(1)" },
      ],
    }

    render(<ChatMessage message={message} />)
    expect(screen.queryByAltText("Attachment 1")).not.toBeInTheDocument()
  })

  it("hides broken images on error", () => {
    const message: ChatUIMessage = {
      id: "msg-broken",
      role: "user",
      parts: [
        { type: "text", text: "Broken preview" },
        { type: "image_url", url: "https://example.com/broken.png" },
      ],
    }

    render(<ChatMessage message={message} />)
    const img = screen.getByAltText("Attachment 1")
    expect(img).toBeVisible()

    // Trigger image loading error
    fireEvent.error(img)
    expect(img).toHaveStyle({ display: "none" })
  })

  it("extracts thought tags embedded in text and renders thinking accordion", () => {
    const message: ChatUIMessage = {
      id: "msg-thought-tags",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "<thought>Keep the response brief, friendly, and establish role.</thought>\n\nI'm LinkX Copilot — your AI assistant.",
        },
      ],
    }

    render(<ChatMessage message={message} />)
    // Thought content is in the thinking accordion, not rendered as raw tags
    expect(screen.queryByText(/<thought>/)).not.toBeInTheDocument()
    expect(
      screen.getByText(/I'm LinkX Copilot — your AI assistant\./),
    ).toBeInTheDocument()
    // Thinking summary button is visible
    expect(
      screen.getByRole("button", { name: /toggle thinking details/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/thought for 2 seconds/i)).toBeInTheDocument()
  })

  it("deduplicates draft post text repeated in assistant text parts", () => {
    const postText =
      "Raghav Chadha has accused Punjab AAP of a 'voter roll vendetta' after his electoral shift."
    const message: ChatUIMessage = {
      id: "msg-draft-duplicate",
      role: "assistant",
      parts: [
        {
          type: "draft_artifact",
          artifact: {
            id: "draft-1",
            content: postText,
            platform: "x",
            status: "draft",
          },
        },
        {
          type: "text",
          text: `Here's a polished X draft:\n\n${postText}\n\nSaved as a draft.`,
        },
      ],
    }

    renderWithClient(<ChatMessage message={message} />)
    const matches = screen.getAllByText(new RegExp(postText))
    expect(matches).toHaveLength(1)
    expect(
      screen.queryByText(/Here's a polished X draft/i),
    ).not.toBeInTheDocument()
  })

  it("renders only the latest draft UI card when message has multiple draft artifact revisions", () => {
    const message: ChatUIMessage = {
      id: "msg-multi-draft",
      role: "assistant",
      parts: [
        {
          type: "draft_artifact",
          artifact: {
            id: "draft-post-1",
            content: "Draft version 1: Most people eat sushi wrong.",
            platform: "x",
            status: "draft",
          },
        },
        {
          type: "draft_artifact",
          artifact: {
            id: "draft-post-1",
            content:
              "Draft version 2: Stop disrespecting sushi. You're doing it wrong.",
            platform: "x",
            status: "draft",
          },
        },
        {
          type: "draft_artifact",
          artifact: {
            id: "draft-post-1",
            content:
              "Draft version 3: Stop disrespecting sushi. Fix your habits.",
            platform: "x",
            status: "draft",
          },
        },
      ],
    }

    renderWithClient(<ChatMessage message={message} />)
    expect(
      screen.getByText(
        "Draft version 3: Stop disrespecting sushi. Fix your habits.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Draft version 1: Most people eat sushi wrong."),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        "Draft version 2: Stop disrespecting sushi. You're doing it wrong.",
      ),
    ).not.toBeInTheDocument()
  })

  it("renders queued indicator when assistant message status is queued", () => {
    const message: ChatUIMessage = {
      id: "msg-queued",
      role: "assistant",
      parts: [],
      status: "queued",
    }

    renderWithClient(<ChatMessage message={message} />)
    expect(
      screen.getByText(/Queued • Waiting for active generation to finish.../i),
    ).toBeInTheDocument()
  })

  it("renders edit button for user message and triggers onStartEdit", () => {
    const onStartEdit = vi.fn()
    const message: ChatUIMessage = {
      id: "msg-user-1",
      role: "user",
      parts: [{ type: "text", text: "Original user prompt" }],
    }

    render(<ChatMessage message={message} onStartEdit={onStartEdit} />)
    const editBtn = screen.getByLabelText("Edit message")
    expect(editBtn).toBeInTheDocument()

    fireEvent.click(editBtn)
    expect(onStartEdit).toHaveBeenCalledWith("msg-user-1")
  })

  it("renders UserMessageEditForm when isEditing is true and supports Save & Submit", () => {
    const onSaveEdit = vi.fn()
    const onCancelEdit = vi.fn()
    const message: ChatUIMessage = {
      id: "msg-user-2",
      role: "user",
      parts: [{ type: "text", text: "Editable prompt" }],
    }

    render(
      <ChatMessage
        message={message}
        isEditing={true}
        onSaveEdit={onSaveEdit}
        onCancelEdit={onCancelEdit}
      />,
    )

    const textarea = screen.getByDisplayValue("Editable prompt")
    expect(textarea).toBeInTheDocument()

    fireEvent.change(textarea, { target: { value: "Updated prompt text" } })
    const saveBtn = screen.getByRole("button", { name: /Save & Submit/i })
    fireEvent.click(saveBtn)

    expect(onSaveEdit).toHaveBeenCalledWith("msg-user-2", "Updated prompt text")
  })

  it("UserMessageEditForm cancels on Escape key or Cancel button", () => {
    const onSaveEdit = vi.fn()
    const onCancelEdit = vi.fn()
    const message: ChatUIMessage = {
      id: "msg-user-3",
      role: "user",
      parts: [{ type: "text", text: "Prompt to cancel" }],
    }

    render(
      <ChatMessage
        message={message}
        isEditing={true}
        onSaveEdit={onSaveEdit}
        onCancelEdit={onCancelEdit}
      />,
    )

    const cancelBtn = screen.getByRole("button", { name: /Cancel/i })
    fireEvent.click(cancelBtn)
    expect(onCancelEdit).toHaveBeenCalledTimes(1)

    const textarea = screen.getByDisplayValue("Prompt to cancel")
    fireEvent.keyDown(textarea, { key: "Escape" })
    expect(onCancelEdit).toHaveBeenCalledTimes(2)
  })

  it("renders regenerate button on latest assistant message and triggers onRegenerate", () => {
    const onRegenerate = vi.fn()
    const message: ChatUIMessage = {
      id: "msg-asst-1",
      role: "assistant",
      parts: [{ type: "text", text: "Assistant response" }],
      status: "done",
    }

    render(
      <ChatMessage
        message={message}
        isLatestAssistant={true}
        isStreaming={false}
        onRegenerate={onRegenerate}
      />,
    )

    const regenBtn = screen.getByLabelText("Regenerate response")
    expect(regenBtn).toBeInTheDocument()

    fireEvent.click(regenBtn)
    expect(onRegenerate).toHaveBeenCalledWith("msg-asst-1")
  })

  it("renders retry button when assistant status is error and triggers onRetry", () => {
    const onRetry = vi.fn()
    const message: ChatUIMessage = {
      id: "msg-err-1",
      role: "assistant",
      parts: [{ type: "text", text: "*(Error: Rate limit)*" }],
      status: "error",
    }

    render(<ChatMessage message={message} onRetry={onRetry} />)

    const retryBtn = screen.getByRole("button", { name: /Retry generation/i })
    expect(retryBtn).toBeInTheDocument()

    fireEvent.click(retryBtn)
    expect(onRetry).toHaveBeenCalledWith("msg-err-1")
  })
})
