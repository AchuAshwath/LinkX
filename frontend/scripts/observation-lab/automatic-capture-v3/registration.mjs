const DEFAULTS = {
  maxAnchors: 3,
  maxAnchorBytes: 12 * 1024 * 1024,
  sampleWidth: 128,
  sampleHeight: 4096,
  coarseHeight: 90,
  inkThreshold: 244,
  featureDelta: 42,
  maxMismatch: 0.16,
  maxZoneMismatch: 0.32,
  minMovingEvidenceRatio: 0.6,
  maxSamePositionMismatch: 0.04,
  minEvidencePerBand: 12,
  minEvidencePerZone: 12,
  minOverlapRatio: 0.35,
  ambiguityMargin: 0.025,
}

const MAX_FRAME_PIXELS = 8 * 1024 * 1024

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const validateFrame = (frame) => {
  if (!frame || !(frame.pixels instanceof Uint8ClampedArray))
    throw new TypeError("frame.pixels must be Uint8ClampedArray")
  validateDimensions(frame)
  if (frame.width * frame.height > MAX_FRAME_PIXELS)
    throw new RangeError("frame dimensions exceed the supported pixel budget")
  if (frame.pixels.length !== frame.width * frame.height * 4)
    throw new TypeError("frame pixel length does not match dimensions")
}

const validateDimensions = ({ width, height }) => {
  if (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0
  )
    return
  throw new TypeError("frame dimensions must be positive integers")
}

const validateOptionNames = (options) => {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new TypeError("options must be an object")
  const invalidKey = Object.keys(options).find(
    (key) => !Object.hasOwn(DEFAULTS, key),
  )
  if (invalidKey)
    throw new RangeError(`unsupported registration option: ${invalidKey}`)
}

const validateIntegerOptions = (settings) => {
  const bounds = [
    ["maxAnchors", 1, 3],
    ["maxAnchorBytes", 1, 24 * 1024 * 1024],
    ["sampleWidth", 16, 256],
    ["sampleHeight", 16, 4096],
    ["coarseHeight", 32, 240],
    ["featureDelta", 0, 255],
    ["minEvidencePerBand", 1, 100_000],
    ["minEvidencePerZone", 1, 100_000],
  ]
  for (const [key, min, max] of bounds) {
    const valid =
      Number.isSafeInteger(settings[key]) &&
      settings[key] >= min &&
      settings[key] <= max
    if (!valid) {
      throw new RangeError(
        `${key} must be an integer from ${min} through ${max}`,
      )
    }
  }
}

const validateRatioOptions = (settings) => {
  const bounds = [
    ["inkThreshold", 0, 255],
    ["maxMismatch", 0, 1],
    ["maxZoneMismatch", 0, 1],
    ["minMovingEvidenceRatio", 0, 1],
    ["maxSamePositionMismatch", 0, 1],
    ["minOverlapRatio", 0.2, 0.9],
    ["ambiguityMargin", 0, 1],
  ]
  for (const [key, min, max] of bounds) {
    const valid =
      Number.isFinite(settings[key]) &&
      settings[key] >= min &&
      settings[key] <= max
    if (!valid) {
      throw new RangeError(`${key} must be between ${min} and ${max}`)
    }
  }
}

const normalizeOptions = (options) => {
  validateOptionNames(options)
  const settings = { ...DEFAULTS, ...options }
  validateIntegerOptions(settings)
  validateRatioOptions(settings)
  return settings
}

const pixelGray = (pixels, offset) =>
  (pixels[offset] * 77 + pixels[offset + 1] * 150 + pixels[offset + 2] * 29) >>
  8

const frameFingerprint = ({ pixels, width, height }) => {
  let hash = 2166136261
  for (let y = 0; y < height; y += 8) {
    for (let x = 0; x < width; x += 8) {
      const gray = pixelGray(pixels, (y * width + x) * 4)
      hash = Math.imul(hash ^ gray, 16777619)
    }
  }
  return hash >>> 0
}

