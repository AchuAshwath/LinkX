import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { BranchSwitcher } from "@/components/Chat/BranchSwitcher"

describe("BranchSwitcher component", () => {
  it("renders nothing when totalVersions is 1 or less", () => {
    const { container } = render(
      <BranchSwitcher
        currentIndex={1}
        totalVersions={1}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders version indicator and controls when totalVersions > 1", () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()

    render(
      <BranchSwitcher
        currentIndex={1}
        totalVersions={3}
        onPrevious={onPrev}
        onNext={onNext}
      />,
    )

    expect(screen.getByText("1 of 3")).toBeDefined()

    const prevBtn = screen.getByRole("button", { name: "Previous version" })
    const nextBtn = screen.getByRole("button", { name: "Next version" })

    expect(prevBtn.getAttribute("disabled")).not.toBeNull()
    expect(nextBtn.getAttribute("disabled")).toBeNull()

    fireEvent.click(nextBtn)
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it("disables next button when on last version and fires onPrevious", () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()

    render(
      <BranchSwitcher
        currentIndex={3}
        totalVersions={3}
        onPrevious={onPrev}
        onNext={onNext}
      />,
    )

    expect(screen.getByText("3 of 3")).toBeDefined()

    const prevBtn = screen.getByRole("button", { name: "Previous version" })
    const nextBtn = screen.getByRole("button", { name: "Next version" })

    expect(prevBtn.getAttribute("disabled")).toBeNull()
    expect(nextBtn.getAttribute("disabled")).not.toBeNull()

    fireEvent.click(prevBtn)
    expect(onPrev).toHaveBeenCalledTimes(1)
  })
})
