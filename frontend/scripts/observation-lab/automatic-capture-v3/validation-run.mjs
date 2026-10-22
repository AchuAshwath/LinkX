import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "@playwright/test"

const origin = process.env.CAPTURE_V3_ORIGIN || "http://127.0.0.1:4000"
const output =
  process.env.CAPTURE_V3_OUTPUT || "/tmp/linkx-capture-v3-validation"
const saveSampleImages = process.env.CAPTURE_V3_SAVE_SAMPLE_IMAGES === "1"
const fixtureUrl = `${origin}/scripts/observation-lab/automatic-capture-v3/validation-fixture.html`
const pipelineUrl = "/scripts/observation-lab/automatic-capture-v3/pipeline.mjs"
const maxSamples = Number(process.env.CAPTURE_V3_MAX_SAMPLES || 500)
let previousTruth = null
let revisionEpisode = 0

const browser = await chromium.launch({ channel: "chrome", headless: true })
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
})
const source = await context.newPage()
const observer = await context.newPage()
const viteClientStub = `export function injectQuery(url) { return url }
export function createHotContext() { return { accept() {}, dispose() {}, on() {}, invalidate() {}, prune() {}, data: {} } }
export function updateStyle() {}
export function removeStyle() {}`
await Promise.all(
  [source, observer].map((page) =>
    page.route("**/@vite/client", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: viteClientStub,
      }),
    ),
  ),
)
const result = {
  schemaVersion: 1,
  status: "running",
  fixture: fixtureUrl,
  pipeline: pipelineUrl,
  modelCalls: 0,
  sourceTelemetryPassedToPipeline: false,
  samples: [],
  failures: [],
  browserErrors: [],
}
const sourceImagesBySeq = new Map()
for (const page of [source, observer]) {
  page.on("pageerror", (error) =>
    result.browserErrors.push(
      `${page === source ? "source" : "observer"}: ${error.message}`,
    ),
  )
  page.on("console", (message) => {
    if (message.type() === "error")
      result.browserErrors.push(
        `${page === source ? "source" : "observer"} console: ${message.text()}`,
      )
  })
}

