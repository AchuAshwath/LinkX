import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PostActionBar } from "../PostActionBar"

describe("PostActionBar - Draft with AI Button", () => {
  it("toggles AI mode when content is empty and ai-draft-btn is clicked", () => {
    const onToggleAiMode = vi.fn()
    const onAiDraftSubmit = vi.fn()

    render(
      <PostActionBar
        isSubmitting={false}
        isContentEmpty={true}
        isScheduleOpen={false}
        onToggleSchedule={vi.fn()}
        onActionTypeChange={vi.fn()}
        onDraftClick={vi.fn()}
        onScheduleClick={vi.fn()}
        onPostClick={vi.fn()}
        onToggleAiMode={onToggleAiMode}
        onAiDraftSubmit={onAiDraftSubmit}
      />,
    )

    const aiButton = screen.getByTestId("ai-draft-btn")
    expect(aiButton).toBeInTheDocument()

    fireEvent.click(aiButton)
    expect(onToggleAiMode).toHaveBeenCalledTimes(1)
    expect(onAiDraftSubmit).not.toHaveBeenCalled()
  })

  it("triggers onAiDraftSubmit directly when content is NOT empty and ai-draft-btn is clicked", () => {
    const onToggleAiMode = vi.fn()
    const onAiDraftSubmit = vi.fn()

    render(
      <PostActionBar
        isSubmitting={false}
        isContentEmpty={false}
        currentLength={25}
        isScheduleOpen={false}
        onToggleSchedule={vi.fn()}
        onActionTypeChange={vi.fn()}
        onDraftClick={vi.fn()}
        onScheduleClick={vi.fn()}
        onPostClick={vi.fn()}
        onToggleAiMode={onToggleAiMode}
        onAiDraftSubmit={onAiDraftSubmit}
      />,
    )

    const aiButton = screen.getByTestId("ai-draft-btn")
    fireEvent.click(aiButton)

    expect(onAiDraftSubmit).toHaveBeenCalledTimes(1)
    expect(onToggleAiMode).not.toHaveBeenCalled()
  })

  it("disables button and displays loader when isAiGenerating is true", () => {
    render(
      <PostActionBar
        isSubmitting={false}
        isContentEmpty={false}
        isAiGenerating={true}
        isScheduleOpen={false}
        onToggleSchedule={vi.fn()}
        onActionTypeChange={vi.fn()}
        onDraftClick={vi.fn()}
        onScheduleClick={vi.fn()}
        onPostClick={vi.fn()}
      />,
    )

    const aiButton = screen.getByTestId("ai-draft-btn")
    expect(aiButton).toBeDisabled()
    expect(aiButton).toHaveAttribute("aria-label", "Generating AI Draft...")
  })

  it("submits AI draft when in AI mode and primary button is clicked", () => {
    const onAiDraftSubmit = vi.fn()

    render(
      <PostActionBar
        isSubmitting={false}
        isContentEmpty={false}
        isAiMode={true}
        currentLength={25}
        isScheduleOpen={false}
        onToggleSchedule={vi.fn()}
        onActionTypeChange={vi.fn()}
        onDraftClick={vi.fn()}
        onScheduleClick={vi.fn()}
        onPostClick={vi.fn()}
        onAiDraftSubmit={onAiDraftSubmit}
      />,
    )

    const primaryBtn = screen.getByTestId("primary-post-btn")
    expect(primaryBtn).toHaveTextContent("Draft")

    fireEvent.click(primaryBtn)
    expect(onAiDraftSubmit).toHaveBeenCalledTimes(1)
  })
})
