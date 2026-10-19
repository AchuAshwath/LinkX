import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ObservationControls,
  type PrepareObservationTurnRef,
} from "../ObservationControls"

function selectBrowserTab() {
  const trigger = screen.getByRole("button", {
    name: "Add attachment or browser tab",
  })
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" })
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole("menuitem", { name: "Browser tab" }))
}

function createCapture() {
  const stopTrack = vi.fn()
  const listeners = new Map<string, EventListener>()
  const track = {
    kind: "video",
    readyState: "live",
    muted: false,
    getSettings: () => ({ displaySurface: "browser" }),
    stop: stopTrack,
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener)
    }),
    removeEventListener: vi.fn(),
  }
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream
  return {
    stream,
    track,
    stopTrack,
    emit: (type: string) => listeners.get(type)?.(new Event(type)),
  }
}

function installCaptures(...captures: ReturnType<typeof createCapture>[]) {
  const getDisplayMedia = vi.fn()
  for (const capture of captures) {
    getDisplayMedia.mockResolvedValueOnce(capture.stream)
  }
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getDisplayMedia },
  })
  return getDisplayMedia
}

describe("observation controls", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("shows an accessible live browser-tab preview and stops sharing on request", async () => {
    const stopTrack = vi.fn()
    const track = {
      kind: "video",
      readyState: "live",
      muted: false,
      getSettings: () => ({ displaySurface: "browser" }),
      stop: stopTrack,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    const stream = {
      getVideoTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream
    const getDisplayMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia },
    })

    let previewStream: MediaStream | null = null
    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      get: () => previewStream,
      set: (value: MediaStream | null) => {
        previewStream = value
      },
    })

    render(<ObservationControls />)

    selectBrowserTab()

    const preview = await screen.findByLabelText(
      "Preview of shared browser tab",
    )
    expect(screen.getByRole("status")).toHaveTextContent(/waiting.*frame/i)
    fireEvent.loadedData(preview)
    expect(screen.getByRole("status")).toHaveTextContent(
      "Browser tab is ready. Current view is included when you send.",
    )
    expect(previewStream).toBe(stream)

    fireEvent.click(
      screen.getByRole("button", {
        name: "Stop sharing browser tab",
      }),
    )

    await waitFor(() => expect(stopTrack).toHaveBeenCalledOnce())
    expect(
      screen.queryByLabelText("Preview of shared browser tab"),
    ).not.toBeInTheDocument()
  })

  it("prepares an immutable current-view packet with a fresh revision per send", async () => {
    const track = {
      kind: "video",
      readyState: "live",
      muted: false,
      getSettings: () => ({ displaySurface: "browser" }),
      stop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    const stream = {
      getVideoTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia: vi.fn().mockResolvedValue(stream) },
    })
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      `data:image/jpeg;base64,${"A".repeat(32)}`,
    )
    const prepareTurnRef: {
      current:
        | ((
            hasAttachedImages: boolean,
          ) => Readonly<import("../packet").ObservationPacket> | null)
        | null
    } = { current: null }

    render(<ObservationControls prepareTurnRef={prepareTurnRef} />)
    selectBrowserTab()
    const preview = await screen.findByLabelText(
      "Preview of shared browser tab",
    )
    Object.defineProperties(preview, {
      readyState: {
        configurable: true,
        value: HTMLMediaElement.HAVE_CURRENT_DATA,
      },
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 480 },
    })
    fireEvent.loadedData(preview)

    await waitFor(() => expect(prepareTurnRef.current).toBeTypeOf("function"))
    act(() => {
      expect(() => prepareTurnRef.current?.(true)).toThrow(
        "Remove attached images before including the browser tab.",
      )
    })
    expect(screen.getByRole("status")).toHaveTextContent(
      "Remove attached images before including the browser tab.",
    )
    const first = prepareTurnRef.current?.(false)
    const second = prepareTurnRef.current?.(false)

    expect(first).toMatchObject({
      source_epoch: 1,
      revision: 1,
      width: 640,
      height: 480,
      image_data_url: `data:image/jpeg;base64,${"A".repeat(32)}`,
    })
    expect(first?.session_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(second?.session_id).toBe(first?.session_id)
    expect(second?.revision).toBe(2)
    expect(Object.isFrozen(first)).toBe(true)
  })

  it("clears an ended capture and allows starting a fresh browser tab capture", async () => {
    const first = createCapture()
    const second = createCapture()
    const getDisplayMedia = installCaptures(first, second)

    let previewStream: MediaStream | null = null
    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      get: () => previewStream,
      set: (value: MediaStream | null) => {
        previewStream = value
      },
    })

    render(<ObservationControls />)
    selectBrowserTab()
    const firstPreview = await screen.findByLabelText(
      "Preview of shared browser tab",
    )
    await waitFor(() =>
      expect(first.track.addEventListener).toHaveBeenCalledWith(
        "ended",
        expect.any(Function),
      ),
    )
    fireEvent.loadedData(firstPreview)
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Browser tab is ready. Current view is included when you send.",
      )
      expect(first.track.addEventListener).toHaveBeenCalledWith(
        "ended",
        expect.any(Function),
      )
    })
    act(() => first.emit("ended"))

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Browser tab sharing ended. Choose a tab to share again.",
      ),
    )
    expect(
      screen.queryByLabelText("Preview of shared browser tab"),
    ).not.toBeInTheDocument()
    expect(previewStream).toBeNull()

    selectBrowserTab()
    const secondPreview = await screen.findByLabelText(
      "Preview of shared browser tab",
    )
    fireEvent.loadedData(secondPreview)
    expect(screen.getByRole("status")).toHaveTextContent(
      "Browser tab is ready. Current view is included when you send.",
    )
    expect(getDisplayMedia).toHaveBeenCalledTimes(2)
    expect(previewStream).toBe(second.stream)
  })

  it.each([
    { description: "another chat", current: "thread-one", next: "thread-two" },
    {
      description: "an unrelated new thread",
      current: null,
      next: "unrelated",
    },
  ])("stops capture when switching to $description", async ({
    current,
    next,
  }) => {
    const capture = createCapture()
    installCaptures(capture)
    const { rerender } = render(
      <ObservationControls
        activeThreadId={current}
        handoffTargetThreadId={null}
      />,
    )
    selectBrowserTab()
    const preview = await screen.findByLabelText(
      "Preview of shared browser tab",
    )
    fireEvent.loadedData(preview)
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Browser tab is ready. Current view is included when you send.",
      ),
    )

    rerender(
      <ObservationControls
        activeThreadId={next}
        handoffTargetThreadId={null}
      />,
    )

    await waitFor(() => expect(capture.stopTrack).toHaveBeenCalledOnce())
    expect(
      screen.queryByLabelText("Preview of shared browser tab"),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(/chat changed/i)
  })

  it("preserves capture only for the thread created by the handoff send", async () => {
    const capture = createCapture()
    installCaptures(capture)
    const onHandoffConsumed = vi.fn()

    const { rerender } = render(
      <ObservationControls
        activeThreadId={null}
        handoffTargetThreadId={null}
        onHandoffConsumed={onHandoffConsumed}
      />,
    )
    selectBrowserTab()
    const preview = await screen.findByLabelText(
      "Preview of shared browser tab",
    )
    fireEvent.loadedData(preview)
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Browser tab is ready. Current view is included when you send.",
      ),
    )

    rerender(
      <ObservationControls
        activeThreadId="created-thread"
        handoffTargetThreadId="created-thread"
        onHandoffConsumed={onHandoffConsumed}
      />,
    )

    expect(
      screen.getByLabelText("Preview of shared browser tab"),
    ).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(
      "Browser tab is ready. Current view is included when you send.",
    )
    expect(capture.stopTrack).not.toHaveBeenCalled()
    expect(onHandoffConsumed).toHaveBeenCalledOnce()
  })

  it("reports muted capture and waits for a resumed video frame", async () => {
    const listeners = new Map<string, EventListener>()
    const track = {
      kind: "video",
      readyState: "live",
      muted: false,
      getSettings: () => ({ displaySurface: "browser" }),
      stop: vi.fn(),
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener)
      }),
      removeEventListener: vi.fn(),
    }
    const stream = {
      getVideoTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia: vi.fn().mockResolvedValue(stream) },
    })

    render(<ObservationControls />)
    selectBrowserTab()
    const video = await screen.findByLabelText("Preview of shared browser tab")
    let frameCallback: VideoFrameRequestCallback | undefined
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: (callback: VideoFrameRequestCallback) => {
        frameCallback = callback
        return 1
      },
    })
    expect(screen.getByRole("status")).toHaveTextContent(/waiting.*frame/i)
    fireEvent.loadedData(video)
    expect(screen.getByRole("status")).toHaveTextContent(
      "Browser tab is ready. Current view is included when you send.",
    )

    track.muted = true
    act(() => listeners.get("mute")?.(new Event("mute")))
    expect(screen.getByRole("status")).toHaveTextContent(
      /sharing is paused.*resume sharing/i,
    )

    track.muted = false
    act(() => listeners.get("unmute")?.(new Event("unmute")))
    expect(screen.getByRole("status")).toHaveTextContent(
      /waiting for a current frame/i,
    )
    expect(frameCallback).toBeDefined()
    act(() =>
      frameCallback?.(performance.now(), {} as VideoFrameCallbackMetadata),
    )
    expect(screen.getByRole("status")).toHaveTextContent(
      "Browser tab is ready. Current view is included when you send.",
    )
  })

  it("rejects Send while capture is muted or waiting for its resumed frame", async () => {
    const listeners = new Map<string, EventListener>()
    const track = {
      kind: "video",
      readyState: "live",
      muted: false,
      getSettings: () => ({ displaySurface: "browser" }),
      stop: vi.fn(),
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener)
      }),
      removeEventListener: vi.fn(),
    }
    const stream = {
      getVideoTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia: vi.fn().mockResolvedValue(stream) },
    })
    const prepareTurnRef: PrepareObservationTurnRef = { current: null }

    render(<ObservationControls prepareTurnRef={prepareTurnRef} />)
    selectBrowserTab()
    const video = await screen.findByLabelText("Preview of shared browser tab")
    Object.defineProperties(video, {
      readyState: {
        configurable: true,
        value: HTMLMediaElement.HAVE_CURRENT_DATA,
      },
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 480 },
    })
    fireEvent.loadedData(video)
    await waitFor(() => expect(prepareTurnRef.current).toBeTypeOf("function"))

    track.muted = true
    act(() => listeners.get("mute")?.(new Event("mute")))
    expect(() => prepareTurnRef.current?.(false)).toThrow(
      "The shared browser tab is not providing a current frame.",
    )

    track.muted = false
    act(() => listeners.get("unmute")?.(new Event("unmute")))
    expect(() => prepareTurnRef.current?.(false)).toThrow(
      "The shared browser tab is not providing a current frame.",
    )
  })

  it("does not treat playback alone as evidence of a video frame", async () => {
    const track = {
      kind: "video",
      readyState: "live",
      muted: false,
      getSettings: () => ({ displaySurface: "browser" }),
      stop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    const stream = {
      getVideoTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia: vi.fn().mockResolvedValue(stream) },
    })

    render(<ObservationControls />)
    selectBrowserTab()
    const video = await screen.findByLabelText("Preview of shared browser tab")
    expect(screen.getByRole("status")).toHaveTextContent(/waiting.*frame/i)
    fireEvent.playing(video)
    expect(screen.getByRole("status")).toHaveTextContent(/waiting.*frame/i)
  })

  it("resumes after video time advances when frame callbacks are unavailable", async () => {
    const listeners = new Map<string, EventListener>()
    const track = {
      kind: "video",
      readyState: "live",
      muted: false,
      getSettings: () => ({ displaySurface: "browser" }),
      stop: vi.fn(),
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener)
      }),
      removeEventListener: vi.fn(),
    }
    const stream = {
      getVideoTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia: vi.fn().mockResolvedValue(stream) },
    })

    render(<ObservationControls />)
    selectBrowserTab()
    const video = await screen.findByLabelText("Preview of shared browser tab")
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: undefined,
    })
    Object.defineProperty(video, "readyState", {
      configurable: true,
      value: HTMLMediaElement.HAVE_CURRENT_DATA,
    })
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 0,
      writable: true,
    })
    fireEvent.loadedData(video)
    expect(screen.getByRole("status")).toHaveTextContent(
      "Browser tab is ready. Current view is included when you send.",
    )

    track.muted = true
    act(() => listeners.get("mute")?.(new Event("mute")))
    track.muted = false
    act(() => listeners.get("unmute")?.(new Event("unmute")))
    expect(screen.getByRole("status")).toHaveTextContent(
      "Waiting for a current frame from the browser tab.",
    )

    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 0.1,
    })
    fireEvent.timeUpdate(video)
    expect(screen.getByRole("status")).toHaveTextContent(
      "Browser tab is ready. Current view is included when you send.",
    )
  })

  it("clears a capture whose track ended before the ended listener was attached", async () => {
    const listeners = new Map<string, EventListener>()
    const track = {
      kind: "video",
      readyState: "live",
      muted: false,
      getSettings: () => ({ displaySurface: "browser" }),
      stop: vi.fn(),
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener)
      }),
      removeEventListener: vi.fn(),
    }
    let trackReads = 0
    const stream = {
      getVideoTracks: () => {
        trackReads += 1
        if (trackReads === 2) track.readyState = "ended"
        return [track]
      },
      getTracks: () => [track],
    } as unknown as MediaStream
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia: vi.fn().mockResolvedValue(stream) },
    })

    render(<ObservationControls />)
    selectBrowserTab()
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/sharing ended/i),
    )
    expect(track.stop).toHaveBeenCalledOnce()
    expect(
      screen.queryByLabelText("Preview of shared browser tab"),
    ).not.toBeInTheDocument()
  })

  it("stops capture and clears the preview from its inline close button", async () => {
    const stopTrack = vi.fn()
    const track = {
      kind: "video",
      readyState: "live",
      muted: false,
      getSettings: () => ({ displaySurface: "browser" }),
      stop: stopTrack,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    const stream = {
      getVideoTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream
    const getDisplayMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia },
    })

    render(
      <ObservationControls
        activeThreadId="thread-one"
        handoffTargetThreadId={null}
        onHandoffConsumed={vi.fn()}
      />,
    )
    selectBrowserTab()
    const preview = await screen.findByLabelText(
      "Preview of shared browser tab",
    )
    fireEvent.loadedData(preview)
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Browser tab is ready. Current view is included when you send.",
      ),
    )

    fireEvent.click(
      screen.getByRole("button", {
        name: "Stop sharing browser tab",
      }),
    )

    await waitFor(() => expect(stopTrack).toHaveBeenCalledOnce())
    expect(
      screen.queryByLabelText("Preview of shared browser tab"),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(/disconnected/i)
  })
})