const sampleFrame = (frame, settings) => {
  // Keep native rows through 4K; taller frames use integer row groups and may
  // be conservatively unaligned when a small shift falls between those rows.
  const maxFeatureHeight = Math.min(
    settings.sampleHeight,
    frame.height,
    settings.maxAnchorBytes,
  )
  const verticalScale = Math.max(1, Math.ceil(frame.height / maxFeatureHeight))
  const height = Math.ceil(frame.height / verticalScale)
  const width = Math.min(
    settings.sampleWidth,
    frame.width,
    Math.max(1, Math.floor(settings.maxAnchorBytes / height)),
  )
  const minimums = new Uint8Array(width * height).fill(255)
  const maximums = new Uint8Array(width * height)
  const source = frame.pixels
  for (let y = 0; y < frame.height; y += 1) {
    const gridY = Math.floor(y / verticalScale)
    for (let x = 0; x < frame.width; x += 1) {
      const gridX = Math.min(width - 1, Math.floor((x * width) / frame.width))
      const index = gridY * width + gridX
      const gray = pixelGray(source, (y * frame.width + x) * 4)
      if (gray < minimums[index]) minimums[index] = gray
      if (gray > maximums[index]) maximums[index] = gray
    }
  }
  const values = minimums.map(
    (minimum, index) => 255 - (maximums[index] - minimum),
  )
  return {
    width,
    height,
    values,
    sourceHeight: frame.height,
    verticalScale,
    fingerprint: frameFingerprint(frame),
  }
}

const compareFeatures = (
  left,
  right,
  { shift, settings, step = 1, xStart = 0, xEnd = left.width },
) => {
  const overlap = Math.min(left.height, right.height) - Math.abs(shift)
  const evidenceByBand = [0, 0, 0]
  const changesByBand = [0, 0, 0]
  let evidence = 0
  let changed = 0
  const first = Math.max(0, xStart)
  const last = Math.min(left.width, xEnd)
  for (let y = 0; y < overlap; y += step) {
    const leftY = shift > 0 ? y + shift : y
    const rightY = shift < 0 ? y - shift : y
    const band = Math.min(2, Math.floor((y * 3) / overlap))
    const leftRow = leftY * left.width
    const rightRow = rightY * right.width
    for (let x = first; x < last; x += 1) {
      const leftValue = left.values[leftRow + x]
      const rightValue = right.values[rightRow + x]
      const leftInk = leftValue < settings.inkThreshold
      const rightInk = rightValue < settings.inkThreshold
      if (!leftInk && !rightInk) continue
      evidence += 1
      evidenceByBand[band] += 1
      if (
        leftInk !== rightInk ||
        Math.abs(leftValue - rightValue) >= settings.featureDelta
      ) {
        changed += 1
        changesByBand[band] += 1
      }
    }
  }
  return makeComparison({
    evidence,
    changed,
    evidenceByBand,
    changesByBand,
    overlap,
  })
}

const makeComparison = ({
  evidence,
  changed,
  evidenceByBand,
  changesByBand,
  overlap,
}) => ({
  score: evidence ? changed / evidence : 1,
  evidence,
  changed,
  overlap,
  bandScores: evidenceByBand.map((count, index) =>
    count ? changesByBand[index] / count : null,
  ),
  bandEvidence: evidenceByBand,
  bandChanges: changesByBand,
})

const fullPixelEqual = (left, right) => {
  if (!left || !right) return false
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1)
    if (left[index] !== right[index]) return false
  return true
}

const exactAnchor = (anchors, frame, feature) =>
  anchors.find(
    (anchor) =>
      anchor.frame.generation === frame.generation &&
      anchor.frame.ownerChat === frame.ownerChat &&
      anchor.frame.width === frame.width &&
      anchor.frame.height === frame.height &&
      anchor.feature.fingerprint === feature.fingerprint &&
      fullPixelEqual(anchor.pixels, frame.pixels),
  )

const frameMetadata = (frame) => {
  return {
    seq: frame.seq,
    generation: frame.generation,
    ownerChat: frame.ownerChat,
    capturedAt: frame.capturedAt,
    width: frame.width,
    height: frame.height,
  }
}

