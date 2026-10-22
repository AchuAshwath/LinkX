import {
  clonePixels,
  DEFAULT_ADMISSION_OPTIONS,
  framesEqual,
  hasValidIdentity,
  parseCaptureTime,
  pixelShape,
} from "./admission-pixels.mjs"
import { ViewportStability } from "./admission-stability.mjs"
import { CoherentMotionAdmission } from "./motion-admission.mjs"
import { createViewportTracker } from "./registration.mjs"

const makeGap = (frame, reason, details = {}) => ({
  seq: frame?.seq,
  generation: frame?.generation,
  ownerChat: frame?.ownerChat,
  capturedAt: frame?.capturedAt,
  reason,
  ...details,
})

const boundedNumber = (
  value,
  fallback,
  minimum,
  maximum = Number.MAX_SAFE_INTEGER,
) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.min(maximum, value))
}

const admissionSettings = (options) => ({
  ...DEFAULT_ADMISSION_OPTIONS,
  ...options,
  sampleIntervalMs: boundedNumber(
    options.sampleIntervalMs,
    DEFAULT_ADMISSION_OPTIONS.sampleIntervalMs,
    0,
  ),
  scrollCaptureIntervalMs: boundedNumber(
    options.scrollCaptureIntervalMs,
    DEFAULT_ADMISSION_OPTIONS.scrollCaptureIntervalMs,
    100,
    60_000,
  ),
  initialSettleMs: boundedNumber(
    options.initialSettleMs,
    DEFAULT_ADMISSION_OPTIONS.initialSettleMs,
    0,
  ),
  initialStableCoverage: boundedNumber(
    options.initialStableCoverage,
    DEFAULT_ADMISSION_OPTIONS.initialStableCoverage,
    0.1,
    1,
  ),
  settleMs: boundedNumber(
    options.settleMs,
    DEFAULT_ADMISSION_OPTIONS.settleMs,
    0,
  ),
  tileSize: Math.floor(
    boundedNumber(options.tileSize, DEFAULT_ADMISSION_OPTIONS.tileSize, 1, 256),
  ),
  channelDelta: Math.floor(
    boundedNumber(
      options.channelDelta,
      DEFAULT_ADMISSION_OPTIONS.channelDelta,
      1,
      255,
    ),
  ),
  maxMovingInformativeRatio: boundedNumber(
    options.maxMovingInformativeRatio,
    DEFAULT_ADMISSION_OPTIONS.maxMovingInformativeRatio,
    0,
    1,
  ),
  initialMinInformativeTiles: Math.floor(
    boundedNumber(
      options.initialMinInformativeTiles,
      DEFAULT_ADMISSION_OPTIONS.initialMinInformativeTiles,
      1,
    ),
  ),
  maxSourcePixels: Math.floor(
    boundedNumber(
      options.maxSourcePixels,
      DEFAULT_ADMISSION_OPTIONS.maxSourcePixels,
      1,
      DEFAULT_ADMISSION_OPTIONS.maxSourcePixels,
    ),
  ),
})

const hasValidFrameCounter = (counter) =>
  counter === undefined || (Number.isSafeInteger(counter) && counter >= 0)

class CapturePipeline {
  constructor({
    onCandidate,
    onGap,
    now = () => performance.now(),
    options = {},
  } = {}) {
    this.settings = admissionSettings(options)
    this.tracker =
      options.tracker ?? createViewportTracker(options.trackerOptions)
    this.stability = new ViewportStability(this.settings)
    this.motionAdmission = new CoherentMotionAdmission({
      intervalMs: this.settings.scrollCaptureIntervalMs,
      tracker: options.motionTracker,
    })
    this.onCandidate = onCandidate
    this.onGap = onGap
    this.now = now
    this.metrics = {
      offers: 0,
      accepted: 0,
      duplicates: 0,
      gaps: 0,
      stale: 0,
      malformed: 0,
      oversize: 0,
      maxPendingObserved: 0,
    }
    this.shouldCaptureInitial = this.settings.initialCandidate
    this.clearState()
  }

