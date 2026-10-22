import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { chromium } from "@playwright/test"

const origin = "http://127.0.0.1:4000"
const output =
  process.env.CAPTURE_NATIVE_OUTPUT || "/tmp/linkx-capture-v3-native"
const selectedArticle = process.argv
  .find((argument) => argument.startsWith("--article="))
  ?.split("=")[1]
const articles = process.argv.includes("--blogs")
  ? [
      { id: "web-dev", url: "https://web.dev/articles/rendering-on-the-web" },
      {
        id: "chrome",
        url: "https://developer.chrome.com/blog/inside-browser-part3",
      },
      {
        id: "willison",
        url: "https://simonwillison.net/2025/Mar/11/using-llms-for-code/",
      },
    ]
  : [
      {
        id: "controlled",
        url: `${origin}/scripts/observation-lab/automatic-capture-v3/validation-fixture.html`,
      },
    ]
async function run(article) {
  const title = `LinkXNativeCaptureV3-${article.id}`
  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: [
      "--window-size=1440,1000",
      `--auto-select-tab-capture-source-by-title=${title}`,
    ],
  })
  const session = new NativeCaptureRun(article, browser, title)
  try {
    await session.runCapture()
  } catch (error) {
    session.result.status = "failed"
    session.result.error = error.stack || error.message
    session.result.failureSnapshot = await session.observer
      ?.evaluate(() => window.captureLab?.snapshot())
      .catch(() => null)
  } finally {
    await session.closeAndWrite()
  }
}

class NativeCaptureRun {
  constructor(article, browser, title) {
    this.article = article
    this.browser = browser
    this.title = title
    this.result = {
      ...article,
      modelCalls: 0,
      status: "running",
      actions: [],
      errors: [],
    }
  }

  async runCapture() {
    await this.preparePages()
    await this.checkSource()
    if (process.argv.includes("--continuous-only")) {
      await this.captureContinuous()
    } else {
      await this.captureScrollProfiles()
      await this.captureControlledEdits()
      await this.captureLongTraverse()
    }
    await this.stopAndValidate()
  }

  async captureContinuous() {
    await this.observer.evaluate(() => {
      if (window.nativeFrameDebug) window.nativeFrameDebug.enabled = true
    })
    const before = await this.observer.evaluate(() =>
      window.captureLab.snapshot(),
    )
    const startY = await this.source.evaluate(() => scrollY)
    for (let index = 0; index < 120; index += 1) {
      await this.source.mouse.wheel(0, 20)
      await this.source.waitForTimeout(80)
      await this.record("continuous")
    }
    const during = await this.observer.evaluate(() =>
      window.captureLab.snapshot(),
    )
    const events = during.events.filter(
      (event) =>
        event.type === "capture" &&
        event.capturedAt > before.events.at(-1)?.capturedAt,
    )
    this.result.continuous = {
      admittedDuringMotion: during.acceptedCount - before.acceptedCount,
      coherentCandidates: events.filter(
        (event) => event.admission === "coherent-scroll",
      ).length,
      distance: (await this.source.evaluate(() => scrollY)) - startY,
      ...continuousCaptureProgress({
        actions: this.result.actions,
        startY,
        acceptedBefore: before.acceptedCount,
      }),
    }
    assert.ok(
      this.result.continuous.coherentCandidates >= 4,
      "Native stream lost the readable intermediate views",
    )
    const viewportHeight = await this.source.evaluate(() => innerHeight)
    assert.ok(
      this.result.continuous.maxObservedTravelWithoutCapture <= viewportHeight,
      "Native stream crossed a viewport without an intermediate capture",
    )
    await this.source.waitForTimeout(1700)
    await this.record("continuous-pause")
  }

