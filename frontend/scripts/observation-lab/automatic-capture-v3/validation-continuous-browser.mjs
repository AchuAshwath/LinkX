import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { chromium } from "@playwright/test"

const output =
  process.env.CAPTURE_CONTINUOUS_OUTPUT ||
  "/tmp/linkx-capture-v3-continuous-browser"
const browser = await chromium.launch({ channel: "chrome", headless: true })
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
})
await context.route("**/@vite/client", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "export const injectQuery = (url) => url; export const createHotContext = () => ({accept(){},dispose(){},on(){},invalidate(){},prune(){},data:{}}); export const updateStyle = () => {}; export const removeStyle = () => {};",
  }),
)
const source = await context.newPage()
const observer = await context.newPage()
const result = {
  status: "running",
  modelCalls: 0,
  sourceTelemetryPassedToPipeline: false,
  samples: [],
  errors: [],
}
source.on("pageerror", (error) => result.errors.push(error.message))
observer.on("pageerror", (error) => result.errors.push(error.message))

try {
  await initialize()
  for (let index = 0; index < 8; index += 1) await sample("initial")
  for (let index = 0; index < 52; index += 1) {
    await source.evaluate(() => scrollBy(0, 45))
    await sample("continuous")
  }
  for (let index = 0; index < 5; index += 1) await sample("final-pause")
  await finish()
  result.status = "passed"
} catch (error) {
  result.status = "failed"
  result.error = error.stack || error.message
} finally {
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(`${output}/result.json`, JSON.stringify(result, null, 2))
  await browser.close()
  console.log(
    JSON.stringify({
      status: result.status,
      metrics: result.metrics,
      error: result.error,
      output,
    }),
  )
  if (result.status !== "passed") process.exitCode = 1
}

async function initialize() {
  const fixture =
    "http://127.0.0.1:4000/scripts/observation-lab/automatic-capture-v3/validation-fixture.html"
  await source.goto(fixture)
  await source.evaluate(() => {
    document.querySelector(".furniture-animation").style.animation = "none"
  })
  await observer.goto("http://127.0.0.1:4000/browser-context-lab.html")
  await observer.evaluate(async () => {
    const { createCapturePipeline } = await import(
      "/scripts/observation-lab/automatic-capture-v3/pipeline.mjs"
    )
    const state = { at: 0, seq: 0, captures: [], gaps: [] }
    const pipeline = createCapturePipeline({
      now: () => state.at,
      onCandidate: ({ dataUrl, ...metadata }) => {
        state.captures.push(metadata)
      },
      onGap: (gap) => {
        state.gaps.push(gap)
      },
    })
    window.continuousTest = {
      state,
      pipeline,
      canvas: document.createElement("canvas"),
    }
  })
}

async function sample(phase) {
  const before = await source.evaluate(() => scrollY)
  const png = await source.screenshot({ type: "png" })
  const after = await source.evaluate(() => scrollY)
  assert.equal(before, after, "Test source moved during screenshot acquisition")
  const value = await observer.evaluate(async (base64) => {
    const { state, pipeline, canvas } = window.continuousTest
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    ctx.drawImage(image, 0, 0)
    state.at += 250
    const started = performance.now()
    const decision = pipeline.offer({
      seq: ++state.seq,
      generation: 1,
      ownerChat: "continuous-browser",
      capturedAt: state.at,
      width: image.width,
      height: image.height,
      pixels: ctx.getImageData(0, 0, image.width, image.height).data,
      getDataUrl: () => canvas.toDataURL("image/png"),
    })
    pipeline.takePending()
    return {
      seq: state.seq,
      status: decision.status,
      elapsedMs: performance.now() - started,
    }
  }, png.toString("base64"))
  result.samples.push({ ...value, phase, y: after, height: 900 })
}

async function finish() {
  const state = await observer.evaluate(() => {
    const { pipeline, state } = window.continuousTest
    const stats = pipeline.stats()
    pipeline.clear({ nextGeneration: 2 })
    return { ...state, stats, cleared: pipeline.stats() }
  })
  result.capture = state
  const samples = new Map(result.samples.map((item) => [item.seq, item]))
  const moving = state.captures.filter(
    (capture) => samples.get(capture.seq).phase === "continuous",
  )
  const intervals = state.captures.map((capture) => {
    const sample = samples.get(capture.seq)
    return [sample.y, sample.y + sample.height]
  })
  const extent = result.samples.at(-1).y + 900
  result.metrics = {
    continuousCandidates: moving.length,
    coherentCandidates: moving.filter(
      (capture) => capture.admission === "coherent-scroll",
    ).length,
    visibleIntervalCoverage: unionLength(intervals) / extent,
    scrollDistance: result.samples.at(-1).y,
    viewportHeightsTraversed: result.samples.at(-1).y / 900,
    errors: result.errors,
  }
  assert.ok(
    moving.length >= 5,
    "Readable intermediate views were lost during continuous scrolling",
  )
  assert.ok(
    result.metrics.visibleIntervalCoverage >= 0.95,
    "Accepted images do not cover the continuous reading path",
  )
  assert.equal(state.cleared.retainedPixelBytes, 0)
  assert.equal(state.cleared.tracker.anchorBytes, 0)
  assert.equal(result.errors.length, 0)
}

function unionLength(intervals) {
  let end = 0
  let length = 0
  for (const [start, nextEnd] of intervals.sort((a, b) => a[0] - b[0])) {
    length += Math.max(0, nextEnd - Math.max(end, start))
    end = Math.max(end, nextEnd)
  }
  return length
}