try {
  await source.goto(fixtureUrl, { waitUntil: "networkidle" })
  await source.waitForFunction(
    () => typeof window.__validationGroundTruth === "function",
  )
  await source.evaluate(() => window.__validationControl.startAnimation())
  await observer.goto(fixtureUrl)
  await observer.evaluate(async (url) => {
    const { createCapturePipeline } = await import(url)
    const state = {
      candidates: [],
      gaps: [],
      samples: [],
      seq: 0,
      generation: 1,
      phase: "animated-initial",
    }
    const pipeline = createCapturePipeline({
      onCandidate(candidate) {
        const { dataUrl, ...metadata } = candidate
        state.candidates.push({ ...metadata, phase: state.phase })
      },
      onGap(gap) {
        state.gaps.push({ ...gap, phase: state.phase })
      },
      options: {},
    })
    pipeline.clear({ nextGeneration: 1 })
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d", { willReadFrequently: true })
    const measureTextRatio = (pixels, width, height) => {
      let darkPixels = 0
      let cropPixels = 0
      const left = Math.floor(width * 0.18)
      const right = Math.floor(width * 0.88)
      const bottom = Math.min(height, 450)
      for (let y = 75; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const pixel = (y * width + x) * 4
          const luminance =
            (pixels[pixel] * 77 +
              pixels[pixel + 1] * 150 +
              pixels[pixel + 2] * 29) >>
            8
          cropPixels += 1
          if (luminance < 95) darkPixels += 1
        }
      }
      return cropPixels ? darkPixels / cropPixels : 0
    }
    const offerRgbaFrame = ({ label, rgba, width, height, textRatio }) => {
      const seq = ++state.seq
      const gapCountBefore = state.gaps.length
      const started = performance.now()
      const frame = {
        seq,
        generation: state.generation,
        ownerChat: "validation-controlled-page",
        capturedAt: Date.now(),
        width,
        height,
        thumbnailWidth: width,
        thumbnailHeight: height,
        pixels: rgba,
        getDataUrl: () => canvas.toDataURL("image/png"),
      }
      const decision = pipeline.offer(frame)
      const pending = pipeline.takePending()
      const observation =
        decision?.observation ?? decision?.candidate?.observation ?? null
      const safeDecision = {
        status: decision?.status ?? null,
        observation,
        phase: decision?.phase ?? null,
      }
      const elapsedMs = performance.now() - started
      state.samples.push({
        label,
        seq,
        status: safeDecision.status,
        elapsedMs,
        pending: Boolean(pending),
        phase: state.phase,
      })
      return {
        seq,
        decision: safeDecision,
        observation,
        elapsedMs,
        pending: Boolean(pending),
        gapCount: state.gaps.length - gapCountBefore,
        phase: state.phase,
        imageWidth: width,
        imageHeight: height,
        textCropDarkPixelRatio: textRatio,
      }
    }
    window.__captureV3 = {
      pipeline,
      state,
      canvas,
      context,
      async offerPng({ base64, label }) {
        const image = new Image()
        image.src = `data:image/png;base64,${base64}`
        await image.decode()
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        context.drawImage(image, 0, 0)
        const rgba = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data
        const textRatio = measureTextRatio(rgba, canvas.width, canvas.height)
        return offerRgbaFrame({
          label,
          rgba,
          width: canvas.width,
          height: canvas.height,
          textRatio,
        })
      },
    }
  }, pipelineUrl)

  for (let index = 0; index < 7; index += 1) {
    if (index) await source.waitForTimeout(250)
    await sample(`animated-initial-${index + 1}`)
  }
  result.initialAnimation = await observer.evaluate(() => {
    const candidates = window.__captureV3.state.candidates.filter(
      (candidate) => candidate.phase === "animated-initial",
    )
    return {
      emittedCandidate: candidates.length > 0,
      candidateCount: candidates.length,
    }
  })
  if (!result.initialAnimation.emittedCandidate)
    result.failures.push(
      "Initial capture was not admitted while independent furniture animation was active",
    )
  result.clearBetweenPhases = await observer.evaluate(() => {
    const { pipeline, state } = window.__captureV3
    const cleared = pipeline.clear({ nextGeneration: 2 })
    state.phase = "main"
    state.generation = 2
    return { cleared, stats: pipeline.stats() }
  })
  await source.evaluate(() => {
    document.querySelector(".furniture-animation").style.animationPlayState =
      "paused"
  })
  const initTruth = await truth(source)
  result.initialViewport = initTruth.viewport
  await sample("initial")
  await sampleFor("initial-settle", 700)
  await runProfile("slow", 9, 110, 750)
  await runProfile("tight", 12, 38, 500)
  await runFastBurst(6, 1350)
  await runProfile("reverse", 10, -185, 500)
  await source.evaluate(() => scrollTo(0, 0))
  await sampleFor("return-pause", 1000)
  await sampleFor("pause", 1100)
  await controlledRevision("digit-revision", () =>
    window.__validationControl.setDigit("45"),
  )
  await controlledRevision("single-letter-revision", () =>
    window.__validationControl.setLetter("n"),
  )
  await controlledRevision("negation-revision", () =>
    window.__validationControl.setNegation(true),
  )
  await source.evaluate(() => window.__validationControl.showReflow())
  await source.waitForTimeout(250)
  await sample("layout-reflow")
  await sampleFor("layout-reflow-settle", 500)
  await source.evaluate(() => {
    document.body.style.zoom = "1.1"
  })
  await source.waitForTimeout(250)
  await sample("zoom")
  await source.evaluate(() => {
    document.body.style.zoom = "1"
    scrollTo(0, 0)
  })
  await source.waitForTimeout(200)
  result.fullTraverse = await slowFullTraverse()

  result.capture = await observer.evaluate(() => {
    const { pipeline, state } = window.__captureV3
    const statsBeforeClear = pipeline.stats()
    pipeline.clear({ nextGeneration: state.generation + 1 })
    return {
      candidates: state.candidates,
      gaps: state.gaps,
      samples: state.samples,
      statsBeforeClear,
      statsAfterClear: pipeline.stats(),
    }
  })
  result.metrics = evaluateMetrics(result)
  if (saveSampleImages)
    await saveCandidatePairImages(result, sourceImagesBySeq, output)
  applyGates(result)
  result.status = result.failures.length ? "fail" : "measured"
} catch (error) {
  result.status = "defer"
  result.error = error.stack || error.message
} finally {
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(
    path.join(output, "result.json"),
    JSON.stringify(result, null, 2),
  )
  await context.close()
  await browser.close()
  console.log(
    JSON.stringify(
      {
        status: result.status,
        samples: result.samples.length,
        candidates: result.capture?.candidates.length,
        failures: result.failures,
        output,
      },
      null,
      2,
    ),
  )
}