  clearState({ nextGeneration } = {}) {
    this.generation = nextGeneration
    this.ownerChat = undefined
    this.dimensions = undefined
    this.acceptedPixels = undefined
    this.previousPixels = undefined
    this.previousTimestamp = undefined
    this.lastCaptureAt = undefined
    this.initialStartedAt = undefined
    this.shouldCaptureInitial = this.settings.initialCandidate
    this.previousFrameCounter = undefined
    this.lastSequence = undefined
    this.pending = undefined
    this.stability.reset()
    this.tracker.reset?.()
    this.motionAdmission.reset(this.now())
  }

  api() {
    return {
      offer: (frame) => this.offer(frame),
      takePending: () => this.takePending(),
      clear: (options) => this.clear(options),
      stats: () => this.stats(),
    }
  }

  notifyGap(gap) {
    this.metrics.gaps += 1
    try {
      this.onGap?.(gap)
    } catch {
      // A diagnostics consumer cannot interrupt capture admission.
    }
    return { status: "gap", gap }
  }

  discardPending(reason) {
    if (!this.pending) return null
    const gap = makeGap(this.pending, reason)
    this.pending = undefined
    this.notifyGap(gap)
    return gap
  }

  beginBaseline(frame, shape, captureAt) {
    this.lastSequence = frame.seq
    this.generation = frame.generation
    this.ownerChat = frame.ownerChat
    this.dimensions = {
      width: shape.width,
      height: shape.height,
      fullWidth: frame.width,
      fullHeight: frame.height,
    }
    this.acceptedPixels = clonePixels(shape.pixels)
    this.previousPixels = clonePixels(shape.pixels)
    this.previousTimestamp = this.now()
    this.lastCaptureAt = captureAt
    this.initialStartedAt = this.previousTimestamp
    this.stability.reset()
    this.stability.startInitial()
    this.shouldCaptureInitial = this.settings.initialCandidate
    this.previousFrameCounter = frame.frameCounter
    this.motionAdmission.reset(this.previousTimestamp)
    return { status: "baseline" }
  }

  validate(frame) {
    if (!hasValidIdentity(frame)) return { reason: "malformed-frame" }
    if (!hasValidFrameCounter(frame.frameCounter))
      return { reason: "malformed-frame-counter" }
    const shape = pixelShape(frame)
    if (!shape) return { reason: "malformed-pixels" }
    const sourcePixels = frame.width * frame.height
    const retainedPixels = shape.width * shape.height
    if (
      Math.max(sourcePixels, retainedPixels) > this.settings.maxSourcePixels
    ) {
      return {
        reason: "oversize",
        details: { pixels: Math.max(sourcePixels, retainedPixels) },
      }
    }
    const captureAt = parseCaptureTime(frame.capturedAt)
    if (captureAt === null) return { reason: "invalid-timestamp" }
    return { shape, captureAt }
  }

  sameDimensions(shape, frame) {
    return (
      this.dimensions?.width === shape.width &&
      this.dimensions?.height === shape.height &&
      this.dimensions?.fullWidth === frame.width &&
      this.dimensions?.fullHeight === frame.height
    )
  }

  classifyBaselineChange(frame, shape, captureAt) {
    if (this.generation !== undefined && frame.generation < this.generation) {
      this.metrics.stale += 1
      return { status: "stale" }
    }
    if (!this.previousPixels) return this.beginBaseline(frame, shape, captureAt)
    const reason = this.baselineChangeReason(frame, shape)
    if (!reason) return null
    this.notifyGap(makeGap(frame, reason))
    this.discardPending("pending-source-reset")
    const nextGeneration =
      reason === "generation-changed" ? frame.generation : this.generation
    this.clearState({ nextGeneration })
    return this.beginBaseline(frame, shape, captureAt)
  }

  baselineChangeReason(frame, shape) {
    if (frame.ownerChat !== this.ownerChat) return "owner-changed"
    if (frame.generation !== this.generation) return "generation-changed"
    return this.sameDimensions(shape, frame) ? null : "dimensions-changed"
  }

  timestampDecision(frame, captureAt) {
    if (this.lastCaptureAt !== undefined && captureAt < this.lastCaptureAt) {
      return this.notifyGap(
        makeGap(frame, "backwards-timestamp", {
          previousCapturedAt: this.lastCaptureAt,
        }),
      )
    }
    const interval =
      this.lastCaptureAt === undefined
        ? Infinity
        : captureAt - this.lastCaptureAt
    if (interval < this.settings.sampleIntervalMs)
      return { status: "throttled", intervalMs: interval }
    this.lastCaptureAt = captureAt
    const timestamp = this.now()
    if (!Number.isFinite(timestamp))
      return this.notifyGap(makeGap(frame, "invalid-clock"))
    return { timestamp, intervalMs: interval }
  }

