import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ThoughtPart } from "../parts/ThoughtPart"

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
    expect(screen.getByText("Thinking…")).toBeInTheDocument()
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

  it("renders markdown formatting inside expanded thought content", () => {
    const { container } = render(
      <ThoughtPart
        part={{
          type: "thought",
          content: "Here is **critical reasoning** step.",
        }}
        isStreaming={true}
        hasResponseStarted={false}
      />,
    )

    const strongEl = container.querySelector("strong")
    expect(strongEl).toBeDefined()
    expect(strongEl?.textContent).toBe("critical reasoning")
  })
})