async function truth(page) {
  return page.evaluate(() => window.__validationGroundTruth())
}

async function sample(label) {
  ensureSampleCapacity()
  const captured = await captureRenderedViewport()
  const offer = await offerScreenshot(captured.png, label)
  retainFixtureImage(offer, captured.png)
  recordSourceCaptureProof(offer, captured.truth)
  appendTruthSample(label, offer, captured.truth, captured.captureRace)
  return captured.truth
}

function ensureSampleCapacity() {
  if (result.samples.length >= maxSamples)
    throw new Error(`Sample limit exceeded (${maxSamples})`)
}

async function captureRenderedViewport() {
  const capturedTruth = await truth(source)
  const png = await source.screenshot({ type: "png", animations: "allow" })
  const afterScreenshot = await truth(source)
  return {
    truth: capturedTruth,
    png,
    captureRace: truthChangedDuringScreenshot(capturedTruth, afterScreenshot),
  }
}

async function offerScreenshot(png, label) {
  return observer.evaluate((input) => window.__captureV3.offerPng(input), {
    base64: png.toString("base64"),
    label,
  })
}

function retainFixtureImage(offer, png) {
  const retain = saveSampleImages && offer.phase === "main" && offer.pending
  if (retain && sourceImagesBySeq.size < 12)
    sourceImagesBySeq.set(offer.seq, png)
}

function recordSourceCaptureProof(offer, truthSnapshot) {
  if (result.sourceCaptureProof) return
  const viewport = truthSnapshot.viewport
  const textLength = truthSnapshot.regions
    .filter((region) => region.visible)
    .reduce((total, region) => total + region.text.length, 0)
  result.sourceCaptureProof = {
    screenshotDimensions: {
      width: offer.imageWidth,
      height: offer.imageHeight,
    },
    viewportDimensions: { width: viewport.width, height: viewport.height },
    decodedScreenshotHasDarkTextRatio: offer.textCropDarkPixelRatio,
    visibleSourceTextCharactersFromTestTelemetry: textLength,
    passed:
      offer.imageWidth === viewport.width &&
      offer.imageHeight === viewport.height &&
      offer.textCropDarkPixelRatio > 0.001 &&
      textLength > 100,
  }
}

function appendTruthSample(label, offer, truthSnapshot, captureRace) {
  const expected = classifyTruth(previousTruth, truthSnapshot)
  if (expected.revisionChanged) revisionEpisode += 1
  expected.revisionEpisode = revisionEpisode
  expected.controlledRevision = expected.revisionChanged
  expected.zoom = label === "zoom"
  expected.reflow = label === "layout-reflow"
  previousTruth = truthSnapshot
  result.samples.push({
    label,
    ...offer,
    truth: truthSnapshot,
    expected,
    captureRace,
    capturedAt: Date.now(),
  })
}

async function runProfile(name, steps, distance, dwellMs) {
  for (let step = 0; step < steps; step += 1) {
    await source.evaluate((amount) => scrollBy(0, amount), distance)
    await sample(`${name}-${step + 1}`)
    await sampleFor(`${name}-${step + 1}-dwell`, dwellMs)
  }
  await sampleFor(`${name}-pause`, 750)
}

