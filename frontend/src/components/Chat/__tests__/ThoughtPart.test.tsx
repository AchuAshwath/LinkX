import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { getToolIcon, ThoughtPart } from "../parts/ThoughtPart"

describe("ThoughtPart component", () => {
  it("renders thinking state when streaming", () => {
    render(
      <ThoughtPart
        part={{ type: "thought", content: "Formulating viral outline" }}
        isStreaming={true}
      />,
    )
    expect(screen.getByText("Thinking…")).toBeInTheDocument()
  })

  it("renders completed thought process and allows expanding details on click", () => {
    render(
      <ThoughtPart
        part={{
          type: "thought",
          content: "Selected LinkedIn hook pattern with strong CTA.",
        }}
        isStreaming={false}
      />,
    )
    expect(screen.getByText(/thought for|worked for/i)).toBeInTheDocument()
    // Collapsed by default
    expect(
      screen.queryByText(/Selected LinkedIn hook pattern/),
    ).not.toBeInTheDocument()

    // Expand on click
    const toggleButton = screen.getByRole("button")
    fireEvent.click(toggleButton)
    expect(
      screen.getByText(/Selected LinkedIn hook pattern/),
    ).toBeInTheDocument()

    // Collapse on click
    fireEvent.click(toggleButton)
    expect(
      screen.queryByText(/Selected LinkedIn hook pattern/),
    ).not.toBeInTheDocument()
  })

  it("renders worked for X seconds with tool calls and allows viewing tool payload", () => {
    render(
      <ThoughtPart
        content="Analyzed the database state"
        toolCalls={[
          {
            id: "t-1",
            name: "get_latest_scraped_trends",
            state: "completed",
            durationMs: 180,
            input: { limit: 10 },
            output: { count: 8 },
          },
        ]}
        isStreaming={false}
        durationSeconds={3}
      />,
    )

    expect(screen.getByText("Worked for 3 seconds")).toBeInTheDocument()

    // Click toggle to expand dropdown
    const toggleButton = screen.getByRole("button", {
      name: /toggle thinking details/i,
    })
    fireEvent.click(toggleButton)

    expect(screen.getByText("get_latest_scraped_trends")).toBeInTheDocument()
    expect(screen.getByText("(180ms)")).toBeInTheDocument()
    expect(screen.getByText(/Analyzed the database state/)).toBeInTheDocument()

    // Expand tool payload details
    const viewDetailsBtn = screen.getByRole("button", {
      name: /toggle tool payload details/i,
    })
    fireEvent.click(viewDetailsBtn)
    expect(screen.getByText(/"limit": 10/)).toBeInTheDocument()
    expect(screen.getByText(/"count": 8/)).toBeInTheDocument()
  })

  it("maps tool calls to appropriate icons using the icon dictionary", () => {
    // Database
    expect(getToolIcon("get_latest_scraped_trends")).toBeDefined()
    expect(getToolIcon("get_topic_tweets_and_summary")).toBeDefined()
    expect(getToolIcon("save_draft_post")).toBeDefined()
    expect(getToolIcon("update_draft_post")).toBeDefined()
    // Validation
    expect(getToolIcon("validate_post_constraints")).toBeDefined()
    // Web / Scraper
    expect(getToolIcon("scrape_live_explore_trends")).toBeDefined()
    expect(getToolIcon("web_search")).toBeDefined()
    // Draft
    expect(getToolIcon("draft_social_post")).toBeDefined()
    // Fallback
    expect(getToolIcon("unknown_tool")).toBeDefined()

    // Validate that validation icon is distinct from draft icon
    expect(getToolIcon("validate_post_constraints")).not.toBe(
      getToolIcon("draft_social_post"),
    )
    // Validate database icon (save_draft_post) is distinct from draft authoring icon (draft_social_post)
    expect(getToolIcon("save_draft_post")).not.toBe(
      getToolIcon("draft_social_post"),
    )
    // Validate save_draft_post shares the Database icon with get_latest_scraped_trends
    expect(getToolIcon("save_draft_post")).toBe(
      getToolIcon("get_latest_scraped_trends"),
    )
  })
})
