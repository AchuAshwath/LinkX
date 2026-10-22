import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { chromium } from "@playwright/test"

const output =
  process.env.CAPTURE_LIFECYCLE_OUTPUT || "/tmp/linkx-capture-v3-lifecycle"
const browser = await chromium.launch({ channel: "chrome", headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const failures = []
const cases = []
const requests = []
page.on("request", (request) => {
  if (request.url().includes("/api/")) requests.push(request.url())
})
page.on("pageerror", (error) => failures.push(error.message))
await page.route("**/@vite/client", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "export const injectQuery = (url) => url; export const createHotContext = () => ({accept(){},dispose(){},on(){},invalidate(){},prune(){},data:{}}); export const updateStyle = () => {}; export const removeStyle = () => {};",
  }),
)

await page.addInitScript(() => {
  const canvas = document.createElement("canvas")
  canvas.width = 800
  canvas.height = 600
  const ctx = canvas.getContext("2d")
  const paint = () => {
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, 800, 600)
    ctx.fillStyle = "#112244"
    ctx.font = "20px sans-serif"
    for (let row = 0; row < 18; row += 1)
      ctx.fillText(
        `Independent canvas video. Readable line ${row}.`,
        60,
        40 + row * 30,
      )
  }
  paint()
  window.testCapture = { mode: "cancel", tracks: [], release: null, paint }
  const nativePlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    if (window.testCapture.mode !== "hold-play") return nativePlay.call(this)
    return new Promise((resolve) => {
      window.testCapture.releasePlay = resolve
    })
  }
  Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
    value: async () => {
      const state = window.testCapture
      if (state.mode === "cancel")
        throw new DOMException("Sharing cancelled", "NotAllowedError")
      if (state.mode === "pending")
        await new Promise((resolve) => {
          state.release = resolve
        })
      const stream = canvas.captureStream(10)
      const track = stream.getVideoTracks()[0]
      const surface = state.mode === "monitor" ? "monitor" : "browser"
      Object.defineProperty(track, "getSettings", {
        value: () => ({ displaySurface: surface }),
      })
      state.tracks.push(track)
      state.timer = setInterval(paint, 100)
      return stream
    },
  })
})

try {
  await page.goto("http://127.0.0.1:4000/browser-context-lab.html")
  await page.locator("#start").click()
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("cancelled"),
  )
  assert.equal(await page.locator("#start").isEnabled(), true)
  cases.push("cancelled picker recovers")

  await page.evaluate(() => {
    window.testCapture.mode = "monitor"
  })
  await page.locator("#start").click()
  await page.waitForFunction(() =>
    document
      .querySelector("#status")
      .textContent.includes("Choose a browser tab"),
  )
  assert.equal(
    await page.evaluate(() =>
      window.testCapture.tracks.every((track) => track.readyState === "ended"),
    ),
    true,
  )
  cases.push("unsupported surface is released")

  await page.evaluate(() => {
    window.testCapture.mode = "pending"
  })
  await page.locator("#start").click()
  await page.waitForFunction(() => Boolean(window.testCapture.release))
  await page.evaluate(() => {
    window.captureLab.stop()
    window.testCapture.release()
  })
  await page.waitForFunction(() => !document.querySelector("#start").disabled)
  assert.equal(
    await page.evaluate(() =>
      window.testCapture.tracks.every((track) => track.readyState === "ended"),
    ),
    true,
  )
  cases.push("late picker result cannot restart a stopped generation")

  await page.evaluate(() => {
    window.testCapture.mode = "browser"
  })
  await page.locator("#start").click()
  await page.waitForFunction(
    () => window.captureLab.snapshot().acceptedCount > 0,
    null,
    { timeout: 10000 },
  )
  const diagnostics = await page.evaluate(() =>
    JSON.stringify(window.captureLab.snapshot()),
  )
  assert.equal(diagnostics.includes("base64"), false)
  await page.locator("#captures button").first().click()
  assert.equal(await page.locator("#image-dialog").isVisible(), true)
  await page.locator("#dismiss").click()
  assert.equal(await page.locator("#full-image").getAttribute("src"), null)
  await page.locator("#captures button").first().click()
  await page.keyboard.press("Escape")
  await page.waitForFunction(
    () => !document.querySelector("#full-image").hasAttribute("src"),
    null,
    { timeout: 3000 },
  )
  cases.push(
    "captured image inspection releases closed image and diagnostics exclude pixels",
  )

  await page.evaluate(() =>
    window.testCapture.tracks.at(-1).dispatchEvent(new Event("mute")),
  )
  await assertCleared()
  cases.push("muted source stops and clears")

  await page.locator("#start").click()
  await page.waitForFunction(
    () => window.captureLab.snapshot().acceptedCount > 0,
  )
  await page.evaluate(() =>
    window.testCapture.tracks.at(-1).dispatchEvent(new Event("ended")),
  )
  await assertCleared()
  cases.push("ended source stops and clears")

  await page.locator("#start").click()
  await page.waitForFunction(
    () => window.captureLab.snapshot().acceptedCount > 0,
  )
  await page.locator("#stop").click()
  await assertCleared()
  cases.push("manual stop clears all session pixels")
  await page.evaluate(() => {
    window.testCapture.mode = "hold-play"
  })
  await page.locator("#start").click()
  await page.waitForFunction(() => Boolean(window.testCapture.releasePlay))
  await page.evaluate(() => {
    window.testCapture.tracks.at(-1).stop()
    window.testCapture.releasePlay()
  })
  await page.waitForFunction(() => !document.querySelector("#start").disabled)
  await assertCleared()
  cases.push(
    "source ending before video play resolves cannot leave a dead session",
  )
  assert.equal(requests.length, 0)
  assert.equal(failures.length, 0)
} catch (error) {
  failures.push(error.stack || error.message)
} finally {
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        cases,
        failures,
        modelRequests: requests,
        status: failures.length ? "failed" : "passed",
      },
      null,
      2,
    ),
  )
  await browser.close()
  console.log(JSON.stringify({ cases: cases.length, failures, output }))
  if (failures.length) process.exitCode = 1
}

async function assertCleared() {
  await page.waitForFunction(
    () => !window.captureLab.snapshot().sharing,
    null,
    { timeout: 3000 },
  )
  const state = await page.evaluate(() => window.captureLab.snapshot())
  assert.equal(state.previews, 0)
  assert.equal(state.pipeline.retainedPixelBytes, 0)
  assert.equal(state.pipeline.tracker.anchorBytes, 0)
  assert.equal(await page.locator("#captures figure").count(), 0)
}
