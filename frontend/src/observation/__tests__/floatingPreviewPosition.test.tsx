import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useRef } from "react"
import { describe, expect, it, vi } from "vitest"
import {
  ObservationComposerPreview,
  type ObservationComposerSlotProps,
} from "../ObservationComposerSlot"
import {
  type FloatingPreviewPosition,
  measureSidebarPreview,
  useFloatingPreviewPosition,
} from "../useFloatingPreviewPosition"

function rect(left: number, top: number, width: number, height: number) {
  return new DOMRect(left, top, width, height)
}

function requirePosition(
  position: FloatingPreviewPosition | null,
): FloatingPreviewPosition {
  if (!position) throw new Error("Expected preview to fit in the sidebar gap")
  return position
}

function addSidebarMarkers() {
  let profileTop = 916
  const rail = document.createElement("div")
  rail.dataset.browserPreviewRail = ""
  rail.getBoundingClientRect = () => rect(0, 0, 256, 1000)
  const start = document.createElement("button")
  start.dataset.browserPreviewStart = ""
  start.getBoundingClientRect = () => rect(16, 320, 240, 44)
  const profile = document.createElement("div")
  profile.dataset.browserPreviewEnd = ""
  profile.getBoundingClientRect = () => rect(16, profileTop, 240, 68)
  document.body.append(rail, start, profile)
  return {
    setProfileTop: (top: number) => {
      profileTop = top
    },
    remove: () => {
      rail.remove()
      start.remove()
      profile.remove()
    },
  }
}

function DraggablePreviewHarness({
  active,
  onStop,
}: {
  active: boolean
  onStop: () => void
}) {
  const previewRef = useRef<HTMLElement | null>(null)
  const addContextButtonRef = useRef<HTMLButtonElement>(null)
  const { position, dragHandlers } = useFloatingPreviewPosition({
    active,
    previewRef,
  })
  const props: ObservationComposerSlotProps = {
    view: {
      isConnected: true,
      hasCurrentFrame: true,
      status: "Browser tab is ready.",
    },
    videoRef: vi.fn(),
    onStart: vi.fn(),
    onStop,
    onReset: vi.fn(),
    addContextButtonRef,
  }

  return (
    <>
      <button ref={addContextButtonRef} type="button">
        Add browser tab
      </button>
      {active ? (
        <ObservationComposerPreview
          {...props}
          previewRef={previewRef}
          dragHandlers={dragHandlers}
          style={{
            position: "fixed",
            left: position?.left ?? 0,
            top: position?.top ?? 0,
            width: position?.width ?? 0,
            height: position?.height ?? 0,
            visibility: position ? "visible" : "hidden",
          }}
        />
      ) : null}
    </>
  )
}

