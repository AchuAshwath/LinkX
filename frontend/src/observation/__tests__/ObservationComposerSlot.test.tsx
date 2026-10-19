import { fireEvent, render, screen } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"
import {
  ObservationComposerPreview,
  ObservationComposerSlot,
} from "../ObservationComposerSlot"

describe("observation composer preview", () => {
  it("keeps active browser context out of the prompt controls", () => {
    render(
      <ObservationComposerSlot
        view={{
          isConnected: true,
          hasCurrentFrame: true,
          status: "Browser tab is ready.",
        }}
        videoRef={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onReset={vi.fn()}
      />,
    )

    expect(screen.getByRole("status")).toHaveTextContent(
      "Browser tab is ready.",
    )
    expect(screen.queryByText("Browser tab")).not.toBeInTheDocument()
    expect(screen.queryByText("Live")).not.toBeInTheDocument()
  })

  it("shows only the captured frame and a stop button in the floating preview", () => {
    const onStop = vi.fn()
    const addContextButtonRef = createRef<HTMLButtonElement>()
    const props = {
      view: {
        isConnected: true,
        hasCurrentFrame: true,
        status: "Browser tab is ready.",
        modelName: "gpt-5.6-luna",
      },
      videoRef: vi.fn(),
      onStart: vi.fn(),
      onStop,
      onReset: vi.fn(),
      addContextButtonRef,
    }
    render(
      <>
        <button ref={addContextButtonRef} type="button">
          Add context
        </button>
        <ObservationComposerPreview {...props} />
      </>,
    )

    expect(
      screen.getByRole("region", { name: "Shared browser tab preview" }),
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText("Preview of shared browser tab"),
    ).toBeInTheDocument()
    expect(screen.queryByText("Shared browser tab")).not.toBeInTheDocument()
    expect(screen.queryByText(/Questions use/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Reset/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("Current view is included when you send."),
    ).not.toBeInTheDocument()

    const stopButton = screen.getByRole("button", {
      name: "Stop sharing browser tab",
    })
    const preview = screen.getByRole("region", {
      name: "Shared browser tab preview",
    })
    expect(preview).toHaveClass(
      "group",
      "overflow-hidden",
      "rounded-2xl",
      "ring-1",
      "ring-inset",
    )
    expect(screen.getByLabelText("Preview of shared browser tab")).toHaveClass(
      "rounded-2xl",
    )
    expect(stopButton).toHaveClass(
      "opacity-0",
      "group-hover:opacity-100",
      "group-focus-within:opacity-100",
      "focus-visible:opacity-100",
    )
    stopButton.focus()
    fireEvent.click(stopButton)
    expect(onStop).toHaveBeenCalledOnce()
    expect(addContextButtonRef.current).toHaveFocus()
  })

  it("announces a waiting or paused state without adding preview copy", () => {
    render(
      <ObservationComposerSlot
        view={{
          isConnected: true,
          hasCurrentFrame: false,
          isPaused: true,
          status: "Browser tab sharing is paused.",
        }}
        videoRef={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onReset={vi.fn()}
      />,
    )

    expect(screen.getByRole("status")).toHaveTextContent(
      "Browser tab sharing is paused.",
    )
    expect(
      screen.queryByText("Waiting for a live frame"),
    ).not.toBeInTheDocument()
  })
})