async function runFastBurst(steps, distance) {
  await source.evaluate(
    ({ steps, distance }) => scrollBy(0, steps * distance),
    { steps, distance },
  )
  await sample("fast-burst")
  await sampleFor("fast-settle", 750)
}

async function controlledRevision(label, change) {
  await source.evaluate(change)
  await source.waitForTimeout(250)
  await sample(label)
  for (let index = 1; index <= 3; index += 1) {
    await source.waitForTimeout(250)
    await sample(`${label}-settled-${index}`)
  }
}

async function sampleFor(label, durationMs) {
  let elapsed = 0
  let index = 0
  while (elapsed < durationMs) {
    const interval = Math.min(250, durationMs - elapsed)
    await source.waitForTimeout(interval)
    elapsed += interval
    await sample(`${label}-${++index}`)
  }
}

async function saveCandidatePairImages(measurement, screenshots, directory) {
  const candidates = measurement.capture.candidates.filter(
    (candidate) => candidate.phase === "main",
  )
  for (let index = 1; index < candidates.length; index += 1) {
    const before = candidates[index - 1]
    const after = candidates[index]
    const priorSample = measurement.samples.find(
      (sample) => sample.seq === before.seq,
    )
    const currentSample = measurement.samples.find(
      (sample) => sample.seq === after.seq,
    )
    const shift =
      currentSample.truth.viewport.scrollY - priorSample.truth.viewport.scrollY
    const height = currentSample.truth.viewport.height
    if (Math.abs(shift) === 0 || Math.abs(shift) >= height * 0.65) continue
    if (!screenshots.has(before.seq) || !screenshots.has(after.seq)) continue
    const firstPath = path.join(
      directory,
      `accepted-pair-${before.seq}-${after.seq}-before.png`,
    )
    const secondPath = path.join(
      directory,
      `accepted-pair-${before.seq}-${after.seq}-after.png`,
    )
    await fs.writeFile(firstPath, screenshots.get(before.seq))
    await fs.writeFile(secondPath, screenshots.get(after.seq))
    measurement.sampleImages = {
      maxFiles: 2,
      files: [firstPath, secondPath],
      acceptedSeqs: [before.seq, after.seq],
    }
    return
  }
  measurement.sampleImages = {
    maxFiles: 2,
    files: [],
    reason: "No eligible accepted overlap pair had both screenshots retained",
  }
}

async function slowFullTraverse() {
  const dimensions = await source.evaluate(() => ({
    height: innerHeight,
    total: document.documentElement.scrollHeight,
  }))
  const step = Math.round(dimensions.height * 0.6)
  let count = 0
  while (count < 100) {
    const position = await source.evaluate(() => ({
      y: scrollY,
      height: innerHeight,
      total: document.documentElement.scrollHeight,
    }))
    if (position.y + position.height >= position.total - 2) break
    count += 1
    await source.evaluate(
      (distance) =>
        scrollTo(
          0,
          Math.min(document.documentElement.scrollHeight, scrollY + distance),
        ),
      step,
    )
    await sampleFor(`long-${count}`, 1000)
  }
  const last = await source.evaluate(() => ({
    y: scrollY,
    height: innerHeight,
    total: document.documentElement.scrollHeight,
  }))
  const reachedBottom = last.y + last.height >= last.total - 2
  return {
    stepPx: step,
    dwellMs: 1000,
    cadenceMs: 250,
    maxSteps: 100,
    steps: count,
    reachedBottom,
    finalScrollY: last.y,
    documentHeight: last.total,
  }
}

