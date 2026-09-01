import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ToolCallAccordion } from "../ToolCallAccordion"
import type { ToolCallItem } from "../types"

describe("ToolCallAccordion component", () => {
  it("renders running tool call with spinner badge", () => {
    const toolCalls: ToolCallItem[] = [
      {
        id: "step-1",
        name: "ScrapingGraph",
        state: "running",
        input: { target: "x_trends" },
      },
    ]

    render(<ToolCallAccordion toolCalls={toolCalls} />)
    expect(screen.getByText("Executing ScrapingGraph…")).toBeInTheDocument()
  })

  it("renders completed tool call and allows expanding details", () => {
    const toolCalls: ToolCallItem[] = [
      {
        id: "step-1",
        name: "DraftRefinementGraph",
        state: "completed",
        durationMs: 420,
        input: { platform: "x", topic: "AI Launch" },
        output: { status: "refined", char_count: 240 },
      },
    ]

    render(<ToolCallAccordion toolCalls={toolCalls} />)
    expect(screen.getByText(/DraftRefinementGraph/)).toBeInTheDocument()
    expect(screen.getByText(/420ms/)).toBeInTheDocument()

    // Expand accordion
    const toggle = screen.getByRole("button", {
      name: /toggle tool details/i,
    })
    fireEvent.click(toggle)

    expect(screen.getByText(/"refined"/)).toBeInTheDocument()
  })
})
