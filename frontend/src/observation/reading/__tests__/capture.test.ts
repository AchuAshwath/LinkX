import { describe, expect, it } from "vitest"
import {
  type BrowserCaptureEnvironment,
  createBrowserReadingCapture,
} from "../capture"
import type { BrowserFrame } from "../types"

const FIXED_NOW = Date.parse("2026-10-23T00:00:00.000Z")
const JPEG = "data:image/jpeg;base64,AA=="
const PIPELINE_PNG = "data:image/png;base64,AA=="

type Sampler = ReturnType<BrowserCaptureEnvironment["createSampler"]>
type Pipeline = ReturnType<BrowserCaptureEnvironment["createPipeline"]>
type CaptureStream = Awaited<
  ReturnType<ReturnType<BrowserCaptureEnvironment["createSession"]>["start"]>
>
type Deferred<T> = { promise: Promise<T>; resolve(value: T): void }

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

function bitmap(onClose: () => void = () => {}, width = 8, height = 8) {
  return {
    width,
    height,
    close: onClose,
  } as ImageBitmap
}

function fakeStream() {
  let readyState: MediaStreamTrackState = "live"
  const listeners = new Set<EventListener>()
  const track = {
    get readyState() {
      return readyState
    },
    stop() {
      readyState = "ended"
    },
    addEventListener(
      _type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      listeners.add(listener as EventListener)
    },
    removeEventListener(
      _type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      listeners.delete(listener as EventListener)
    },
  } as unknown as MediaStreamTrack
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream
  return {
    stream,
    end() {
      readyState = "ended"
      listeners.forEach((listener) => {
        listener(new Event("ended"))
      })
    },
  }
}

function fakeVideo(play: () => Promise<void> = async () => {}) {
  return {
    muted: false,
    playsInline: false,
    srcObject: null,
    play,
    pause() {},
    remove() {},
  } as unknown as HTMLVideoElement
}

function fakeCanvas(contextAvailable = true) {
  return {
    width: 0,
    height: 0,
    getContext: () => (contextAvailable ? { drawImage() {} } : null),
    toDataURL: () => JPEG,
  } as unknown as HTMLCanvasElement
}

function rawFrame(seq: number) {
  return {
    seq,
    generation: 1,
    ownerChat: "browser-reading",
    capturedAt: seq * 100,
    width: 8,
    height: 8,
    pixels: new Uint8Array(8 * 8 * 4),
    getDataUrl: () => PIPELINE_PNG,
  }
}

