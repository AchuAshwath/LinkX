import { afterEach, describe, expect, it, vi } from "vitest"
import { createObservationSession } from "../session"

function installCapture({
  surface = "browser",
  readyState = "live",
  includeAudio = false,
}: {
  surface?: string
  readyState?: string
  includeAudio?: boolean
} = {}) {
  const stopVideo = vi.fn()
  const stopAudio = vi.fn()
  const videoTrack = {
    kind: "video",
    readyState,
    getSettings: () => ({ displaySurface: surface }),
    stop: stopVideo,
  }
  const audioTrack = { kind: "audio", stop: stopAudio }
  const tracks = includeAudio ? [videoTrack, audioTrack] : [videoTrack]
  const stream = {
    getVideoTracks: () => [videoTrack],
    getTracks: () => tracks,
  }
  const getDisplayMedia = vi.fn().mockResolvedValue(stream)
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getDisplayMedia },
  })
  return { stream, getDisplayMedia, stopVideo, stopAudio }
}

function installPendingCapture() {
  const stopTrack = vi.fn()
  const track = {
    kind: "video",
    getSettings: () => ({ displaySurface: "browser" }),
    stop: stopTrack,
  }
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  }
  let resolveCapture: (capture: typeof stream) => void = () => {}
  const getDisplayMedia = vi.fn(
    () =>
      new Promise<typeof stream>((resolve) => {
        resolveCapture = resolve
      }),
  )
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getDisplayMedia },
  })
  return {
    stream,
    getDisplayMedia,
    stopTrack,
    resolveCapture: () => resolveCapture(stream),
  }
}

describe("observation session", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("starts only a verified browser tab capture and releases it on stop", async () => {
    const { getDisplayMedia, stopVideo } = installCapture()

    const session = createObservationSession()
    await session.start()
    session.stop()

    expect(getDisplayMedia).toHaveBeenCalledWith({
      video: { displaySurface: "browser" },
      audio: false,
    })
    expect(stopVideo).toHaveBeenCalledOnce()
  })

  it("rejects and releases a browser track that already ended", async () => {
    const { stopVideo } = installCapture({ readyState: "ended" })

    await expect(createObservationSession().start()).rejects.toThrow(
      /shared browser tab stopped/i,
    )
    expect(stopVideo).toHaveBeenCalledOnce()
  })

  it("stops an unverified capture instead of observing a window or monitor", async () => {
    const { stopVideo } = installCapture({ surface: "window" })

    const session = createObservationSession()
    await expect(session.start()).rejects.toThrow(/browser tab/i)

    expect(stopVideo).toHaveBeenCalledOnce()
  })

  it("stops a capture that arrives after the session was stopped", async () => {
    const { stopTrack, resolveCapture } = installPendingCapture()

    const session = createObservationSession()
    const pendingStart = session.start()
    session.stop()
    resolveCapture()

    await expect(pendingStart).rejects.toThrow(/setup was cancelled/i)
    expect(stopTrack).toHaveBeenCalledOnce()
  })

  it("shares a pending capture request across duplicate starts", async () => {
    const { getDisplayMedia, resolveCapture, stopTrack } =
      installPendingCapture()

    const session = createObservationSession()
    const firstStart = session.start()
    const secondStart = session.start()
    resolveCapture()
    await Promise.all([firstStart, secondStart])
    session.stop()

    expect(getDisplayMedia).toHaveBeenCalledOnce()
    expect(stopTrack).toHaveBeenCalledOnce()
  })

  it("rejects streams containing audio and stops every track", async () => {
    const { stopVideo, stopAudio } = installCapture({ includeAudio: true })

    const session = createObservationSession()
    await expect(session.start()).rejects.toThrow(/audio/i)

    expect(stopVideo).toHaveBeenCalledOnce()
    expect(stopAudio).toHaveBeenCalledOnce()
  })
})