function evaluateMetrics(measurement) {
  const candidates = measurement.capture.candidates.filter(
    (candidate) => candidate.phase === "main",
  )
  attachAcceptedObservations(measurement, candidates)
  const observations = candidates
    .map((candidate) => candidate.observation)
    .filter(Boolean)
  const acceptedPairs = buildAcceptedPairs(measurement, candidates)
  const coverage = calculateCoverage(measurement, candidates)
  return {
    ...pairMetrics(acceptedPairs),
    ...revisionMetrics(measurement),
    ...samplingMetrics(measurement),
    ...gapMetrics(measurement, acceptedPairs),
    candidateCoverageOfObservedArticleRegions: coverage.observedArticleCoverage,
    uniqueObservedSourceArticleRegions: coverage.observedArticleCount,
    uniqueObservedArticleRegionsWithCandidate:
      coverage.observedArticleCandidateCount,
    fullTraverse: coverage.fullTraverse,
    peakRssBytes: process.memoryUsage().rss,
    pipelineStats: measurement.capture.statsBeforeClear,
    clearStats: measurement.capture.statsAfterClear,
    profiles: [
      ...new Set(
        measurement.samples.map((sample) => sample.label.split("-")[0]),
      ),
    ],
    observationKinds: countObservationKinds(observations),
  }
}

function pairMetrics(pairs) {
  const disjointJoins = pairs.filter(
    (pair) =>
      pair.disjoint &&
      ["overlap", "revision", "revisit"].includes(
        pair.candidate.observation?.kind,
      ),
  )
  const eligible = pairs.filter((pair) => pair.overlapEligible)
  const correct = eligible.filter(
    (pair) =>
      pair.candidate.observation?.kind === "overlap" && pair.shiftErrorPx <= 8,
  ).length
  return {
    acceptedCandidatePairs: pairs.length,
    eligibleOverlappingAcceptedPairs: eligible.length,
    correctOverlapLinks: correct,
    usefulLinkRate: eligible.length ? correct / eligible.length : 0,
    falseConfidentOverlapJoins: disjointJoins.length,
    disjointPairsWithUnalignedObservation: pairs
      .filter(
        (pair) =>
          pair.disjoint && pair.candidate.observation?.kind === "unaligned",
      )
      .map((pair) => pair.seq),
  }
}

function revisionMetrics(measurement) {
  const episodes = [
    ...new Set(
      measurement.samples
        .filter((sample) => sample.expected.controlledRevision)
        .map((sample) => sample.expected.revisionEpisode),
    ),
  ]
  const matched = episodes.filter((episode) =>
    measurement.samples.some(
      (sample) =>
        sample.expected.revisionEpisode === episode &&
        sample.observation?.kind === "revision",
    ),
  )
  const missed = episodes.filter((episode) => !matched.includes(episode))
  return {
    controlledRevisionRecall: episodes.length
      ? matched.length / episodes.length
      : null,
    controlledRevisionEpisodes: episodes.length,
    falseRevisionDiscards: missed,
  }
}

function samplingMetrics(measurement) {
  const profiled = measurement.samples.filter(
    (sample) =>
      sample.phase === "main" &&
      /^(slow|tight|fast|reverse|long)-/.test(sample.label),
  )
  const mainSeqs = new Set(
    measurement.samples
      .filter((sample) => sample.phase === "main")
      .map((sample) => sample.seq),
  )
  const elapsed = measurement.capture.samples
    .filter((sample) => mainSeqs.has(sample.seq))
    .map((sample) => sample.elapsedMs)
    .sort((first, second) => first - second)
  const p95 = elapsed.length
    ? elapsed[Math.ceil(elapsed.length * 0.95) - 1]
    : null
  return {
    offeredFrames: profiled.length,
    sampleHandlingP95Ms: p95,
    sourceTelemetryRaceFrames: measurement.samples.filter(
      (sample) => sample.captureRace,
    ).length,
  }
}

function gapMetrics(measurement, acceptedPairs) {
  const skippedSamples = measurement.samples.filter(
    (sample) => sample.expected.skippedRegions.length,
  )
  const count = measurement.capture.gaps.length
  const audit = buildSourceGapAudit(measurement, acceptedPairs, skippedSamples)
  return {
    gaps: count,
    skippedSourceRegions: skippedSamples.flatMap((sample) =>
      sample.expected.skippedRegions.map((id) => ({
        sample: sample.label,
        region: id,
        callbackGapAtThisOffer: sample.gapCount > 0,
        observationKindAtThisOffer: sample.offeredObservation?.kind ?? null,
      })),
    ),
    sourceGapAudit: { ...audit, explicitOnGapCallbackCount: count },
  }
}

