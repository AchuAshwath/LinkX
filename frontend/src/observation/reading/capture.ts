import { createCapturePipeline } from "../../../scripts/observation-lab/automatic-capture-v3/pipeline.mjs"
import { createStreamSampler } from "../../../scripts/observation-lab/automatic-capture-v3/stream.mjs"
import { createObservationSession } from "../session"
import type { BrowserCaptureSource } from "./session"
import type { BrowserFrame } from "./types"

const MAX_EDGE = 2048
const MAX_PIXELS = 4_194_304
const MAX_SOURCE_PIXELS = 8_388_608
const MAX_IMAGE_CHARS = 2_000_000
const JPEG_PREFIX = "data:image/jpeg;base64,"

type NativeCaptureSession = ReturnType<typeof createObservationSession>
type CapturePipeline = ReturnType<typeof createCapturePipeline>
type CaptureSampler = ReturnType<typeof createStreamSampler>

export interface BrowserCaptureEnvironment {
  createSession(): Pick<NativeCaptureSession, "start" | "stop">
  createVideo(): HTMLVideoElement
  createCanvas(): HTMLCanvasElement
  fetchDataUrl(dataUrl: string): Promise<Blob>
  createImageBitmap(blob: Blob): Promise<ImageBitmap>
  createPipeline(options: { onGap?: () => void }): CapturePipeline
  createSampler(options: {
    video: HTMLVideoElement
    onFrame: (frame: unknown) => void
    onGap?: () => void
  }): CaptureSampler
  performanceNow(): number
  dateNow(): number
  createUUID(): string
}

function defaultEnvironment(): BrowserCaptureEnvironment {
  return {
    createSession: () => createObservationSession(),
    createVideo: () => document.createElement("video"),
    createCanvas: () => document.createElement("canvas"),
    fetchDataUrl: async (dataUrl) => (await fetch(dataUrl)).blob(),
    createImageBitmap: (blob) => createImageBitmap(blob),
    createPipeline: (options) => createCapturePipeline(options),
    createSampler: (options) => createStreamSampler(options),
    performanceNow: () => performance.now(),
    dateNow: () => Date.now(),
    createUUID: () => crypto.randomUUID(),
  }
}

interface Candidate {
  seq: number
  capturedAt: number
  width: number
  height: number
  dataUrl: string
}

interface EncodingJob {
  pinned: boolean
  candidate: Candidate
  generation: number
  settled: Promise<void>
  finish(): void
}

function createEncodingJob(
  candidate: Candidate,
  generation: number,
): EncodingJob {
  let finish = () => {}
  const settled = new Promise<void>((resolve) => {
    finish = resolve
  })
  return { candidate, generation, settled, finish, pinned: false }
}

function monitorTrackEnd(
  track: MediaStreamTrack | undefined,
  onEnd: () => void,
): () => boolean {
  let ended = false
  const handleEnd = () => {
    if (ended) return
    ended = true
    onEnd()
  }
  track?.addEventListener("ended", handleEnd, { once: true })
  return () => {
    if (track?.readyState === "ended") handleEnd()
    return ended
  }
}

interface CaptureIdentity {
  generation: number
  ownerChat: string
  onGap?: () => void
  onEnded?: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readCandidate(value: unknown): Candidate | null {
  if (!isRecord(value)) return null
  const { seq, capturedAt, width, height, dataUrl } = value
  if (!Number.isSafeInteger(seq) || !Number.isFinite(capturedAt)) return null
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return null
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return null
  }
  return {
    seq: seq as number,
    capturedAt: capturedAt as number,
    width: width as number,
    height: height as number,
    dataUrl,
  }
}

function candidateCapturedAt(
  candidate: Candidate,
  environment: BrowserCaptureEnvironment,
): string {
  const age = Math.max(0, environment.performanceNow() - candidate.capturedAt)
  return new Date(environment.dateNow() - age).toISOString()
}

function sourceDimensions(source: ImageBitmap): {
  width: number
  height: number
} {
  if (source.width * source.height > MAX_SOURCE_PIXELS) {
    throw new Error("The browser tab frame exceeds the source pixel limit.")
  }
  const scale = Math.min(
    1,
    MAX_EDGE / source.width,
    MAX_EDGE / source.height,
    Math.sqrt(MAX_PIXELS / (source.width * source.height)),
  )
  return {
    width: Math.max(1, Math.floor(source.width * scale)),
    height: Math.max(1, Math.floor(source.height * scale)),
  }
}

