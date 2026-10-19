import { afterEach, describe, expect, it, vi } from "vitest"
import { encodeCurrentView, type ObservationPacket } from "../packet"

const DATA_URL = `data:image/jpeg;base64,${"A".repeat(32)}`

function setupCanvas(
  encode: (width: number, height: number, quality: number) => string,
) {
  const context = { drawImage: vi.fn() }
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(
    function (this: HTMLCanvasElement, _type?: string, quality?: number) {
      return encode(this.width, this.height, quality ?? 0)
    },
  )
  return { context }
}

function readyVideo(width = 640, height = 480) {
  return {
    readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
    videoWidth: width,
    videoHeight: height,
  } as HTMLVideoElement
}

const metadata = {
  session_id: "session-7",
  source_epoch: 3,
  revision: 12,
  frame_presented_at_ms: 987.5,
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("encodeCurrentView", () => {
  it("encodes a ready current frame into an immutable request packet", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-18T08:00:00.000Z"))
    setupCanvas(() => DATA_URL)

    const packet = encodeCurrentView(readyVideo(), metadata)

    expect(packet).toMatchObject<Partial<ObservationPacket>>({
      session_id: "session-7",
      source_epoch: 3,
      revision: 12,
      frame_presented_at_ms: 987.5,
      width: 640,
      height: 480,
      image_data_url: DATA_URL,
      captured_at: "2026-10-18T08:00:00.000Z",
      delivered_at: "2026-10-18T08:00:00.000Z",
    })
    expect(Object.isFrozen(packet)).toBe(true)
  })

  it("rejects videos without a current frame before drawing", () => {
    const { context } = setupCanvas(() => DATA_URL)
    const video = readyVideo()
    Object.defineProperty(video, "readyState", {
      value: HTMLMediaElement.HAVE_METADATA,
    })

    expect(() => encodeCurrentView(video, metadata)).toThrow("no current frame")
    expect(context.drawImage).not.toHaveBeenCalled()
  })

  it("bounds encoded dimensions by edge length and total pixels", () => {
    const drawn: Array<{ width: number; height: number }> = []
    setupCanvas(() => DATA_URL)
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: (
        ...args: [HTMLVideoElement, number, number, number, number]
      ) => {
        const width = args[3]
        const height = args[4]
        drawn.push({ width, height })
      },
    } as unknown as CanvasRenderingContext2D)

    const packet = encodeCurrentView(readyVideo(5000, 4000), metadata)

    expect(packet.width).toBeLessThanOrEqual(2048)
    expect(packet.height).toBeLessThanOrEqual(2048)
    expect(packet.width * packet.height).toBeLessThanOrEqual(4_194_304)
    expect(drawn[0]).toEqual({ width: 2048, height: 1638 })
  })

  it("reduces dimensions and quality until the JPEG data URI fits the ceiling", () => {
    const attempts: Array<{ width: number; height: number; quality: number }> =
      []
    setupCanvas((width, height, quality) => {
      attempts.push({ width, height, quality })
      return attempts.length === 1
        ? `data:image/jpeg;base64,${"A".repeat(2_000_000)}`
        : DATA_URL
    })

    const packet = encodeCurrentView(readyVideo(1920, 1080), metadata)

    expect(attempts).toHaveLength(2)
    expect(attempts[1].width).toBeLessThan(attempts[0].width)
    expect(attempts[1].height).toBeLessThan(attempts[0].height)
    expect(attempts[1].quality).toBeLessThan(attempts[0].quality)
    expect(packet.image_data_url.length).toBeLessThanOrEqual(2_000_000)
  })

  it("rejects when the browser cannot encode a valid bounded JPEG", () => {
    setupCanvas(() => {
      throw new Error("canvas encoding failed")
    })

    expect(() => encodeCurrentView(readyVideo(), metadata)).toThrow(
      "Could not encode the browser tab frame within the size limit.",
    )
  })

  it("rejects malformed JPEG data URIs instead of labeling arbitrary data as an image", () => {
    setupCanvas(() => "data:image/jpeg;base64,A")

    expect(() => encodeCurrentView(readyVideo(), metadata)).toThrow(
      "Could not encode the browser tab frame within the size limit.",
    )
  })
})
