import { framesEqual } from "./admission-pixels.mjs"
import { createViewportTracker } from "./registration.mjs"

const PROBE_ANCHOR_BYTES = 256 * 1024
const MIN_SHIFT_PIXELS = 2
const MIN_CONFIDENCE = 0.45
const MIN_EDGE_QUALITY = 0.01
const MIN_RELATIVE_EDGE_QUALITY = 0.5
const QUALITY_SAMPLE_BUDGET = 65_536

const asClampedView = (pixels) =>
  pixels instanceof Uint8ClampedArray
    ? pixels
    : new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength)

export class CoherentMotionAdmission {
  constructor({ intervalMs = 1000, tracker } = {}) {
    this.intervalMs = intervalMs
    this.tracker =
      tracker ??
      createViewportTracker({
        options: {
          maxAnchors: 1,
          maxAnchorBytes: PROBE_ANCHOR_BYTES,
          minOverlapRatio: 0.8,
        },
      })
    this.reset(0)
  }

  reset(timestamp = 0) {
    this.tracker.reset()
    this.lastProbeAt = timestamp
    this.lastCaptureAt = timestamp
    this.maxAnchorBytes = 0
    this.probeAttempts = 0
    this.probeMatches = 0
    this.qualityRejected = 0
    this.rejected = 0
    this.lastDiagnostic = null
    this.recentProbes = []
  }

  markAccepted(timestamp) {
    this.lastCaptureAt = timestamp
    this.lastProbeAt = timestamp
  }

  probe({
    previousPixels,
    currentPixels,
    readablePixels,
    width,
    height,
    timestamp,
    frame,
  }) {
    if (framesEqual(previousPixels, currentPixels)) {
      return this.reject("identical-pixels")
    }
    if (timestamp - this.lastProbeAt < this.intervalMs) {
      return this.reject("probe-throttled")
    }
    this.lastProbeAt = timestamp
    this.probeAttempts += 1
    const quality = compareEdgeQuality(
      readablePixels ?? previousPixels,
      currentPixels,
      width,
      height,
    )
    if (!quality.readable) {
      this.qualityRejected += 1
      return this.reject("low-relative-contrast", quality, timestamp)
    }
    return this.compareViews({
      previousPixels,
      currentPixels,
      width,
      height,
      frame,
      timestamp,
      quality,
    })
  }

  compareViews({
    previousPixels,
    currentPixels,
    width,
    height,
    frame,
    timestamp,
    quality,
  }) {
    this.tracker.reset()
    try {
      this.tracker.observe(
        this.trackerFrame({
          pixels: previousPixels,
          width,
          height,
          frame,
          capturedAt: timestamp - 1,
        }),
      )
      const result = this.tracker.observe(
        this.trackerFrame({
          pixels: currentPixels,
          width,
          height,
          frame,
          capturedAt: timestamp,
        }),
      )
      this.maxAnchorBytes = Math.max(
        this.maxAnchorBytes,
        this.tracker.stats().anchorBytes,
      )
      const moved = Math.abs(result.shiftY ?? 0) >= MIN_SHIFT_PIXELS
      const reliable =
        result.kind === "overlap" && result.confidence >= MIN_CONFIDENCE
      if (!moved || !reliable) {
        return this.reject(
          result.reason ?? "no-reliable-overlap",
          {
            ...quality,
            kind: result.kind,
            shiftY: result.shiftY,
            confidence: result.confidence,
            trackerReason: result.reason,
          },
          timestamp,
        )
      }
      this.probeMatches += 1
      const diagnostic = {
        time: timestamp,
        kind: result.kind,
        shiftY: result.shiftY,
        confidence: result.confidence,
        reason: result.reason,
        edgeQuality: quality.current,
        referenceEdgeQuality: quality.reference,
      }
      this.recordProbe(diagnostic)
      return { qualified: true, ...diagnostic }
    } catch (error) {
      return this.reject(
        "probe-failed",
        { ...quality, message: String(error?.message ?? error) },
        timestamp,
      )
    } finally {
      this.tracker.reset()
    }
  }

  trackerFrame({ pixels, width, height, frame, capturedAt }) {
    return {
      pixels: asClampedView(pixels),
      width,
      height,
      seq: frame.seq,
      generation: frame.generation,
      ownerChat: frame.ownerChat,
      capturedAt,
    }
  }

  reject(reason, details = {}, timestamp) {
    const diagnostic = {
      time: timestamp,
      kind: "unaligned",
      confidence: 0,
      reason,
      ...details,
    }
    if (timestamp !== undefined) {
      this.rejected += 1
      this.recordProbe(diagnostic)
    }
    return { qualified: false, ...diagnostic }
  }

  recordProbe(diagnostic) {
    this.lastDiagnostic = diagnostic
    this.recentProbes.push(diagnostic)
    if (this.recentProbes.length > 16) this.recentProbes.shift()
  }

  stats() {
    return {
      probeAttempts: this.probeAttempts,
      probeMatches: this.probeMatches,
      probeRejected: this.rejected,
      qualityRejected: this.qualityRejected,
      maxProbeAnchorBytes: this.maxAnchorBytes,
      probeAnchorBytes: this.tracker.stats().anchorBytes,
      lastProbeAt: this.lastProbeAt,
      lastCaptureAt: this.lastCaptureAt,
      lastDiagnostic: this.lastDiagnostic,
      recentProbes: this.recentProbes.map((probe) => ({ ...probe })),
    }
  }
}

function compareEdgeQuality(reference, current, width, height) {
  const referenceQuality = edgeQuality(reference, width, height)
  const currentQuality = edgeQuality(current, width, height)
  const ratio = referenceQuality === 0 ? 0 : currentQuality / referenceQuality
  const readable =
    currentQuality >= MIN_EDGE_QUALITY &&
    referenceQuality >= MIN_EDGE_QUALITY &&
    ratio >= MIN_RELATIVE_EDGE_QUALITY
  return {
    readable,
    current: currentQuality,
    reference: referenceQuality,
    ratio,
  }
}

function edgeQuality(pixels, width, height) {
  const sampleStride = Math.max(
    1,
    Math.floor(Math.sqrt((width * height) / QUALITY_SAMPLE_BUDGET)),
  )
  let edges = 0
  let pairs = 0
  for (let y = 0; y < height; y += sampleStride) {
    for (let x = 0; x < width; x += sampleStride) {
      const offset = (y * width + x) * 4
      const gray = grayAt(pixels, offset)
      if (x + sampleStride < width) {
        const horizontal = grayAt(pixels, offset + sampleStride * 4)
        edges += Math.abs(gray - horizontal)
        pairs += 1
      }
      if (y + sampleStride < height) {
        const vertical = grayAt(pixels, offset + sampleStride * width * 4)
        edges += Math.abs(gray - vertical)
        pairs += 1
      }
    }
  }
  return pairs === 0 ? 0 : edges / (pairs * 255)
}

const grayAt = (pixels, offset) =>
  (pixels[offset] * 77 + pixels[offset + 1] * 150 + pixels[offset + 2] * 29) >>
  8