function countObservationKinds(observations) {
  const counts = {}
  for (const observation of observations) {
    counts[observation.kind] = (counts[observation.kind] || 0) + 1
  }
  return counts
}

function attachAcceptedObservations(measurement, candidates) {
  const candidateBySeq = new Map(
    candidates.map((candidate) => [candidate.seq, candidate]),
  )
  for (const sample of measurement.samples) {
    sample.offeredObservation = sample.observation
    sample.observation = candidateBySeq.get(sample.seq)?.observation ?? null
  }
}

function buildAcceptedPairs(measurement, candidates) {
  return candidates.slice(1).map((candidate, index) => {
    const previous = candidates[index]
    const before = measurement.samples.find(
      (sample) => sample.seq === previous.seq,
    )
    const current = measurement.samples.find(
      (sample) => sample.seq === candidate.seq,
    )
    const shiftY =
      current.truth.viewport.scrollY - before.truth.viewport.scrollY
    const viewportHeight = current.truth.viewport.height
    const pairRace = before.captureRace || current.captureRace
    return {
      seq: candidate.seq,
      previousSeq: previous.seq,
      candidate,
      shiftY,
      disjoint: Math.abs(shiftY) >= viewportHeight,
      overlapEligible:
        Math.abs(shiftY) > 0 &&
        Math.abs(shiftY) < viewportHeight * 0.65 &&
        !current.expected.dimensionsChanged &&
        !pairRace,
      shiftErrorPx: Number.isFinite(candidate.observation?.shiftY)
        ? Math.abs(candidate.observation.shiftY - shiftY)
        : null,
    }
  })
}

function calculateCoverage(measurement, candidates) {
  const candidateSeqs = new Set(candidates.map((candidate) => candidate.seq))
  const longSamples = measurement.samples.filter((sample) =>
    sample.label.startsWith("long-"),
  )
  const sourceMarkers = markerIds(longSamples)
  const candidateMarkers = markerIds(
    longSamples.filter((sample) => candidateSeqs.has(sample.seq)),
  )
  const regions = new Set(
    measurement.samples.flatMap((sample) =>
      eligibleRegions(sample).map((region) => region.id),
    ),
  )
  const candidateRegions = new Set(
    measurement.samples
      .filter((sample) => candidateSeqs.has(sample.seq))
      .flatMap((sample) => eligibleRegions(sample).map((region) => region.id)),
  )
  const observedArticleCoverage = regions.size
    ? [...candidateRegions].filter((id) => regions.has(id)).length /
      regions.size
    : 1
  const sourceCoverage = sourceMarkers.size / 48
  const candidateCoverage =
    [...candidateMarkers].filter((id) => sourceMarkers.has(id)).length / 48
  return {
    observedArticleCoverage,
    observedArticleCount: regions.size,
    observedArticleCandidateCount: [...candidateRegions].filter((id) =>
      regions.has(id),
    ).length,
    fullTraverse: {
      reachedBottom: Boolean(measurement.fullTraverse?.reachedBottom),
      sourceMarkerCount: sourceMarkers.size,
      sourceMarkerCoverage: sourceCoverage,
      candidateMarkerCount: [...candidateMarkers].filter((id) =>
        sourceMarkers.has(id),
      ).length,
      candidateMarkerCoverage: candidateCoverage,
      expectedMarkerCount: 48,
      candidateVerticalCoverage: verticalIntervalCoverage(
        longSamples.filter((sample) => candidateSeqs.has(sample.seq)),
      ),
    },
  }
}

function eligibleRegions(sample) {
  return sample.truth.regions.filter(
    (region) =>
      region.id.startsWith("region-") && region.visibleFraction >= 0.25,
  )
}

function markerIds(samples) {
  return new Set(
    samples.flatMap((sample) =>
      eligibleRegions(sample).map((region) => region.id),
    ),
  )
}

