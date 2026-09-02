import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Suggestions } from "../Suggestions"

describe("Suggestions component", () => {
  it("renders contextual prompt starters", () => {
    render(<Suggestions onSelect={vi.fn()} />)
    expect(screen.getByText("Viral Launch Post")).toBeInTheDocument()
    expect(screen.getByText("Analyze Trends")).toBeInTheDocument()
    expect(screen.getByText("Refine Recent Draft")).toBeInTheDocument()
  })

  it("calls onSelect with the starter prompt when clicked", () => {
    const handleSelect = vi.fn()
    render(<Suggestions onSelect={handleSelect} />)

    const button = screen.getByText("Viral Launch Post")
    fireEvent.click(button)

    expect(handleSelect).toHaveBeenCalledWith(
      expect.stringContaining("Draft a high-engagement launch post"),
    )
  })
})
