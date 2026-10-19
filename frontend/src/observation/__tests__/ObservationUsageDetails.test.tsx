import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ObservationUsagePayload } from "@/hooks/useAIChatStream"
import { ObservationUsageDetails } from "@/observation/ObservationUsageDetails"

const usage: ObservationUsagePayload = {
  estimated_input_tokens: 1200,
  input_limit: 4000,
  output_reserve: 700,
  model_id: "vision-model",
  frame_count: 1,
  history_frames: 0,
  revision: 4,
  source_epoch: 2,
  width: 1280,
  height: 720,
  captured_at: "2026-10-19T09:00:00Z",
  delivered_at: "2026-10-19T09:00:01Z",
  frame_presented_at_ms: 120,
}

describe("browser context details", () => {
  it("reveals snapshot usage details and can reset the browser context", () => {
    const onReset = vi.fn()
    render(<ObservationUsageDetails usage={usage} onReset={onReset} />)

    const disclosure = screen.getByText("Browser context details")
    fireEvent.click(disclosure)
    expect(disclosure.closest("details")).toHaveProperty("open", true)

    expect(screen.getByText("1200", { selector: "dd" })).toBeVisible()
    expect(screen.getByText("1280 × 720")).toBeVisible()
    expect(
      screen.getByText(/LinkX does not store screenshot history/),
    ).toBeVisible()
    const capturedTime = screen.getByText("Captured at").nextElementSibling
    expect(capturedTime).toHaveAttribute("title", usage.captured_at)
    expect(capturedTime).not.toHaveTextContent(usage.captured_at)
    fireEvent.click(
      screen.getByRole("button", { name: "Reset browser context" }),
    )
    expect(onReset).toHaveBeenCalledOnce()
  })
})