  encodeCandidate(frame) {
    let dataUrl
    try {
      dataUrl =
        typeof frame.getDataUrl === "function"
          ? frame.getDataUrl()
          : frame.dataUrl
    } catch (error) {
      return { error }
    }
    const validImage =
      typeof dataUrl === "string" &&
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)
    if (!validImage) return { error: new Error("invalid image encoding") }
    return {
      candidate: {
        seq: frame.seq,
        generation: frame.generation,
        ownerChat: frame.ownerChat,
        capturedAt: frame.capturedAt,
        dataUrl,
        width: frame.width,
        height: frame.height,
      },
    }
  }

  emitCandidate(frame, shape, status, motion) {
    const encoded = this.encodeCandidate(frame)
    if (encoded.error) return this.encodingGap(frame, encoded.error)
    const candidate = this.annotateCandidate(
      encoded.candidate,
      frame,
      shape,
      motion,
    )
    const dropped = this.queueCandidate(candidate)
    this.recordAcceptedCandidate(shape, status, motion)
    this.publishCandidate(frame, candidate)
    return this.candidateResult(status, candidate, dropped)
  }

  encodingGap(frame, error) {
    return this.notifyGap(
      makeGap(frame, "encoding-failed", {
        message: String(error.message ?? error),
      }),
    )
  }

  annotateCandidate(candidate, frame, shape, motion) {
    if (motion) {
      candidate.admission = "coherent-scroll"
      candidate.motion = motion
    }
    candidate.observation = this.observeTracker(frame, shape)
    return candidate
  }

  queueCandidate(candidate) {
    const dropped = this.pending
    this.pending = candidate
    if (dropped) this.notifyGap(makeGap(dropped, "pending-replaced"))
    return dropped
  }

  recordAcceptedCandidate(shape, status, motion) {
    this.acceptedPixels = clonePixels(shape.pixels)
    this.previousPixels = clonePixels(shape.pixels)
    this.previousTimestamp = this.now()
    this.motionAdmission.markAccepted(this.previousTimestamp)
    this.stability.resetChanges()
    this.metrics.accepted += 1
    if (status === "accepted-initial" || motion)
      this.shouldCaptureInitial = false
    this.metrics.maxPendingObserved = Math.max(
      this.metrics.maxPendingObserved,
      1,
    )
  }

  publishCandidate(frame, candidate) {
    try {
      this.onCandidate?.(candidate)
    } catch (error) {
      this.notifyGap(
        makeGap(frame, "candidate-callback-failed", {
          message: String(error?.message ?? error),
        }),
      )
    }
  }

  candidateResult(status, candidate, dropped) {
    return {
      status: dropped ? "pending-replaced" : status,
      candidate,
      ...(dropped ? { replacedSeq: dropped.seq } : {}),
    }
  }

  observeTracker(frame, shape) {
    try {
      return this.tracker.observe({
        pixels:
          shape.pixels instanceof Uint8ClampedArray
            ? shape.pixels
            : Uint8ClampedArray.from(shape.pixels),
        width: shape.width,
        height: shape.height,
        seq: frame.seq,
        generation: frame.generation,
        ownerChat: frame.ownerChat,
        capturedAt: frame.capturedAt,
      })
    } catch (error) {
      return {
        kind: "unaligned",
        shiftY: null,
        confidence: 0,
        newRegions: [],
        reason: `tracker-error: ${error?.message ?? error}`,
        segment: null,
      }
    }
  }

  offer(frame) {
    this.metrics.offers += 1
    const validated = this.validate(frame)
    if (validated.reason) return this.rejectFrame(frame, validated)
    if (this.isStaleSequence(frame)) {
      this.metrics.stale += 1
      return { status: "stale", reason: "non-increasing-sequence" }
    }
    const { shape, captureAt } = validated
    const baseline = this.classifyBaselineChange(frame, shape, captureAt)
    if (baseline) return baseline
    this.lastSequence = frame.seq
    if (
      frame.frameCounter !== undefined &&
      frame.frameCounter === this.previousFrameCounter
    ) {
      return { status: "stalled", frameCounter: frame.frameCounter }
    }
    this.previousFrameCounter = frame.frameCounter
    const timing = this.timestampDecision(frame, captureAt)
    if (timing.status) return timing
    return this.evaluateFrame(frame, shape, timing)
  }

  isStaleSequence(frame) {
    const sameOwner = frame.ownerChat === this.ownerChat
    const sameGeneration = frame.generation === this.generation
    return sameOwner && sameGeneration && frame.seq <= this.lastSequence
  }

  rejectFrame(frame, validated) {
    if (validated.reason.startsWith("malformed")) this.metrics.malformed += 1
    if (validated.reason === "oversize") this.metrics.oversize += 1
    return this.notifyGap(makeGap(frame, validated.reason, validated.details))
  }

  evaluateFrame(frame, shape, timing) {
    if (this.shouldCaptureInitial)
      return this.evaluateInitial(frame, shape, timing)
    if (framesEqual(this.acceptedPixels, shape.pixels))
      return this.suppressDuplicate(shape, timing)
    const previousPixels = this.previousPixels
    const result = this.stability.scanChanged({
      shape,
      timestamp: timing.timestamp,
      acceptedPixels: this.acceptedPixels,
      previousPixels: this.previousPixels,
    })
    this.previousPixels = clonePixels(shape.pixels)
    this.previousTimestamp = timing.timestamp
    if (!result.persistentChange) {
      const motion = this.tryCoherentMotion(
        frame,
        shape,
        timing,
        previousPixels,
      )
      if (motion)
        return this.emitCandidate(frame, shape, "accepted-motion", motion)
      return this.observingResult(timing, result)
    }
    return this.emitCandidate(frame, shape, "accepted")
  }

  evaluateInitial(frame, shape, timing) {
    const previousPixels = this.previousPixels
    const ready = this.stability.updateInitial({
      shape,
      timestamp: timing.timestamp,
      initialStartedAt: this.initialStartedAt,
      previousPixels: this.previousPixels,
    })
    this.previousPixels = clonePixels(shape.pixels)
    this.previousTimestamp = timing.timestamp
    if (!ready) {
      const elapsed = timing.timestamp - this.initialStartedAt
      if (elapsed >= this.settings.initialSettleMs) {
        const motion = this.tryCoherentMotion(
          frame,
          shape,
          timing,
          previousPixels,
        )
        if (motion) {
          return this.emitCandidate(frame, shape, "accepted-motion", motion)
        }
      }
      return {
        status: "observing",
        intervalMs: timing.intervalMs,
        phase: "initial-settle",
      }
    }
    return this.emitCandidate(frame, shape, "accepted-initial")
  }

  suppressDuplicate(shape, timing) {
    this.metrics.duplicates += 1
    this.previousPixels = clonePixels(shape.pixels)
    this.previousTimestamp = timing.timestamp
    this.stability.resetChanges()
    return { status: "duplicate", intervalMs: timing.intervalMs }
  }

  takePending() {
    const candidate = this.pending
    this.pending = undefined
    return candidate
  }

  clear({ nextGeneration } = {}) {
    const gap = this.discardPending("pending-cleared")
    this.clearState({ nextGeneration })
    return gap ? { gap } : { status: "cleared" }
  }

  stats() {
    return {
      ...this.metrics,
      pending: this.pending ? 1 : 0,
      retainedPixelBytes:
        (this.acceptedPixels?.byteLength ?? 0) +
        (this.previousPixels?.byteLength ?? 0),
      tracker: this.tracker.stats?.() ?? {},
      motion: this.motionAdmission.stats(),
    }
  }

  observingResult(timing, result) {
    return {
      status: "observing",
      intervalMs: timing.intervalMs,
      movingTiles: result.movingTiles,
      movingInformativeRatio: result.movingInformativeRatio,
    }
  }

  tryCoherentMotion(frame, shape, timing, previousPixels) {
    const result = this.motionAdmission.probe({
      previousPixels,
      currentPixels: shape.pixels,
      readablePixels: this.acceptedPixels,
      width: shape.width,
      height: shape.height,
      timestamp: timing.timestamp,
      frame,
    })
    return result.qualified ? result : null
  }
}

export function createCapturePipeline(options = {}) {
  return new CapturePipeline(options).api()
}
