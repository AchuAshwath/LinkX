import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ChatMessage } from "../ChatMessage"
import type { ChatUIMessage } from "../types"

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
})
