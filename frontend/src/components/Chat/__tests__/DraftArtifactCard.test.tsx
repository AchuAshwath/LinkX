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

const mockShowErrorToast = vi.fn()
const mockShowSuccessToast = vi.fn()

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
    showInfoToast: vi.fn(),
  }),
}))

async function openMenuAndSelectAction(actionName: string) {
  const moreBtn = screen.getByRole("button", { name: /more options/i })
  fireEvent.pointerDown(moreBtn, { button: 0, ctrlKey: false })
  fireEvent.click(moreBtn)
  const actionBtn = await screen.findByText(actionName)
  fireEvent.click(actionBtn)
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

  it("opens popup edit dialog in place when clicking Edit on saved draft", async () => {
    const handleEdit = vi.fn()
    renderWithClient(
      <DraftArtifactCard artifact={artifact} onEdit={handleEdit} />,
    )

    await openMenuAndSelectAction("Edit")

    expect(handleEdit).toHaveBeenCalledWith(artifact)
    expect(
      await screen.findByRole("region", { name: /edit post/i }),
    ).toBeInTheDocument()
  })

  it.each([
    {
      action: "Edit",
      expectedError: "Cannot edit: Draft has not been saved to database yet.",
    },
    {
      action: "Publish",
      expectedError:
        "Cannot publish: Draft has not been saved to database yet.",
    },
  ])("shows fallback error toast when trying to $action unsaved draft without valid postId", async ({
    action,
    expectedError,
  }) => {
    mockShowErrorToast.mockClear()
    const unsavedArtifact: DraftArtifact = {
      ...artifact,
      postId: "draft-artifact",
    }
    renderWithClient(<DraftArtifactCard artifact={unsavedArtifact} />)

    await openMenuAndSelectAction(action)

    expect(mockShowErrorToast).toHaveBeenCalledWith(expectedError)
    if (action === "Edit") {
      expect(
        screen.queryByRole("region", { name: /edit post/i }),
      ).not.toBeInTheDocument()
    }
  })

  it("calls onPublish when onPublish prop is provided", async () => {
    const handlePublish = vi.fn()
    renderWithClient(
      <DraftArtifactCard artifact={artifact} onPublish={handlePublish} />,
    )

    await openMenuAndSelectAction("Publish")

    expect(handlePublish).toHaveBeenCalledWith(artifact)
  })

  it("invokes onSendToComposer on edit when provided", async () => {
    const handleSendToComposer = vi.fn()
    renderWithClient(
      <DraftArtifactCard
        artifact={artifact}
        onSendToComposer={handleSendToComposer}
      />,
    )

    await openMenuAndSelectAction("Edit")

    expect(handleSendToComposer).toHaveBeenCalledWith(artifact)
  })
})