  async preparePages() {
    const context = await this.browser.newContext({ viewport: null })
    await this.routeViteClient(context)
    this.source = await context.newPage()
    await this.source.goto(this.article.url, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    })
    await this.source.waitForTimeout(1600)
    await this.source.evaluate((name) => {
      document.title = name
    }, this.title)
    this.observer = await context.newPage()
    if (process.argv.includes("--debug-pairs"))
      await installFrameDiagnostics(this.observer)
    this.observer.on("pageerror", (error) =>
      this.result.errors.push(error.message),
    )
    await this.observer.goto(`${origin}/browser-context-lab.html`)
    await this.observer.locator("#start").click()
    await this.observer.waitForFunction(
      () => window.captureLab?.snapshot().sharing,
      null,
      { timeout: 15000 },
    )
  }

  async routeViteClient(context) {
    await context.route("**/@vite/client", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "export const injectQuery = (url) => url; export const createHotContext = () => ({accept(){},dispose(){},on(){},invalidate(){},prune(){},data:{}}); export const updateStyle = () => {}; export const removeStyle = () => {};",
      }),
    )
  }

  async checkSource() {
    await this.source.bringToFront()
    await this.source.waitForTimeout(1000)
    this.result.sourceCheck = await verifySource(this.observer, this.source)
    assert.ok(
      this.result.sourceCheck.meanRgbDelta < 20,
      "Shared video does not match selected source",
    )
    assert.equal(this.result.sourceCheck.aspectMatches, true)
    await this.observer.waitForFunction(
      () => window.captureLab.snapshot().acceptedCount > 0,
      null,
      { timeout: 20000 },
    )
  }

  async captureScrollProfiles() {
    await this.record("initial")
    await this.profile("slow", 10, 140, 950)
    await this.profile("tight", 18, 24, 500)
    await this.profile("fling", 15, 850, 65)
    await this.profile("reverse", 8, -130, 700)
  }

  async captureControlledEdits() {
    if (this.article.id !== "controlled") return
    await this.source.evaluate(() => scrollTo(0, 0))
    await this.source.waitForTimeout(1600)
    await this.record("before-edit")
    const edits = [
      ["digit", () => window.__validationControl.setDigit("45")],
      ["letter", () => window.__validationControl.setLetter("n")],
      ["negation", () => window.__validationControl.setNegation(true)],
      ["reflow", () => window.__validationControl.showReflow()],
    ]
    for (const [name, operation] of edits)
      await this.captureEdit(name, operation)
  }

  async captureEdit(name, operation) {
    const count = await this.observer.evaluate(
      () => window.captureLab.snapshot().acceptedCount,
    )
    await this.source.evaluate(operation)
    await this.observer.waitForFunction(
      (previous) => window.captureLab.snapshot().acceptedCount > previous,
      count,
      { timeout: 10000 },
    )
    await this.record(`${name}-edit-captured`)
  }

  async captureLongTraverse() {
    await this.source.evaluate(() => scrollTo(0, 0))
    await this.source.waitForTimeout(1200)
    const dimensions = await this.source.evaluate(() => ({
      height: innerHeight,
      total: document.documentElement.scrollHeight,
    }))
    const steps = Math.min(
      70,
      Math.ceil(dimensions.total / (dimensions.height * 0.65)),
    )
    await this.profile(
      "long-traverse",
      steps,
      Math.round(dimensions.height * 0.65),
      1100,
    )
  }

  async stopAndValidate() {
    this.result.snapshot = await this.observer.evaluate(() =>
      window.captureLab.snapshot(),
    )
    this.result.previewCount = await this.observer
      .locator("#captures figure")
      .count()
    await this.observer.screenshot({
      path: `${output}/${this.article.id}-lab.png`,
    })
    await this.source.bringToFront()
    const priorGeneration = this.result.snapshot.generation
    await this.observer.evaluate(() => window.captureLab.stop())
    this.result.afterStop = await this.observer.evaluate(() =>
      window.captureLab.snapshot(),
    )
    this.assertStopped(priorGeneration)
    this.result.status = "passed"
  }

  assertStopped(priorGeneration) {
    assert.equal(this.result.afterStop.sharing, false)
    assert.equal(this.result.afterStop.previews, 0)
    assert.equal(this.result.afterStop.pipeline.retainedPixelBytes, 0)
    assert.equal(this.result.afterStop.pipeline.tracker.anchorBytes, 0)
    assert.ok(this.result.afterStop.generation > priorGeneration)
    assert.ok(this.result.previewCount <= 6)
    assert.equal(this.result.errors.length, 0)
  }

  async record(mode) {
    this.result.actions.push({
      mode,
      at: Date.now(),
      ...(await this.source.evaluate(() => ({
        y: scrollY,
        height: innerHeight,
        total: document.documentElement.scrollHeight,
      }))),
      snapshot: await this.observer.evaluate(() => {
        const state = window.captureLab.snapshot()
        return {
          accepted: state.acceptedCount,
          events: state.events.slice(-2),
          delivery: state.delivery,
        }
      }),
    })
  }

  async profile(mode, steps, distance, dwell) {
    for (let index = 0; index < steps; index += 1) {
      await this.source.mouse.wheel(0, distance)
      await this.source.waitForTimeout(dwell)
      await this.record(mode)
    }
    await this.source.waitForTimeout(1700)
    await this.record(`${mode}-pause`)
  }

  async closeAndWrite() {
    if (process.argv.includes("--debug-pairs"))
      await saveFrameDiagnostics(this.observer, this.article.id)
    await this.browser.close()
    await fs.writeFile(
      `${output}/${this.article.id}.json`,
      JSON.stringify(this.result, null, 2),
    )
    console.log(
      JSON.stringify({
        id: this.article.id,
        status: this.result.status,
        captures: this.result.snapshot?.acceptedCount,
        error: this.result.error,
        output,
      }),
    )
    if (this.result.status !== "passed") process.exitCode = 1
  }
}