function resizeImage(
  source: ImageBitmap,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  dimensions: { width: number; height: number },
): { dataUrl: string; width: number; height: number } {
  let { width, height } = dimensions
  for (let attempt = 0; attempt < 12; attempt += 1) {
    canvas.width = width
    canvas.height = height
    context.drawImage(source, 0, 0, width, height)
    const dataUrl = canvas.toDataURL(
      "image/jpeg",
      Math.max(0.2, 0.86 - attempt * 0.1),
    )
    const withinLimit =
      dataUrl.startsWith(JPEG_PREFIX) && dataUrl.length <= MAX_IMAGE_CHARS
    if (withinLimit) return { dataUrl, width, height }
    width = Math.max(1, Math.floor(width * 0.8))
    height = Math.max(1, Math.floor(height * 0.8))
  }
  throw new Error(
    "Could not encode the browser tab frame within the size limit.",
  )
}

async function encodeCandidate(
  candidate: Candidate,
  environment: BrowserCaptureEnvironment,
): Promise<BrowserFrame> {
  const source = await environment.createImageBitmap(
    await environment.fetchDataUrl(candidate.dataUrl),
  )
  try {
    const dimensions = sourceDimensions(source)
    const canvas = environment.createCanvas()
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Could not prepare the browser tab frame.")
    const encoded = resizeImage(source, canvas, context, dimensions)
    return {
      id: environment.createUUID(),
      sequence: candidate.seq,
      captured_at: candidateCapturedAt(candidate, environment),
      width: encoded.width,
      height: encoded.height,
      image_data_url: encoded.dataUrl,
    }
  } finally {
    source.close()
  }
}