const enoughBands = (comparison, minimum, maxMismatch) =>
  comparison.bandEvidence.every(
    (count, index) =>
      count >= minimum &&
      comparison.bandScores[index] !== null &&
      comparison.bandScores[index] <= maxMismatch,
  )

const enoughMovingBands = (comparison, minimum) =>
  comparison.bandEvidence.filter(
    (count, index) =>
      count >= minimum &&
      comparison.bandScores[index] !== null &&
      comparison.bandScores[index] <= 0.4,
  ).length >= 2

const isSamePositionRevision = (comparison, settings) =>
  comparison.score <= settings.maxSamePositionMismatch &&
  enoughBands(
    comparison,
    settings.minEvidencePerBand,
    Math.max(settings.maxSamePositionMismatch * 2, 0.08),
  )

const distinctCoarseCandidates = (comparisons, step, maxCount = 4) => {
  const zero = comparisons.find((candidate) => candidate.shift === 0)
  const selected = zero ? [zero] : []
  for (const candidate of comparisons.sort(
    (left, right) => left.score - right.score,
  )) {
    if (
      selected.every(
        (item) => Math.abs(item.shift - candidate.shift) > step * 2,
      )
    )
      selected.push(candidate)
    if (selected.length >= maxCount) break
  }
  const localRange = Math.min(36, step * 8)
  const localStep = step <= 2 ? step : Math.max(step, 18)
  for (let shift = -localRange; shift <= localRange; shift += localStep) {
    if (selected.every((candidate) => candidate.shift !== shift))
      selected.push({ shift, score: 1, evidence: 0 })
  }
  return selected
}

const coarseCandidates = (left, right, settings, counters) => {
  const sampleHeight = Math.min(left.height, right.height)
  const comparisonStep =
    sampleHeight <= 240 ? 1 : Math.ceil(sampleHeight / settings.coarseHeight)
  const shiftStep =
    sampleHeight > 900 && sampleHeight <= 1800
      ? 2
      : sampleHeight > 1800
        ? Math.ceil(sampleHeight / 180)
        : comparisonStep
  const maxShift = Math.floor(
    Math.min(left.height, right.height) * (1 - settings.minOverlapRatio),
  )
  const candidates = []
  for (
    let shift = -Math.floor(maxShift / shiftStep) * shiftStep;
    shift <= maxShift;
    shift += shiftStep
  ) {
    const comparison = compareFeatures(left, right, {
      shift,
      settings,
      step: comparisonStep,
    })
    counters.comparisons += 1
    if (comparison.evidence >= settings.minEvidencePerBand * 3)
      candidates.push({ ...comparison, shift })
  }
  return {
    step: shiftStep,
    maxShift,
    candidates: distinctCoarseCandidates(candidates, shiftStep),
  }
}

const compareMovingZones = (left, right, { shift, settings, step = 1 }) => {
  const zoneSize = Math.max(1, Math.floor(left.width / 16))
  const active = []
  for (let start = 0; start < left.width; start += zoneSize) {
    const comparison = compareFeatures(left, right, {
      shift,
      settings,
      step,
      xStart: start,
      xEnd: start + zoneSize,
    })
    if (comparison.evidence < settings.minEvidencePerZone) continue
    active.push(comparison)
  }
  const allEvidence = active.reduce((sum, zone) => sum + zone.evidence, 0)
  const moving = active.filter((zone) => zone.score <= settings.maxZoneMismatch)
  const movingEvidence = moving.reduce((sum, zone) => sum + zone.evidence, 0)
  if (!allEvidence) return null
  const evidenceRatio = movingEvidence / allEvidence
  const zoneRatio = moving.length / active.length
  // The quorum balances evidence mass with independent spatial support so
  // dense fixed furniture cannot outweigh agreement across moving content.
  const supportRatio = Math.sqrt(evidenceRatio * zoneRatio)
  if (supportRatio < settings.minMovingEvidenceRatio) return null
  return combineComparisons(
    moving,
    movingEvidence,
    Math.min(left.height, right.height) - Math.abs(shift),
  )
}