function continuousCaptureProgress({ actions, startY, acceptedBefore }) {
  let lastCapturedY = startY
  let lastCount = acceptedBefore
  let maxObservedTravelWithoutCapture = 0
  for (const action of actions) {
    if (action.mode !== "continuous") continue
    const distance = Math.abs(action.y - lastCapturedY)
    maxObservedTravelWithoutCapture = Math.max(
      maxObservedTravelWithoutCapture,
      distance,
    )
    if (action.snapshot.accepted <= lastCount) continue
    lastCapturedY = action.y
    lastCount = action.snapshot.accepted
  }
  return { maxObservedTravelWithoutCapture }
}

async function verifySource(observer, source) {
  const png = (await source.screenshot()).toString("base64")
  return observer.evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const video = document.querySelector("video")
    const canvas = document.createElement("canvas")
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    ctx.drawImage(image, 0, 0, 64, 64)
    const expected = ctx.getImageData(0, 0, 64, 64).data
    ctx.drawImage(video, 0, 0, 64, 64)
    const received = ctx.getImageData(0, 0, 64, 64).data
    let delta = 0
    for (let index = 0; index < received.length; index += 4) {
      delta +=
        Math.abs(expected[index] - received[index]) +
        Math.abs(expected[index + 1] - received[index + 1]) +
        Math.abs(expected[index + 2] - received[index + 2])
    }
    return {
      meanRgbDelta: delta / (64 * 64 * 3),
      sourceWidth: image.width,
      sourceHeight: image.height,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      aspectMatches:
        Math.abs(
          image.width / image.height - video.videoWidth / video.videoHeight,
        ) < 0.01,
    }
  }, png)
}

async function installFrameDiagnostics(page) {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.getImageData
    const debug = {
      enabled: false,
      last: null,
      lastPairAt: 0,
      pairs: [],
      timeOrigin: performance.timeOrigin,
    }
    window.nativeFrameDebug = debug
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      const pixels = original.apply(this, args)
      const video = document.querySelector("video")
      const sourceSize =
        video &&
        this.canvas.width === video.videoWidth &&
        this.canvas.height === video.videoHeight
      if (!debug.enabled || !sourceSize || debug.pairs.length >= 3)
        return pixels
      const at = performance.now()
      if (debug.last && at - debug.lastPairAt >= 1500) {
        const previous = document.createElement("canvas")
        previous.width = debug.last.pixels.width
        previous.height = debug.last.pixels.height
        previous.getContext("2d").putImageData(debug.last.pixels, 0, 0)
        debug.pairs.push({
          beforeAt: debug.last.at,
          at,
          mediaTime: video.currentTime,
          before: previous.toDataURL("image/png"),
          after: this.canvas.toDataURL("image/png"),
        })
        debug.lastPairAt = at
      }
      debug.last = { at, pixels }
      if (debug.pairs.length >= 3) debug.last = null
      return pixels
    }
  })
}

async function saveFrameDiagnostics(page, id) {
  const debug = await page
    ?.evaluate(() => {
      const state = window.nativeFrameDebug
      return state ? { timeOrigin: state.timeOrigin, pairs: state.pairs } : null
    })
    .catch(() => null)
  if (!debug) return
  for (const [index, pair] of debug.pairs.entries()) {
    for (const side of ["before", "after"]) {
      await fs.writeFile(
        `${output}/${id}-pair-${index}-${side}.png`,
        Buffer.from(pair[side].split(",")[1], "base64"),
      )
    }
    delete pair.before
    delete pair.after
  }
  await fs.writeFile(
    `${output}/${id}-pairs.json`,
    JSON.stringify(debug, null, 2),
  )
}

await fs.mkdir(output, { recursive: true })
for (const article of articles) {
  if (!selectedArticle || article.id === selectedArticle) await run(article)
}