function createHarness(
  options: {
    contextAvailable?: boolean
    decode?: (blob: Blob, index: number) => Promise<ImageBitmap>
    play?: () => Promise<void>
    start?: () => Promise<CaptureStream>
  } = {},
) {
  let offerFrame: ((frame: unknown) => void) | undefined
  let nextCandidate: unknown
  let hasBaseline = false
  let clearCount = 0
  let decodeCount = 0
  let gapCount = 0
  let samplerStartCount = 0
  let samplerStopCount = 0
  const candidates: BrowserFrame[] = []
  const pipelines: Pipeline[] = []
  const samplers: Sampler[] = []
  let fakeCapture = fakeStream()
  const session = {
    start:
      options.start ??
      (async () => {
        fakeCapture = fakeStream()
        return fakeCapture.stream
      }),
    stop() {},
  }
  const environment = {
    createSession: () => session,
    createVideo: () => fakeVideo(options.play),
    createCanvas: () => fakeCanvas(options.contextAvailable),
    fetchDataUrl: async () => new Blob(["image"]),
    createImageBitmap: async (blob: Blob) => {
      decodeCount += 1
      if (options.decode) return options.decode(blob, decodeCount)
      return bitmap()
    },
    createPipeline: () => {
      const pipeline: Pipeline = {
        offer(frame) {
          if (!hasBaseline) {
            hasBaseline = true
            return
          }
          const value = frame as Record<string, unknown>
          nextCandidate = {
            seq: value.seq,
            capturedAt: value.capturedAt,
            width: value.width,
            height: value.height,
            dataUrl: PIPELINE_PNG,
          }
        },
        takePending() {
          const candidate = nextCandidate
          nextCandidate = undefined
          return candidate
        },
        clear() {
          clearCount += 1
          hasBaseline = false
          nextCandidate = undefined
        },
      }
      pipelines.push(pipeline)
      return pipeline
    },
    createSampler: (
      config: Parameters<BrowserCaptureEnvironment["createSampler"]>[0],
    ) => {
      const sampler: Sampler = {
        start() {
          samplerStartCount += 1
          offerFrame = config.onFrame
        },
        stop() {
          samplerStopCount += 1
          offerFrame = undefined
        },
      }
      samplers.push(sampler)
      return sampler
    },
    performanceNow: () => 10,
    dateNow: () => FIXED_NOW,
    createUUID: () => `encoded-${candidates.length + 1}`,
  } satisfies Partial<BrowserCaptureEnvironment>
  const capture = createBrowserReadingCapture({ environment })

  return {
    capture,
    candidates,
    emit(frame: unknown) {
      offerFrame?.(frame)
    },
    get clearCount() {
      return clearCount
    },
    get decodeCount() {
      return decodeCount
    },
    get gapCount() {
      return gapCount
    },
    get samplers() {
      return samplers
    },
    get samplerStartCount() {
      return samplerStartCount
    },
    get samplerStopCount() {
      return samplerStopCount
    },
    get pipelines() {
      return pipelines
    },
    endCapture() {
      fakeCapture.end()
    },
    onGap() {
      gapCount += 1
    },
    setCallback(callback: (frame: BrowserFrame) => boolean) {
      capture.start(callback, {
        generation: 1,
        ownerChat: "browser-reading",
        onGap: () => {
          gapCount += 1
        },
      })
    },
  }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

describe("BrowserReadingCapture", () => {
  it("notifies once when the display track has ended before playback starts", async () => {
    const stream = fakeStream()
    stream.end()
    const harness = createHarness({ start: async () => stream.stream })
    let endedCount = 0
    harness.capture.start(() => true, {
      generation: 1,
      ownerChat: "browser-reading",
      onEnded: () => {
        endedCount += 1
      },
    })
    await flush()
    expect(harness.samplers).toHaveLength(0)
    expect(endedCount).toBe(1)
  })

  it("notifies once when the display track ends while playback is starting", async () => {
    const playback = deferred<void>()
    const harness = createHarness({ play: () => playback.promise })
    let endedCount = 0
    harness.capture.start(() => true, {
      generation: 1,
      ownerChat: "browser-reading",
      onEnded: () => {
        endedCount += 1
      },
    })
    await flush()
    harness.endCapture()
    playback.resolve()
    await flush()
    expect(harness.samplers).toHaveLength(0)
    expect(endedCount).toBe(1)
  })

  it("notifies once when the display track ends after playback starts", async () => {
    const harness = createHarness()
    let endedCount = 0
    harness.capture.start(() => true, {
      generation: 1,
      ownerChat: "browser-reading",
      onEnded: () => {
        endedCount += 1
      },
    })
    await flush()
    expect(harness.samplers).toHaveLength(1)
    harness.endCapture()
    harness.endCapture()
    await flush()
    expect(endedCount).toBe(1)
    expect(harness.samplerStopCount).toBe(1)
    harness.capture.stop()
    expect(endedCount).toBe(1)
  })

  it("does not stop a replacement capture started by the end callback", async () => {
    const harness = createHarness()
    let endedCount = 0
    let restartOnEnd = true
    const onEnded = () => {
      endedCount += 1
      if (!restartOnEnd) return
      restartOnEnd = false
      harness.capture.stop()
      harness.capture.start(() => true, {
        generation: 2,
        ownerChat: "browser-reading",
        onEnded,
      })
    }
    harness.capture.start(() => true, {
      generation: 1,
      ownerChat: "browser-reading",
      onEnded,
    })
    await flush()
    harness.endCapture()
    await flush()
    expect(endedCount).toBe(1)
    expect(harness.samplerStartCount).toBe(2)
    expect(harness.samplerStopCount).toBe(1)
    harness.capture.stop()
  })

  it("ignores an old playback completion after capture restarts", async () => {
    const oldPlayback = deferred<void>()
    let playCount = 0
    const harness = createHarness({
      start: async () => fakeStream().stream,
      play: () => {
        playCount += 1
        return playCount === 1 ? oldPlayback.promise : Promise.resolve()
      },
    })
    let endedCount = 0
    const onEnded = () => {
      endedCount += 1
    }
    harness.capture.start(() => true, {
      generation: 1,
      ownerChat: "browser-reading",
      onEnded,
    })
    await flush()
    harness.capture.stop()
    harness.capture.start(() => true, {
      generation: 2,
      ownerChat: "browser-reading",
      onEnded,
    })
    await flush()
    expect(harness.samplers).toHaveLength(1)
    oldPlayback.resolve()
    await flush()
    expect(harness.samplers).toHaveLength(1)
    expect(endedCount).toBe(0)
    harness.capture.stop()
  })

  it("retains the selected waiting encode when later samples arrive after a checkpoint", async () => {
    const decoding = deferred<ImageBitmap>()
    const harness = createHarness({
      decode: async (_blob, index) =>
        index === 1 ? decoding.promise : bitmap(),
    })
    harness.setCallback((frame) => {
      harness.candidates.push(frame)
      return true
    })
    await flush()
    harness.emit(rawFrame(1))
    harness.emit(rawFrame(2))
    await flush()
    harness.emit(rawFrame(3))
    const checkpoint = harness.capture.checkpoint!()
    harness.emit(rawFrame(4))
    decoding.resolve(bitmap())
    await checkpoint.settled
    expect(harness.candidates.map((frame) => frame.sequence)).toEqual([2, 3])
    expect(harness.gapCount).toBe(1)
    harness.capture.stop()
  })

  it("checkpoints the selected encode without waiting for future samples", async () => {
    const decoding = deferred<ImageBitmap>()
    const future = deferred<ImageBitmap>()
    const harness = createHarness({
      decode: async (_blob, index) =>
        index === 1 ? decoding.promise : future.promise,
    })
    harness.setCallback((frame) => {
      harness.candidates.push(frame)
      return true
    })
    await flush()
    harness.emit(rawFrame(1))
    harness.emit(rawFrame(2))
    await flush()
    const checkpoint = harness.capture.checkpoint!()
    expect(checkpoint.sequence).toBe(2)
    let ready = false
    void checkpoint.settled.then(() => {
      ready = true
    })
    harness.emit(rawFrame(3))
    await flush()
    expect(ready).toBe(false)
    decoding.resolve(bitmap())
    await checkpoint.settled
    expect(harness.candidates.map((frame) => frame.sequence)).toEqual([2])
    expect(ready).toBe(true)
    future.resolve(bitmap())
    await flush()
    harness.capture.stop()
  })

  it("clears its candidate baseline after downstream admission rejects a frame", async () => {
    const harness = createHarness()
    const decisions: boolean[] = []
    harness.setCallback(() => {
      const admitted = decisions.length > 0
      decisions.push(admitted)
      return admitted
    })
    await flush()

    harness.emit(rawFrame(1))
    harness.emit(rawFrame(2))
    await flush()
    expect(decisions).toEqual([false])
    expect(harness.clearCount).toBe(1)
    expect(harness.gapCount).toBe(1)

    harness.emit(rawFrame(3))
    await flush()
    expect(decisions).toEqual([false])
    harness.emit(rawFrame(4))
    await flush()
    expect(decisions).toEqual([false, true])
    harness.capture.stop()
  })

  it("drains a new generation candidate after an old encode settles", async () => {
    const oldBitmap = deferred<ImageBitmap>()
    const harness = createHarness({
      decode: async (_blob, index) =>
        index === 1 ? oldBitmap.promise : bitmap(),
    })
    harness.setCallback((frame) => {
      harness.candidates.push(frame)
      return true
    })
    await flush()
    harness.emit(rawFrame(1))
    harness.emit(rawFrame(2))
    await flush()
    expect(harness.decodeCount).toBe(1)

    harness.capture.stop()
    harness.setCallback((frame) => {
      harness.candidates.push(frame)
      return true
    })
    await flush()
    harness.emit(rawFrame(3))
    harness.emit(rawFrame(4))
    await flush()
    expect(harness.decodeCount).toBe(1)

    oldBitmap.resolve(bitmap())
    await flush()
    expect(harness.decodeCount).toBe(2)
    expect(harness.candidates.map((frame) => frame.sequence)).toEqual([4])
    harness.capture.stop()
  })

  it("closes the decoded bitmap when canvas conversion cannot start", async () => {
    let closeCount = 0
    const harness = createHarness({
      contextAvailable: false,
      decode: async () =>
        bitmap(() => {
          closeCount += 1
        }),
    })
    harness.setCallback(() => true)
    await flush()
    harness.emit(rawFrame(1))
    harness.emit(rawFrame(2))
    await flush()

    expect(closeCount).toBe(1)
    expect(harness.gapCount).toBe(1)
    harness.capture.stop()
  })

  it("rejects decoded source images above eight million pixels and closes them", async () => {
    let closeCount = 0
    let delivered = 0
    const harness = createHarness({
      decode: async () =>
        bitmap(
          () => {
            closeCount += 1
          },
          3000,
          3000,
        ),
    })
    harness.setCallback(() => {
      delivered += 1
      return true
    })
    await flush()
    harness.emit(rawFrame(1))
    harness.emit(rawFrame(2))
    await flush()

    expect(closeCount).toBe(1)
    expect(delivered).toBe(0)
    expect(harness.gapCount).toBe(1)
    harness.capture.stop()
  })
})