const combineComparisons = (comparisons, evidence, height) => {
  const changed = comparisons.reduce((sum, item) => sum + item.changed, 0)
  const bandEvidence = [0, 0, 0]
  const bandChanges = [0, 0, 0]
  for (const comparison of comparisons) {
    for (let index = 0; index < 3; index += 1) {
      bandEvidence[index] += comparison.bandEvidence[index]
      bandChanges[index] += comparison.bandChanges[index]
    }
  }
  return makeComparison({
    evidence,
    changed,
    evidenceByBand: bandEvidence,
    changesByBand: bandChanges,
    overlap: height,
  })
}

const refineCandidates = (left, right, { settings, coarse, counters }) => {
  const candidates = []
  const seen = new Set()
  for (const center of coarse.candidates) {
    const first = Math.max(-coarse.maxShift, center.shift - coarse.step)
    const last = Math.min(coarse.maxShift, center.shift + coarse.step)
    for (let shift = first; shift <= last; shift += 1) {
      if (shift === 0 || seen.has(shift)) continue
      seen.add(shift)
      const comparison = compareMovingZones(left, right, { shift, settings })
      counters.comparisons += 1
      if (!comparison || comparison.evidence < settings.minEvidencePerBand * 3)
        continue
      if (comparison.score > settings.maxMismatch) continue
      if (!enoughMovingBands(comparison, settings.minEvidencePerBand)) continue
      candidates.push({ ...comparison, shift })
    }
  }
  candidates.sort((first, second) => first.score - second.score)
  return candidates
}

const findOverlap = (left, right, settings, counters) => {
  const coarse = coarseCandidates(left, right, settings, counters)
  const candidates = refineCandidates(left, right, {
    settings,
    coarse,
    counters,
  })
  if (!candidates.length) return { status: "none" }
  const best = candidates[0]
  const second = candidates.find(
    (candidate) =>
      Math.abs(candidate.shift - best.shift) > Math.max(2, coarse.step / 2),
  )
  if (second && second.score - best.score < settings.ambiguityMargin)
    return { status: "ambiguous" }
  const margin = second ? clamp((second.score - best.score) / 0.2, 0, 1) : 0.6
  const bandScores = best.bandScores
    .filter((score) => score !== null)
    .sort((first, second) => first - second)
  const medianBand = bandScores[Math.floor(bandScores.length / 2)]
  const matchQuality = 1 - best.score / settings.maxMismatch
  const bandAgreement = 1 - medianBand
  const confidence = clamp(
    0.45 + margin * 0.3 + matchQuality * 0.15 + bandAgreement * 0.1,
    0,
    1,
  )
  return { status: "match", shift: best.shift, confidence, score: best.score }
}

const regionForShift = (shiftY, width, height) => {
  const amount = clamp(Math.abs(shiftY), 1, height)
  return shiftY > 0
    ? [{ x: 0, y: height - amount, width, height: amount }]
    : [{ x: 0, y: 0, width, height: amount }]
}

const sameDimensions = (left, right) =>
  left.width === right.width && left.height === right.height

class ViewportTracker {
  constructor(settings) {
    this.settings = settings
    this.anchors = []
    this.counters = {
      observations: 0,
      comparisons: 0,
      anchorBytes: 0,
      elapsedMs: 0,
      maxElapsedMs: 0,
    }
    this.segment = 0
    this.previous = null
    this.lifecycle = null
  }

  observe(frame) {
    validateFrame(frame)
    const started = performance.now()
    this.counters.observations += 1
    const feature = sampleFrame(frame, this.settings)
    const anchor = this.findExact(frame, feature)
    const decision = this.classify({ frame, feature, exact: anchor })
    if (decision.kind === "unaligned") this.startSegment()
    if (decision.kind !== "revisit") this.previous = this.retain(frame, feature)
    this.lifecycle = {
      generation: frame.generation,
      ownerChat: frame.ownerChat,
    }
    this.recordTime(started)
    decision.segment = this.segment
    return decision
  }

