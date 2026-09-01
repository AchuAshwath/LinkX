import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DraftArtifactCard } from "../DraftArtifactCard"
import type { DraftArtifact } from "../types"

describe("DraftArtifactCard component", () => {
  const artifact: DraftArtifact = {
    postId: "post-123",
    content:
      "Excited to announce the new LinkX AI Copilot release! Automate multi-channel social posting.",
    platform: "linkx",
    status: "draft",
    characterCount: 92,
  }

  it("renders drafted post content and character count", () => {
    render(<DraftArtifactCard artifact={artifact} />)
    expect(
      screen.getByText(/Excited to announce the new LinkX AI Copilot release!/),
    ).toBeInTheDocument()
    expect(screen.getByText(/92 \/ 3000 chars/)).toBeInTheDocument()
  })

  it("fires action button callbacks when clicked", () => {
    const handleSchedule = vi.fn()
    const handleSendToComposer = vi.fn()
    const handlePublish = vi.fn()

    render(
      <DraftArtifactCard
        artifact={artifact}
        onSchedule={handleSchedule}
        onSendToComposer={handleSendToComposer}
        onPublish={handlePublish}
      />,
    )

    const scheduleBtn = screen.getByRole("button", { name: /schedule/i })
    fireEvent.click(scheduleBtn)
    expect(handleSchedule).toHaveBeenCalledWith(artifact)

    const composerBtn = screen.getByRole("button", {
      name: /send to composer/i,
    })
    fireEvent.click(composerBtn)
    expect(handleSendToComposer).toHaveBeenCalledWith(artifact)

    const publishBtn = screen.getByRole("button", { name: /publish/i })
    fireEvent.click(publishBtn)
    expect(handlePublish).toHaveBeenCalledWith(artifact)
  })
})
