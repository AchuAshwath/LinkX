import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { VoiceInputButton } from "@/components/Chat/VoiceInputButton"

describe("VoiceInputButton", () => {
  it("renders disabled state when speech recognition is unsupported", () => {
    render(
      <VoiceInputButton
        isListening={false}
        isSupported={false}
        onToggle={vi.fn()}
      />,
    )

    const btn = screen.getByRole("button", {
      name: /voice input not supported in this browser/i,
    })
    expect(btn).toBeDefined()
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it("calls onToggle when clicked while supported", async () => {
    const user = userEvent.setup()
    const handleToggle = vi.fn()

    render(
      <VoiceInputButton
        isListening={false}
        isSupported={true}
        onToggle={handleToggle}
      />,
    )

    const btn = screen.getByRole("button", { name: /start voice input/i })
    await user.click(btn)

    expect(handleToggle).toHaveBeenCalledTimes(1)
  })

  it("renders red mic icon when isListening is true", () => {
    const { container } = render(
      <VoiceInputButton
        isListening={true}
        isSupported={true}
        onToggle={vi.fn()}
      />,
    )

    const btn = screen.getByRole("button", { name: /stop voice input/i })
    expect(btn).toBeDefined()

    const micIcon = container.querySelector("svg")
    expect(micIcon?.getAttribute("class")).toContain("text-red-500")
  })
})
