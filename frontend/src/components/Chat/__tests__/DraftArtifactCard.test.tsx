import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DraftArtifactCard } from "../DraftArtifactCard"
import type { DraftArtifact } from "../types"

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  )
}

describe("DraftArtifactCard component", () => {
  const artifact: DraftArtifact = {
    postId: "post-123",
    content:
      "Excited to announce the new LinkX AI Copilot release! Automate multi-channel social posting.",
    platform: "linkx",
    status: "draft",
    characterCount: 92,
  }

  it("renders drafted post content and default user author", () => {
    renderWithClient(<DraftArtifactCard artifact={artifact} />)
    expect(
      screen.getByText(/Excited to announce the new LinkX AI Copilot release!/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Ashwath N/)).toBeInTheDocument()
    expect(screen.getByText(/@admin/)).toBeInTheDocument()
  })

  it("renders custom author when provided", () => {
    renderWithClient(
      <DraftArtifactCard
        artifact={artifact}
        author={{ name: "Jane Doe", username: "janedoe" }}
      />,
    )
    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument()
    expect(screen.getByText(/@janedoe/)).toBeInTheDocument()
  })

  it("renders more options and platform selector buttons", () => {
    renderWithClient(<DraftArtifactCard artifact={artifact} />)

    const moreBtn = screen.getByRole("button", { name: /more options/i })
    expect(moreBtn).toBeInTheDocument()

    const selectXBtn = screen.getByRole("button", { name: /select x/i })
    expect(selectXBtn).toBeInTheDocument()
    fireEvent.click(selectXBtn)
    expect(selectXBtn).toHaveAttribute("aria-pressed", "true")
  })

  it("supports onPreview callback", () => {
    const handlePreview = vi.fn()
    renderWithClient(
      <DraftArtifactCard artifact={artifact} onPreview={handlePreview} />,
    )

    const moreBtn = screen.getByRole("button", { name: /more options/i })
    expect(moreBtn).toBeInTheDocument()
  })
})
