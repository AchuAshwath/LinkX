import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BrowserActivityPart } from "../parts/BrowserActivityPart"

afterEach(() => vi.useRealTimers())

describe("BrowserActivityPart", () => {
  it("shows preparation with one spinner and no globe or expandable fake trace", () => {
    render(
      <BrowserActivityPart
        activity={{
          steps: [{ state: "checking", message: "Preparing an answer." }],
          warning: null,
        }}
        isStreaming
      />,
    )

    expect(screen.getByText("Preparing an answer.")).toBeInTheDocument()
    expect(
      screen
        .getByText("Preparing an answer.")
        .parentElement?.querySelectorAll("svg"),
    ).toHaveLength(1)
    expect(
      screen.queryByText("Browser context incomplete"),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("shows image reads with bounded, factual preview text", () => {
    render(
      <BrowserActivityPart
        activity={{
          steps: [],
          tools: [
            {
              id: "a",
              name: "read_shared_view",
              state: "completed",
              input: { view_index: 1, view_count: 2 },
              output: {
                note_chars: 123,
                note_preview: "A product page with its price and details.",
                preview_truncated: true,
              },
            },
            {
              id: "b",
              name: "read_shared_view",
              state: "failed",
              input: { view_index: 2, view_count: 2 },
            },
          ],
          warning: "A shared view could not be read.",
        }}
        isStreaming={false}
      />,
    )

    expect(
      screen.getByRole("region", { name: "Browser context tools" }),
    ).toBeInTheDocument()
    const read = screen.getByRole("button", { name: /^Read image 1 of 2/ })
    expect(read.querySelector("svg.lucide-image")).toBeInTheDocument()
    expect(read).not.toHaveTextContent("1/2")
    expect(read).not.toHaveTextContent("Read image")
    expect(
      screen.getByRole("button", { name: "Could not read image 2 of 2" }),
    ).toBeInTheDocument()
    expect(read).toHaveTextContent("A product page with its price and details.")
    fireEvent.click(read)
    expect(screen.getByText("Preview shortened")).toBeInTheDocument()
    expect(
      screen.getByText("A product page with its price and details."),
    ).toBeInTheDocument()
    expect(screen.queryByText("123 characters")).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "Could not read image 2 of 2" }),
    )
    expect(
      screen.getByText("This image could not be read."),
    ).toBeInTheDocument()
    expect(
      screen.queryByText("A shared view could not be read."),
    ).not.toBeInTheDocument()
  })

  it("shows a bounded failure reason as plain text without repeating the warning", () => {
    const failure = 'The model response was truncated. <img src="x">'
    render(
      <BrowserActivityPart
        activity={{
          steps: [],
          tools: [
            {
              id: "a",
              name: "read_shared_view",
              state: "failed",
              input: { view_index: 1, view_count: 1 },
              output: { failure_message: failure },
            },
          ],
          warning: "A shared view could not be read.",
        }}
        isStreaming={false}
      />,
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Could not read image 1 of 1" }),
    )

    expect(screen.getByText(failure)).toBeInTheDocument()
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(
      screen.queryByText("A shared view could not be read."),
    ).not.toBeInTheDocument()
  })

  it("shows preparation after reads finish while the answer is still streaming", () => {
    const { container } = render(
      <BrowserActivityPart
        activity={{
          steps: [{ state: "checking", message: "Preparing an answer." }],
          tools: [{ id: "a", name: "read_shared_view", state: "completed" }],
          warning: null,
        }}
        isStreaming
      />,
    )

    expect(
      screen.getByRole("button", { name: "Read image 1" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Preparing an answer.")).toBeInTheDocument()
    expect(container.querySelector("svg.lucide-earth")).not.toBeInTheDocument()
    expect(
      screen
        .getByText("Preparing an answer.")
        .parentElement?.querySelector("svg.animate-spin"),
    ).toBeInTheDocument()
  })

  it("shows a stopped read without a spinner after the stream ends", () => {
    render(
      <BrowserActivityPart
        activity={{
          steps: [],
          tools: [{ id: "a", name: "read_shared_view", state: "running" }],
          warning: null,
        }}
        isStreaming={false}
      />,
    )

    const stopped = screen.getByRole("button", {
      name: "Stopped reading image 1",
    })
    expect(stopped.querySelector("svg.animate-spin")).not.toBeInTheDocument()
    fireEvent.click(stopped)
    expect(
      screen.getByText("Reading stopped before the image finished."),
    ).toBeInTheDocument()
  })

  it("shows one accessible active status without a pending image row", () => {
    const { container } = render(
      <BrowserActivityPart
        activity={{
          steps: [],
          tools: [{ id: "a", name: "read_shared_view", state: "running" }],
          warning: null,
        }}
        isStreaming
      />,
    )
    const status = screen.getByRole("status", { name: "Image transcription" })
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(status).toHaveTextContent("1 of 1 images")
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(container.querySelector("svg.lucide-image")).not.toBeInTheDocument()
    expect(container.querySelectorAll("svg.animate-spin")).toHaveLength(1)
    expect(container.querySelector("svg.lucide-earth")).not.toBeInTheDocument()
    expect(
      screen.queryByText("No extracted description is available."),
    ).not.toBeInTheDocument()
  })

  it("rotates display phrases and stops rotating when the read finishes", () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <BrowserActivityPart
        activity={{
          steps: [],
          tools: [{ id: "a", name: "read_shared_view", state: "running" }],
          warning: null,
        }}
        isStreaming
      />,
    )
    const status = screen.getByRole("status", { name: "Image transcription" })
    const initial = status.textContent
    act(() => vi.advanceTimersByTime(2200))
    expect(status.textContent).not.toBe(initial)
    rerender(
      <BrowserActivityPart
        activity={{
          steps: [],
          tools: [
            {
              id: "a",
              name: "read_shared_view",
              state: "completed",
              output: { note_preview: "A real note." },
            },
          ],
          warning: null,
        }}
        isStreaming
      />,
    )
    const finished = screen.getByRole("button", { name: "Read image 1" })
    expect(finished).toHaveTextContent("A real note.")
    const finishedCopy = status.textContent
    act(() => vi.advanceTimersByTime(6600))
    expect(status).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        /Transcribing|Deciphering|Understanding|Connecting details/,
      ),
    ).not.toBeInTheDocument()
    expect(finished).toHaveTextContent("A real note.")
    expect(finishedCopy).toBeTruthy()
  })

  it("keeps a completed excerpt while showing the next image as active", () => {
    render(
      <BrowserActivityPart
        activity={{
          steps: [],
          tools: [
            {
              id: "a",
              name: "read_shared_view",
              state: "completed",
              input: { view_index: 1, view_count: 2 },
              output: { note_preview: "First actual image note." },
            },
            {
              id: "b",
              name: "read_shared_view",
              state: "running",
              input: { view_index: 2, view_count: 2 },
            },
          ],
          warning: null,
        }}
        isStreaming
      />,
    )
    expect(
      screen.getByRole("button", { name: "Read image 1 of 2" }),
    ).toHaveTextContent("First actual image note.")
    expect(
      screen.getByRole("status", { name: "Image transcription" }),
    ).toHaveTextContent("2 of 2 images")
    expect(screen.getAllByRole("button")).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "Read image 1 of 2" }))
    expect(screen.getByText("First actual image note.")).toBeInTheDocument()
    expect(
      screen.getByRole("status", { name: "Image transcription" }),
    ).toBeInTheDocument()
  })

  it("stops the phrase cycle when a running read is stopped", () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <BrowserActivityPart
        activity={{
          steps: [],
          tools: [{ id: "a", name: "read_shared_view", state: "running" }],
          warning: null,
        }}
        isStreaming
      />,
    )
    act(() => vi.advanceTimersByTime(2200))
    rerender(
      <BrowserActivityPart
        activity={{
          steps: [],
          tools: [{ id: "a", name: "read_shared_view", state: "running" }],
          warning: null,
        }}
        isStreaming={false}
      />,
    )
    const stopped = screen.getByRole("button", {
      name: "Stopped reading image 1",
    })
    expect(
      screen.queryByRole("status", { name: "Image transcription" }),
    ).not.toBeInTheDocument()
    const stoppedCopy = stopped.textContent
    act(() => vi.advanceTimersByTime(6600))
    expect(stopped).toHaveTextContent(stoppedCopy ?? "")
  })

  it("renders extracted markup as plain text", () => {
    render(
      <BrowserActivityPart
        activity={{
          steps: [],
          tools: [
            {
              id: "a",
              name: "read_shared_view",
              state: "completed",
              output: { note_preview: '<img src=x onerror="alert(1)">' },
            },
          ],
          warning: null,
        }}
        isStreaming={false}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /^Read image 1/ }))
    expect(
      screen.getByText('<img src=x onerror="alert(1)">'),
    ).toBeInTheDocument()
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
  })

  it("shows an honest fallback when completed extraction contains only whitespace", () => {
    render(
      <BrowserActivityPart
        activity={{
          steps: [],
          tools: [
            {
              id: "a",
              name: "read_shared_view",
              state: "completed",
              output: { note_preview: " \n " },
            },
          ],
          warning: null,
        }}
        isStreaming={false}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /^Read image 1/ }))
    expect(
      screen.getByText("No extracted description is available."),
    ).toBeInTheDocument()
  })

  it("hides empty completed browser activity", () => {
    const { container } = render(
      <BrowserActivityPart
        activity={{ steps: [], warning: null }}
        isStreaming={false}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
