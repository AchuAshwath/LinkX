import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PromptForm } from "../PromptForm"

describe("PromptForm component", () => {
  it("renders textarea with placeholder", () => {
    render(
      <PromptForm
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        isBusy={false}
        placeholder="Ask anything…"
      />,
    )
    expect(screen.getByPlaceholderText("Ask anything…")).toBeInTheDocument()
    expect(screen.getByLabelText("Send message")).toBeDisabled()
  })

  it("enables send button when text is typed and submits on Enter", () => {
    const handleSubmit = vi.fn()
    render(
      <PromptForm
        onSubmit={handleSubmit}
        onStop={vi.fn()}
        isBusy={false}
        placeholder="Ask anything…"
      />,
    )

    const textarea = screen.getByPlaceholderText("Ask anything…")
    fireEvent.change(textarea, { target: { value: "Draft a post about AI" } })

    const sendBtn = screen.getByLabelText("Send message")
    expect(sendBtn).not.toBeDisabled()

    // Press Enter to submit
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false })
    expect(handleSubmit).toHaveBeenCalledWith("Draft a post about AI")
    expect(textarea).toHaveValue("")
  })

  it("does not submit on Shift+Enter", () => {
    const handleSubmit = vi.fn()
    render(
      <PromptForm
        onSubmit={handleSubmit}
        onStop={vi.fn()}
        isBusy={false}
        placeholder="Ask anything…"
      />,
    )

    const textarea = screen.getByPlaceholderText("Ask anything…")
    fireEvent.change(textarea, { target: { value: "Line 1" } })
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true })
    expect(handleSubmit).not.toHaveBeenCalled()
  })

  it("shows stop button when isBusy is true and calls onStop", () => {
    const handleStop = vi.fn()
    render(
      <PromptForm
        onSubmit={vi.fn()}
        onStop={handleStop}
        isBusy={true}
        placeholder="Ask anything…"
      />,
    )

    const stopBtn = screen.getByLabelText("Stop generating")
    expect(stopBtn).toBeInTheDocument()
    fireEvent.click(stopBtn)
    expect(handleStop).toHaveBeenCalledTimes(1)
  })

  it("renders extra actions and children", () => {
    render(
      <PromptForm
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        isBusy={false}
        actions={<button type="button">Upload Image</button>}
      />,
    )
    expect(screen.getByText("Upload Image")).toBeInTheDocument()
  })
})
