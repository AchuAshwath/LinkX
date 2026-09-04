import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TrendingArtifactCard } from "../TrendingArtifactCard"
import type { TrendingArtifact } from "../types"

describe("TrendingArtifactCard component", () => {
  const artifact: TrendingArtifact = {
    topics: [
      {
        id: "trend-1",
        topic_title: "AI Agents Revolutionize Social Media",
        category: "Technology",
        post_count: 45200,
        summary:
          "Autonomous multi-agent systems are managing content pipelines.",
        topic_url: "https://x.com/search?q=AI%20Agents",
      },
      {
        id: "trend-2",
        topic_title: "Solo FNCS Kickoff",
        category: "Gaming",
        post_count: 12000,
      },
    ],
    count: 2,
  }

  it("renders trending topics list with titles and post count badges", () => {
    render(<TrendingArtifactCard artifact={artifact} />)

    expect(
      screen.getByText("AI Agents Revolutionize Social Media"),
    ).toBeInTheDocument()
    expect(screen.getByText("Solo FNCS Kickoff")).toBeInTheDocument()
    expect(screen.getByText("45,200 posts")).toBeInTheDocument()
    expect(screen.getByText("12,000 posts")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Autonomous multi-agent systems are managing content pipelines.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText("2 trends")).toBeInTheDocument()
  })

  it("fires onDraftTopic callback when Draft button is clicked", () => {
    const handleDraft = vi.fn()
    render(
      <TrendingArtifactCard artifact={artifact} onDraftTopic={handleDraft} />,
    )

    const draftButtons = screen.getAllByRole("button", { name: /draft/i })
    expect(draftButtons.length).toBe(2)

    fireEvent.click(draftButtons[0])
    expect(handleDraft).toHaveBeenCalledWith(
      "AI Agents Revolutionize Social Media",
    )
  })

  it("renders null if topics array is empty", () => {
    const { container } = render(
      <TrendingArtifactCard artifact={{ topics: [] }} />,
    )
    expect(container.firstChild).toBeNull()
  })
})