  classify({ frame, feature, exact }) {
    if (!this.previous) {
      this.segment = Math.max(1, this.segment)
      return this.makeResult("initial", {
        confidence: 1,
        reason: "first-frame",
      })
    }
    const lifecycleReason = this.lifecycleReason(frame)
    if (lifecycleReason)
      return this.makeResult("unaligned", { reason: lifecycleReason })
    if (!sameDimensions(this.previous.frame, frame))
      return this.makeResult("unaligned", { reason: "dimensions-changed" })
    if (exact) {
      this.previous = exact
      return this.makeResult("revisit", {
        shiftY: null,
        confidence: 0,
        visualEquality: true,
        matchedSequence: exact.frame.seq,
        reason: "identical-pixels-position-unknown",
      })
    }
    return this.compareViews(frame, feature)
  }

  compareViews(frame, feature) {
    this.counters.comparisons += 1
    const same = compareFeatures(this.previous.feature, feature, {
      shift: 0,
      settings: this.settings,
    })
    const revision = isSamePositionRevision(same, this.settings)
    const overlap = findOverlap(
      this.previous.feature,
      feature,
      this.settings,
      this.counters,
    )
    if (overlap.status === "match") {
      const shiftY = overlap.shift * feature.verticalScale
      return this.makeResult("overlap", {
        shiftY,
        confidence: overlap.confidence,
        newRegions: regionForShift(shiftY, frame.width, frame.height),
        reason: "verified-relative-overlap",
      })
    }
    if (revision)
      return this.makeResult("revision", {
        shiftY: 0,
        confidence: clamp(
          1 -
            same.score / Math.max(this.settings.maxSamePositionMismatch, 0.001),
          0.5,
          1,
        ),
        reason: "same-position-content-change",
      })
    return this.makeResult("unaligned", {
      reason:
        overlap.status === "ambiguous"
          ? "ambiguous-overlap"
          : "no-confident-overlap",
    })
  }

  lifecycleReason(frame) {
    if (this.lifecycle.generation !== frame.generation)
      return "generation-changed"
    if (this.lifecycle.ownerChat !== frame.ownerChat) return "owner-changed"
    return null
  }

  findExact(frame, feature) {
    return exactAnchor(this.anchors, frame, feature)
  }

  retain(frame, feature) {
    const featureBytes = feature.values.byteLength
    while (
      this.anchors.length >= this.settings.maxAnchors ||
      this.counters.anchorBytes + featureBytes > this.settings.maxAnchorBytes
    ) {
      this.removeOldest()
    }
    const anchor = { frame: frameMetadata(frame), pixels: null, feature }
    this.anchors.push(anchor)
    this.counters.anchorBytes += featureBytes
    if (
      frame.pixels.byteLength <=
      this.settings.maxAnchorBytes - this.counters.anchorBytes
    ) {
      anchor.pixels = Uint8ClampedArray.from(frame.pixels)
      this.counters.anchorBytes += anchor.pixels.byteLength
    }
    return anchor
  }

  removeOldest() {
    const removed = this.anchors.shift()
    if (removed)
      this.counters.anchorBytes -=
        removed.feature.values.byteLength + (removed.pixels?.byteLength ?? 0)
  }

  startSegment() {
    this.clearAnchors()
    this.segment += 1
  }

  clearAnchors() {
    this.anchors.length = 0
    this.counters.anchorBytes = 0
    this.previous = null
  }

  makeResult(kind, details = {}) {
    return {
      kind,
      shiftY: null,
      confidence: 0,
      newRegions: [],
      reason: "unspecified",
      segment: this.segment,
      ...details,
    }
  }

  recordTime(started) {
    const elapsed = performance.now() - started
    this.counters.elapsedMs += elapsed
    this.counters.maxElapsedMs = Math.max(this.counters.maxElapsedMs, elapsed)
  }

  reset() {
    this.clearAnchors()
    this.segment = 0
    this.lifecycle = null
  }

  stats() {
    return {
      observations: this.counters.observations,
      comparisons: this.counters.comparisons,
      anchorCount: this.anchors.length,
      anchorBytes: this.counters.anchorBytes,
      elapsedMs: this.counters.elapsedMs,
      maxElapsedMs: this.counters.maxElapsedMs,
      segment: this.segment,
    }
  }
}

export function createViewportTracker({ options = {} } = {}) {
  return new ViewportTracker(normalizeOptions(options))
}
