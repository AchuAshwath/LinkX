export const DEFAULT_ADMISSION_OPTIONS = Object.freeze({
  sampleIntervalMs: 100,
  scrollCaptureIntervalMs: 1000,
  initialCandidate: true,
  initialSettleMs: 600,
  initialStableCoverage: 0.65,
  settleMs: 300,
  tileSize: 16,
  channelDelta: 8,
  maxMovingInformativeRatio: 0.2,
  initialMinInformativeTiles: 4,
  maxSourcePixels: 8_388_608,
  maxPending: 1,
})

export const parseCaptureTime = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string" || value.length === 0) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

const positiveDimension = (value) => Number.isSafeInteger(value) && value > 0

const validDimensions = (width, height) =>
  [width, height].every(positiveDimension)

const byteLengthFor = (width, height) => {
  if (!validDimensions(width, height)) return null
  const byteLength = width * height * 4
  return Number.isSafeInteger(byteLength) ? byteLength : null
}

export const pixelShape = (frame) => {
  const pixels = frame?.pixels
  if (!(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray))
    return null
  const fullBytes = byteLengthFor(frame.width, frame.height)
  if (fullBytes !== pixels.length) return null
  return { width: frame.width, height: frame.height, pixels }
}

const validCounter = (value) => Number.isSafeInteger(value) && value >= 0
const validOwner = (value) => typeof value === "string" && value.length > 0

export const hasValidIdentity = (frame) =>
  validCounter(frame?.seq) &&
  validCounter(frame?.generation) &&
  validOwner(frame?.ownerChat)

export const clonePixels = (pixels) => new Uint8Array(pixels)

const pixelDiffers = (left, right, offset, channelDelta) =>
  Math.abs(left[offset] - right[offset]) >= channelDelta ||
  Math.abs(left[offset + 1] - right[offset + 1]) >= channelDelta ||
  Math.abs(left[offset + 2] - right[offset + 2]) >= channelDelta

export const compareTile = ({
  accepted,
  previous,
  current,
  width,
  height,
  tileX,
  tileY,
  tileSize,
  channelDelta,
}) => {
  let differsFromAccepted = false
  let differsFromPrevious = false
  const xEnd = Math.min(width, tileX + tileSize)
  const yEnd = Math.min(height, tileY + tileSize)
  for (let y = tileY; y < yEnd; y += 1) {
    for (let x = tileX; x < xEnd; x += 1) {
      const offset = (y * width + x) * 4
      differsFromAccepted ||= pixelDiffers(
        accepted,
        current,
        offset,
        channelDelta,
      )
      differsFromPrevious ||= pixelDiffers(
        previous,
        current,
        offset,
        channelDelta,
      )
      if (differsFromAccepted && differsFromPrevious)
        return { differsFromAccepted, differsFromPrevious }
    }
  }
  return { differsFromAccepted, differsFromPrevious }
}

export const tileHasContrast = ({
  pixels,
  width,
  height,
  tileX,
  tileY,
  tileSize,
  channelDelta,
}) => {
  let minimum = 255
  let maximum = 0
  const xEnd = Math.min(width, tileX + tileSize)
  const yEnd = Math.min(height, tileY + tileSize)
  for (let y = tileY; y < yEnd; y += 1) {
    for (let x = tileX; x < xEnd; x += 1) {
      const offset = (y * width + x) * 4
      const value =
        (pixels[offset] * 77 +
          pixels[offset + 1] * 150 +
          pixels[offset + 2] * 29) >>
        8
      minimum = Math.min(minimum, value)
      maximum = Math.max(maximum, value)
      if (maximum - minimum >= channelDelta) return true
    }
  }
  return false
}

export const framesEqual = (left, right) => {
  if (!left || left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}