export function createBrowserReadingCapture(
  options: { environment?: Partial<BrowserCaptureEnvironment> } = {},
): BrowserCaptureSource {
  const environment = { ...defaultEnvironment(), ...options.environment }
  const nativeSession = environment.createSession()
  let generation = 0
  let video: HTMLVideoElement | null = null
  let captureStream: MediaStream | null = null
  let preview: HTMLVideoElement | null = null
  let sampler: ReturnType<typeof createStreamSampler> | null = null
  let pipeline: ReturnType<typeof createCapturePipeline> | null = null
  let onCandidate: ((frame: BrowserFrame) => boolean) | null = null
  let activeIdentity: CaptureIdentity | null = null
  let encoding = false
  let nextCandidate: EncodingJob | null = null
  let activeEncoding: EncodingJob | null = null
  let selectedSequence = 0

  function reportGap(): void {
    activeIdentity?.onGap?.()
  }

  function stop(): void {
    generation += 1
    sampler?.stop()
    pipeline?.clear({ nextGeneration: generation })
    sampler = null
    pipeline = null
    nextCandidate?.finish()
    activeEncoding?.finish()
    nextCandidate = null
    selectedSequence = 0
    onCandidate = null
    activeIdentity = null
    stopCaptureVideo(video)
    video = null
    nativeSession.stop()
    stopCaptureTracks(captureStream)
    if (preview) preview.srcObject = null
    captureStream = null
  }

  function isCurrentCallback(
    token: number,
    callback: ((frame: BrowserFrame) => boolean) | null,
  ): callback is (frame: BrowserFrame) => boolean {
    return generation === token && callback !== null && onCandidate === callback
  }

  async function encodeOne(candidate: Candidate, token: number): Promise<void> {
    const callback = onCandidate
    if (!callback) return
    try {
      const encoded = await encodeCandidate(candidate, environment)
      if (!isCurrentCallback(token, callback)) return
      if (!callback(encoded)) rejectCandidate()
    } catch {
      if (generation === token) reportGap()
    }
  }

  function rejectCandidate(): void {
    reportGap()
    nextCandidate?.finish()
    nextCandidate = null
    pipeline?.clear()
  }

  async function encodePending(token: number): Promise<void> {
    if (encoding || !nextCandidate) return
    encoding = true
    try {
      while (nextCandidate && generation === token) {
        const job = nextCandidate
        nextCandidate = null
        activeEncoding = job
        try {
          await encodeOne(job.candidate, token)
        } finally {
          job.finish()
          activeEncoding = null
        }
      }
    } finally {
      encoding = false
      if (nextCandidate) void encodePending(generation)
    }
  }

  function offerSample(frame: unknown, token: number): void {
    pipeline?.offer(frame)
    const pending = readCandidate(pipeline?.takePending())
    if (!pending) return
    replacePending(pending)
    void encodePending(token)
  }

  function replacePending(candidate: Candidate): void {
    // A question owns this waiting encode until it settles.
    if (nextCandidate?.pinned) {
      reportGap()
      pipeline?.clear()
      return
    }
    if (nextCandidate) {
      reportGap()
      nextCandidate.finish()
    }
    selectedSequence = Math.max(selectedSequence, candidate.seq)
    nextCandidate = createEncodingJob(candidate, generation)
  }

  function prepareVideo(capture: MediaStream): HTMLVideoElement {
    const currentVideo = environment.createVideo()
    currentVideo.muted = true
    currentVideo.playsInline = true
    currentVideo.srcObject = capture
    video = currentVideo
    captureStream = capture
    if (!preview) return currentVideo
    preview.srcObject = capture
    void preview.play().catch(() => {})
    return currentVideo
  }

  function monitorCaptureEnd(
    capture: MediaStream,
    token: number,
    captureIdentity: CaptureIdentity,
  ): () => boolean {
    const videoTrack = capture.getVideoTracks()[0]
    return monitorTrackEnd(videoTrack, () =>
      finishCaptureEnd(token, captureIdentity),
    )
  }

  function finishCaptureEnd(
    token: number,
    captureIdentity: CaptureIdentity,
  ): void {
    if (generation !== token) return
    captureIdentity.onEnded?.()
    if (generation === token) stop()
  }

  function startSampler(
    currentVideo: HTMLVideoElement,
    token: number,
    captureIdentity: CaptureIdentity,
  ): void {
    pipeline = environment.createPipeline({
      onGap: () => captureIdentity.onGap?.(),
    })
    sampler = environment.createSampler({
      video: currentVideo,
      onGap: () => captureIdentity.onGap?.(),
      onFrame: (frame) => offerSample(frame, token),
    })
    sampler.start(captureIdentity)
  }

  async function attach(
    capture: MediaStream,
    token: number,
    captureIdentity: CaptureIdentity,
  ): Promise<void> {
    if (generation !== token) return
    const currentVideo = prepareVideo(capture)
    const hasEnded = monitorCaptureEnd(capture, token, captureIdentity)
    if (hasEnded()) return
    await currentVideo.play()
    if (hasEnded() || generation !== token || video !== currentVideo) return
    startSampler(currentVideo, token, captureIdentity)
  }

  async function beginCapture(
    token: number,
    captureIdentity: CaptureIdentity,
  ): Promise<void> {
    try {
      const capture = await nativeSession.start()
      if (generation !== token) {
        capture.getTracks().forEach((track) => {
          track.stop()
        })
        return
      }
      await attach(capture, token, captureIdentity)
    } catch {
      if (generation !== token) return
      captureIdentity.onEnded?.()
      stop()
    }
  }

  return {
    start(callback, startIdentity) {
      if (onCandidate) return
      generation += 1
      const token = generation
      onCandidate = callback
      activeIdentity = {
        generation: startIdentity?.generation ?? token,
        ownerChat: startIdentity?.ownerChat ?? "browser-reading",
        onGap: startIdentity?.onGap,
        onEnded: startIdentity?.onEnded,
      }
      void beginCapture(token, activeIdentity)
    },
    stop,
    checkpoint() {
      const jobs = [activeEncoding, nextCandidate].filter(
        (job): job is EncodingJob =>
          job !== null && job.generation === generation,
      )
      jobs.forEach((job) => {
        job.pinned = true
      })
      return {
        sequence: selectedSequence,
        settled: Promise.all(jobs.map((job) => job.settled)).then(() => {}),
      }
    },
    attachPreview(element: HTMLVideoElement | null) {
      if (preview && preview !== element) {
        preview.pause()
        preview.srcObject = null
      }
      preview = element
      if (preview && captureStream) {
        preview.srcObject = captureStream
        void preview.play().catch(() => {})
      }
    },
  }
}

function stopCaptureVideo(video: HTMLVideoElement | null): void {
  if (!video) return
  video.pause()
  video.srcObject = null
  video.remove()
}

function stopCaptureTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    track.stop()
  })
}