function verticalIntervalCoverage(samples) {
  if (!samples.length) return 0
  const documentHeight = Math.max(
    ...samples.map((sample) => sample.truth.viewport.documentHeight),
  )
  const intervals = samples
    .map((sample) => {
      const top = sample.truth.viewport.scrollY + 56
      const bottom = Math.min(
        sample.truth.viewport.scrollY + sample.truth.viewport.height,
        documentHeight,
      )
      return [Math.max(0, top), Math.max(top, bottom)]
    })
    .sort((first, second) => first[0] - second[0])
  let covered = 0
  let [start, end] = intervals[0]
  for (const [nextStart, nextEnd] of intervals.slice(1)) {
    if (nextStart <= end) end = Math.max(end, nextEnd)
    else {
      covered += end - start
      ;[start, end] = [nextStart, nextEnd]
    }
  }
  return documentHeight ? (covered + end - start) / documentHeight : 0
}

function buildSourceGapAudit(measurement, acceptedPairs, skippedSamples) {
  const acceptedPairsAcrossSkippedContent = acceptedPairs
    .map((pair) => {
      const skipped = measurement.samples.filter(
        (sample) =>
          sample.seq > pair.previousSeq &&
          sample.seq <= pair.seq &&
          sample.expected.skippedRegions.length > 0,
      )
      if (!skipped.length) return null
      const regionIds = [
        ...new Set(skipped.flatMap((sample) => sample.expected.skippedRegions)),
      ]
      const gapEvents = measurement.capture.gaps.filter(
        (gap) => gap.seq > pair.previousSeq && gap.seq <= pair.seq,
      )
      return {
        previousAcceptedSeq: pair.previousSeq,
        acceptedSeq: pair.seq,
        testOnlySkippedRegionIds: regionIds,
        observationKind: pair.candidate.observation?.kind ?? null,
        observationReason: pair.candidate.observation?.reason ?? null,
        explicitGapCallbackCount: gapEvents.length,
      }
    })
    .filter(Boolean)
  return {
    testOnlySkippedRegionTransitions: skippedSamples.length,
    distinctTestOnlySkippedRegionIds: [
      ...new Set(
        skippedSamples.flatMap((sample) => sample.expected.skippedRegions),
      ),
    ],
    acceptedPairsAcrossSkippedContent,
  }
}

function applyGates(measurement) {
  const metrics = measurement.metrics
  const fail = (condition, message) => {
    if (condition) measurement.failures.push(message)
  }
  fail(
    !measurement.sourceCaptureProof?.passed,
    "Rendered viewport screenshot did not match fixture dimensions or contain detectable text pixels",
  )
  fail(
    measurement.browserErrors.length > 0,
    "Browser page or console errors occurred during the capture run",
  )
  fail(
    metrics.falseConfidentOverlapJoins > 0,
    "A disjoint source viewport was confidently joined to the prior view",
  )
  fail(
    metrics.controlledRevisionRecall !== 1,
    "At least one controlled 44→45, single-letter, or negation revision was discarded or misclassified",
  )
  fail(
    metrics.eligibleOverlappingAcceptedPairs === 0,
    "No eligible overlapping accepted pairs were observed, so useful-link rate cannot be established",
  )
  fail(
    metrics.usefulLinkRate <= 0,
    "No eligible accepted pair had a correctly estimated shift; reject-all behavior cannot pass",
  )
  fail(
    !metrics.fullTraverse.reachedBottom,
    "Slow full traverse did not reach the document bottom",
  )
  fail(
    metrics.fullTraverse.sourceMarkerCount !==
      metrics.fullTraverse.expectedMarkerCount,
    "Slow full traverse did not expose all 48 article markers to the source sampler",
  )
  fail(
    metrics.fullTraverse.candidateMarkerCoverage < 0.95,
    "Fewer than 95% of article markers visible for at least 25% of their area received a candidate during slow full traverse",
  )
  fail(
    metrics.fullTraverse.reachedBottom &&
      metrics.fullTraverse.candidateMarkerCount !==
        metrics.fullTraverse.expectedMarkerCount,
    "Full-bottom traverse did not produce candidates covering all 48 article markers",
  )
  const stats = metrics.pipelineStats ?? {}
  const trackerStats = stats.tracker ?? stats.registration ?? stats
  if (typeof trackerStats.anchorCount === "number")
    fail(trackerStats.anchorCount > 3, "Pipeline retained more than 3 anchors")
  if (typeof trackerStats.anchorBytes === "number")
    fail(
      trackerStats.anchorBytes > 12 * 1024 * 1024,
      "Pipeline retained more than 12 MiB of anchors",
    )
  fail(
    metrics.sampleHandlingP95Ms > 100,
    "Pipeline offer plus takePending p95 exceeded 100 ms",
  )
  const cleared = metrics.clearStats ?? {}
  const clearedTracker = cleared.tracker ?? {}
  fail(
    cleared.retainedPixelBytes > 0 ||
      cleared.pending > 0 ||
      clearedTracker.anchorCount > 0 ||
      clearedTracker.anchorBytes > 0,
    "Pipeline clear left source pixel buffers, pending candidates, or anchors retained",
  )
}

