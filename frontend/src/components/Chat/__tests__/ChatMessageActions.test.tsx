import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { ChatMessageActions } from "@/components/Chat/ChatMessageActions"

describe("ChatMessageActions", () => {
  it("renders formatted time when valid createdAt is provided", () => {
    render(
      <ChatMessageActions
        textToCopy="Hello world"
        createdAt="2026-09-02T12:30:00Z"
      />,
    )

    const copyBtn = screen.getByRole("button", { name: /copy message/i })
    expect(copyBtn).toBeDefined()
  })

  it("renders copy button before timestamp when align is start (assistant response)", () => {
    const { container } = render(
      <ChatMessageActions
        textToCopy="Response text"
        createdAt="2026-09-02T12:30:00Z"
        align="start"
      />,
    )

    const root = container.querySelector('[data-slot="message-actions"]')
    expect(root).toBeDefined()
    const firstChild = root?.firstElementChild
    expect(firstChild?.tagName.toLowerCase()).toBe("button")
  })

  it("renders timestamp before copy button when align is end (user request)", () => {
    const { container } = render(
      <ChatMessageActions
        textToCopy="User prompt"
        createdAt="2026-09-02T12:30:00Z"
        align="end"
      />,
    )

    const root = container.querySelector('[data-slot="message-actions"]')
    expect(root).toBeDefined()
    const firstChild = root?.firstElementChild
    expect(firstChild?.tagName.toLowerCase()).toBe("span")
  })

  it("copies text to clipboard when copy button is clicked", async () => {
    const user = userEvent.setup()
    render(
      <ChatMessageActions
        textToCopy="Copy this prompt"
        createdAt="2026-09-02T12:30:00Z"
      />,
    )

    const copyBtn = screen.getByRole("button", { name: /copy message/i })
    await user.click(copyBtn)

    const copiedText = await navigator.clipboard.readText()
    expect(copiedText).toBe("Copy this prompt")
    expect(
      screen.getByRole("button", { name: /copied to clipboard/i }),
    ).toBeDefined()
  })
})