describe("floating browser preview placement", () => {
  it("centers a compact 16:9 window in the gap between sidebar controls", () => {
    const position = requirePosition(
      measureSidebarPreview({
        rail: rect(0, 0, 256, 1000),
        start: rect(16, 320, 240, 44),
        profile: rect(16, 916, 240, 68),
        viewportWidth: 1440,
        viewportHeight: 1000,
      }),
    )

    expect(position.width).toBe(224)
    expect(position.left).toBe(16)
    expect(position.left + position.width).toBeLessThanOrEqual(256)
    expect(position.top).toBeGreaterThan(364)
    expect(position.top + position.height).toBeLessThan(900)
    expect(position.height).toBe(126)
  })

  it("matches the captured tab ratio instead of adding letterbox bands", () => {
    const position = requirePosition(
      measureSidebarPreview({
        rail: rect(0, 0, 256, 1000),
        start: rect(16, 320, 240, 44),
        profile: rect(16, 916, 240, 68),
        viewportWidth: 1440,
        viewportHeight: 1000,
        aspectRatio: 1.9,
      }),
    )

    expect(position.width).toBe(224)
    expect(position.height).toBeCloseTo(224 / 1.9)
  })

  it("shrinks to fit a gap shorter than the standard preview", () => {
    const position = requirePosition(
      measureSidebarPreview({
        rail: rect(0, 0, 256, 500),
        start: rect(16, 320, 240, 44),
        profile: rect(16, 445, 240, 40),
        viewportWidth: 1440,
        viewportHeight: 500,
      }),
    )

    expect(position.height).toBe(49)
    expect(position.width).toBeCloseTo((49 * 16) / 9)
    expect(position.top).toBe(380)
    expect(position.top + position.height).toBeLessThanOrEqual(429)
  })

  it("hides the preview when the gap cannot fit its close control", () => {
    expect(
      measureSidebarPreview({
        rail: rect(0, 0, 256, 500),
        start: rect(16, 320, 240, 44),
        profile: rect(16, 410, 240, 40),
        viewportWidth: 1440,
        viewportHeight: 500,
      }),
    ).toBeNull()
  })

  it("clamps pointer and keyboard movement while X remains a stop control", async () => {
    const sidebar = addSidebarMarkers()
    const onStop = vi.fn()
    const { rerender } = render(
      <DraggablePreviewHarness active onStop={onStop} />,
    )
    const preview = screen.getByRole("region", {
      name: "Shared browser tab preview",
    })
    Object.assign(preview, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    })
    expect(preview).toHaveStyle({ left: "16px", top: "577px" })

    fireEvent.pointerDown(preview, {
      pointerId: 1,
      clientX: 20,
      clientY: 400,
    })
    fireEvent.pointerMove(preview, {
      pointerId: 1,
      clientX: 60,
      clientY: 460,
    })
    fireEvent.pointerUp(preview, { pointerId: 1 })
    expect(preview).toHaveStyle({ left: "56px" })
    const draggedTop = Number.parseFloat(preview.style.top)
    expect(draggedTop).toBeGreaterThan(577)

    preview.focus()
    expect(preview).toHaveFocus()
    fireEvent.keyDown(preview, { key: "ArrowRight" })
    expect(preview).toHaveStyle({ left: "66px" })
    fireEvent.keyDown(preview, { key: "ArrowUp", shiftKey: true })
    const keyboardTop = Number.parseFloat(preview.style.top)
    expect(keyboardTop).toBe(draggedTop - 40)

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Stop sharing browser tab" }),
      {
        pointerId: 2,
        clientX: 66,
        clientY: keyboardTop,
      },
    )
    fireEvent.pointerMove(preview, {
      pointerId: 2,
      clientX: 500,
      clientY: 800,
    })
    expect(preview).toHaveStyle({ left: "66px", top: `${keyboardTop}px` })

    fireEvent.click(
      screen.getByRole("button", { name: "Stop sharing browser tab" }),
    )
    expect(onStop).toHaveBeenCalledOnce()
    expect(
      screen.getByRole("button", { name: "Add browser tab" }),
    ).toHaveFocus()

    rerender(<DraggablePreviewHarness active={false} onStop={onStop} />)
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Shared browser tab preview" }),
      ).not.toBeInTheDocument()
    })
    rerender(<DraggablePreviewHarness active onStop={onStop} />)
    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: "Shared browser tab preview" }),
      ).toHaveStyle({ left: "16px", top: "577px" })
    })
    sidebar.remove()
  })

  it("hides and resets after the sidebar gap disappears on resize", () => {
    const sidebar = addSidebarMarkers()
    const { getByRole } = render(
      <DraggablePreviewHarness active onStop={vi.fn()} />,
    )
    const preview = getByRole("region", { name: "Shared browser tab preview" })
    Object.assign(preview, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    })
    fireEvent.pointerDown(preview, {
      pointerId: 1,
      button: 0,
      clientX: 0,
      clientY: 0,
    })
    fireEvent.pointerMove(preview, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerUp(preview, { pointerId: 1 })
    expect(preview).toHaveStyle({ left: "116px", visibility: "visible" })

    sidebar.setProfileTop(380)
    fireEvent(window, new Event("resize"))
    expect(preview).toHaveStyle({ width: "0px", visibility: "hidden" })

    sidebar.setProfileTop(916)
    fireEvent(window, new Event("resize"))
    expect(preview).toHaveStyle({
      left: "16px",
      top: "577px",
      visibility: "visible",
    })
    sidebar.remove()
  })

  it("re-measures the floating frame when capture dimensions load", async () => {
    const sidebar = addSidebarMarkers()
    render(<DraggablePreviewHarness active onStop={vi.fn()} />)
    const preview = screen.getByRole("region", {
      name: "Shared browser tab preview",
    })
    const video = screen.getByLabelText("Preview of shared browser tab")
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1900 },
      videoHeight: { configurable: true, value: 1000 },
    })

    fireEvent.loadedMetadata(video)

    await waitFor(() =>
      expect(Number.parseFloat(preview.style.height)).toBeCloseTo(224 / 1.9),
    )
    sidebar.remove()
  })

  it("reclamps a dragged preview when the viewport shrinks", () => {
    const sidebar = addSidebarMarkers()
    const width = vi.spyOn(window, "innerWidth", "get").mockReturnValue(1024)
    const { getByRole } = render(
      <DraggablePreviewHarness active onStop={vi.fn()} />,
    )
    const preview = getByRole("region", { name: "Shared browser tab preview" })
    Object.assign(preview, { setPointerCapture: vi.fn() })
    for (const [pointerId, button] of [1, 2].entries()) {
      const clickWasAllowed = fireEvent.pointerDown(preview, {
        pointerId,
        button,
        clientX: 0,
        clientY: 0,
      })
      fireEvent.pointerMove(preview, {
        pointerId,
        clientX: 400,
        clientY: 100,
      })
      expect(clickWasAllowed).toBe(true)
    }
    expect(preview).toHaveStyle({ left: "16px", top: "577px" })
    fireEvent.pointerDown(preview, {
      pointerId: 1,
      button: 0,
      clientX: 0,
      clientY: 0,
    })
    fireEvent.pointerMove(preview, {
      pointerId: 1,
      clientX: 1000,
      clientY: 0,
    })
    expect(preview).toHaveStyle({ left: "784px" })

    width.mockReturnValue(800)
    fireEvent(window, new Event("resize"))
    expect(preview).toHaveStyle({ left: "560px", width: "224px" })

    width.mockRestore()
    sidebar.remove()
  })
})