function classifyTruth(previous, current) {
  const nowVisible = visibleRegionIds(current)
  if (!previous) return initialTruth(nowVisible)
  const beforeVisible = visibleRegionIds(previous)
  const shift = viewportShift(previous, current)
  return {
    initial: false,
    novelRegions: [...nowVisible].filter((id) => !beforeVisible.has(id)),
    skippedRegions: skippedRegionIds(current, beforeVisible, nowVisible, shift),
    disjoint: shift.disjoint,
    verticalDelta: shift.delta,
    dimensionsChanged:
      previous.viewport.width !== current.viewport.width ||
      previous.viewport.height !== current.viewport.height,
    reflowChanged: previous.reflow !== current.reflow,
    zoomChanged:
      previous.viewport.dpr !== current.viewport.dpr ||
      Math.abs(
        current.viewport.documentHeight / previous.viewport.documentHeight - 1,
      ) > 0.02,
    revisionChanged: hasRevision(previous, current),
  }
}

function visibleRegionIds(truth) {
  return new Set(
    truth.regions.filter((region) => region.visible).map((region) => region.id),
  )
}

function initialTruth(visible) {
  return {
    initial: true,
    novelRegions: [...visible],
    disjoint: false,
    skippedRegions: [],
  }
}

function viewportShift(previous, current) {
  const beforeBottom = previous.viewport.scrollY + previous.viewport.height
  const currentBottom = current.viewport.scrollY + current.viewport.height
  const delta = current.viewport.scrollY - previous.viewport.scrollY
  return {
    oldTop: previous.viewport.scrollY,
    oldBottom: beforeBottom,
    newTop: current.viewport.scrollY,
    newBottom: currentBottom,
    delta,
    disjoint:
      current.viewport.scrollY >= beforeBottom ||
      previous.viewport.scrollY >= currentBottom,
  }
}

function skippedRegionIds(current, beforeVisible, nowVisible, shift) {
  return current.regions
    .filter((region) => {
      if (beforeVisible.has(region.id) || nowVisible.has(region.id))
        return false
      return regionBetweenViewports(region, shift)
    })
    .map((region) => region.id)
}

function regionBetweenViewports(region, shift) {
  if (shift.newTop > shift.oldBottom) {
    return region.top >= shift.oldBottom && region.bottom <= shift.newTop
  }
  return (
    shift.oldTop > shift.newBottom &&
    region.top >= shift.newBottom &&
    region.bottom <= shift.oldTop
  )
}

function hasRevision(previous, current) {
  return (
    previous.digit !== current.digit ||
    previous.letter !== current.letter ||
    previous.negation !== current.negation
  )
}

function truthChangedDuringScreenshot(before, after) {
  return (
    before.viewport.scrollY !== after.viewport.scrollY ||
    before.viewport.width !== after.viewport.width ||
    before.viewport.height !== after.viewport.height ||
    before.viewport.documentHeight !== after.viewport.documentHeight ||
    before.digit !== after.digit ||
    before.letter !== after.letter ||
    before.negation !== after.negation ||
    before.reflow !== after.reflow
  )
}
