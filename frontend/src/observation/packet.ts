export interface ObservationPacket {
  session_id: string
  source_epoch: number
  revision: number
  captured_at: string
  delivered_at: string
  frame_presented_at_ms: number | null
  width: number
  height: number
  image_data_url: string
}

export interface ObservationPacketMetadata {
  session_id: string
  source_epoch: number
  revision: number
  frame_presented_at_ms: number | null
}

const MAX_EDGE = 2048
const MAX_PIXELS = 4_194_304
const MAX_DATA_URL_CHARS = 2_000_000
const JPEG_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/

function getBoundedSize(width: number, height: number) {
  const scale = Math.min(
    1,
    MAX_EDGE / width,
    MAX_EDGE / height,
    Math.sqrt(MAX_PIXELS / (width * height)),
  )
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  }
}

function isBoundedJpegDataUrl(value: string): boolean {
  if (value.length > MAX_DATA_URL_CHARS) return false
  const match = JPEG_DATA_URL.exec(value)
  return Boolean(
    match && (match[0].length - "data:image/jpeg;base64,".length) % 4 === 0,
  )
}

function isCurrentVideoFrame(video: HTMLVideoElement): boolean {
  return (
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    Number.isFinite(video.videoWidth) &&
    Number.isFinite(video.videoHeight) &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  )
}

function encodeJpegWithinLimit(
  video: HTMLVideoElement,
  initialWidth: number,
  initialHeight: number,
) {
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Could not prepare the browser tab frame.")

  let width = initialWidth
  let height = initialHeight
  let quality = 0.86
  for (let attempt = 0; attempt < 12; attempt += 1) {
    canvas.width = width
    canvas.height = height
    let imageDataUrl = ""
    try {
      context.drawImage(video, 0, 0, width, height)
      imageDataUrl = canvas.toDataURL("image/jpeg", quality)
    } catch {
      throw new Error(
        "Could not encode the browser tab frame within the size limit.",
      )
    }
    if (isBoundedJpegDataUrl(imageDataUrl)) {
      return { width, height, imageDataUrl }
    }
    width = Math.max(1, Math.floor(width * 0.8))
    height = Math.max(1, Math.floor(height * 0.8))
    quality = Math.max(0.2, quality - 0.1)
  }
  throw new Error(
    "Could not encode the browser tab frame within the size limit.",
  )
}

export function encodeCurrentView(
  video: HTMLVideoElement,
  metadata: ObservationPacketMetadata,
): Readonly<ObservationPacket> {
  if (!isCurrentVideoFrame(video)) {
    throw new Error("The selected browser tab has no current frame to capture.")
  }

  const size = getBoundedSize(video.videoWidth, video.videoHeight)
  const capturedAt = new Date().toISOString()
  const encoded = encodeJpegWithinLimit(video, size.width, size.height)
  const deliveredAt = new Date().toISOString()
  return Object.freeze({
    ...metadata,
    captured_at: capturedAt,
    delivered_at: deliveredAt,
    width: encoded.width,
    height: encoded.height,
    image_data_url: encoded.imageDataUrl,
  })
}
