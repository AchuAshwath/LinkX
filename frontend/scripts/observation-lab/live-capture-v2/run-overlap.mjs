import { mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { chromium } from "playwright"

const root =
    process.env.LIVE_CAPTURE_OUTPUT ??
    path.join(os.tmpdir(), "linkx-live-capture-v2"),
  profile = process.env.LIVE_CAPTURE_PROFILE ?? `${root}/chrome-profile-v1`,
  policies = ["whole-frame", "changed-tile"]
await mkdir(root, { recursive: true })
const browser = await chromium.launchPersistentContext(profile, {
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: false,
  args: [
    "--auto-select-desktop-capture-source=LinkX synthetic live capture lab",
    "--use-fake-ui-for-media-stream",
  ],
})
const page = await browser.newPage()
await page.goto("http://127.0.0.1:4014/")
await page.evaluate(() => window.setScenario("indicator", 0))
const setupStart = performance.now()
await page.click("#start")
await page.waitForFunction(() => window.stream, { timeout: 15000 })
const captureSetupMs = performance.now() - setupStart
const settings = await page.evaluate(() =>
  window.stream.getVideoTracks()[0].getSettings(),
)
await new Promise((r) => setTimeout(r, 500))
const clockOffsetMs =
  performance.now() - (await page.evaluate(() => performance.now()))
await page.evaluate(() => window.captureAnalyzer.setup())
const report = {
  prototype: "getDisplayMedia continuous-animation settle stress",
  environment: {
    chrome: await browser.browser().version(),
    host: "macOS 15.7.7 Apple M4 arm64",
    api: 'getDisplayMedia({video:{displaySurface:"browser"},audio:false}) on the synthetic source tab; drawImage(video); requestVideoFrameCallback',
    settings,
    captureSetupMs,
    animationIntervalMs: 80,
    sampleIntervalTargetMs: 200,
    settleMs: 150,
    tilePixels: 32,
    tileChangedRatio: 0.08,
  },
  stages: [],
}
let sampleNo = 0
async function collect(name, durationMs, revision, event = null) {
  const start = performance.now(),
    rows = []
  while (performance.now() - start < durationMs) {
    const r = await page.evaluate(
      (args) => window.captureAnalyzer.sample(args),
      { scenario: name, revision, sampleNo: sampleNo++ },
    )
    rows.push({
      sampleNo: sampleNo - 1,
      atScenarioMs: performance.now() - start,
      frameAtScenarioMs: r.atMs + clockOffsetMs - start,
      width: r.width,
      height: r.height,
      videoTime: r.videoTime,
      results: r.results,
    })
    const spent = performance.now() - (start + rows.at(-1).atScenarioMs)
    const wait = 200 - spent
    if (wait > 0) await new Promise((x) => setTimeout(x, wait))
  }
  const snapshot = await page.evaluate(
    (names) =>
      names.map((policy) => {
        const s = window.captureAnalyzer.states[policy]
        return {
          policy,
          accepted: s.accepted,
          frames: s.frames,
          medianPixelScanMs: ((a) => {
            const x = [...a].sort((u, v) => u - v)
            return x.length ? x[Math.floor(x.length / 2)] : null
          })(s.scanMs),
          medianJpegEncodeMs: ((a) => {
            const x = [...a].sort((u, v) => u - v)
            return x.length ? x[Math.floor(x.length / 2)] : null
          })(s.encodeMs),
          jpegBytes: s.jpegBytes,
        }
      }),
    policies,
  )
  report.stages.push({
    name,
    revision,
    eventAtMs: event?.atMs ?? null,
    elapsedMs: performance.now() - start,
    processedSamples: rows.length,
    policies: snapshot.map((p) => ({
      ...p,
      frames: p.frames.map((f) => ({
        ...f,
        atScenarioMs: f.atMs + clockOffsetMs - start,
        delayAfterUpdateMs: event ? f.atMs + clockOffsetMs - event.atMs : null,
      })),
    })),
    samples: rows,
  })
}
await collect("indicator-only", 2200, 0)
const _digitEventStart = performance.now()
await page.evaluate(() => window.setScenario("indicator-digit", 1))
const digitAt = performance.now()
await collect("indicator-plus-one-digit", 2200, 1, { atMs: digitAt })
const _textEventStart = performance.now()
await page.evaluate(() => window.setScenario("indicator-text", 1))
const textAt = performance.now()
await collect("indicator-plus-text-addition", 2200, 1, { atMs: textAt })
const final = await page.evaluate(() => ({
  settings: window.stream.getVideoTracks()[0].getSettings(),
  frameCount: window.frameStats.count,
  medianFrameDeltaMs: window.frameStats.deltas.slice().sort((a, b) => a - b)[
    Math.floor(window.frameStats.deltas.length / 2)
  ],
  minFrameDeltaMs: Math.min(...window.frameStats.deltas),
  maxFrameDeltaMs: Math.max(...window.frameStats.deltas),
  saved: window.__savedSamples || [],
}))
report.trackStats = final
report.inputEvents = { digitAtMs: digitAt, textAtMs: textAt }
for (let i = 0; i < final.saved.length; i++) {
  const item = final.saved[i]
  await writeFile(`${root}/accepted-${i + 1}.jpg`, Buffer.from(item.data))
  void 0
}
delete report.acceptedArtifacts
report.acceptedImages = final.saved.map(
  ({ scenario, revision, sampleNo, bytes }) => ({
    scenario,
    revision,
    sampleNo,
    bytes,
  }),
)
delete report.trackStats.saved
await writeFile(`${root}/results.json`, `${JSON.stringify(report, null, 2)}\n`)
await page.evaluate(() => window.stream.getTracks().forEach((t) => t.stop()))
await browser.close()
console.log(
  JSON.stringify(
    {
      settings,
      captureSetupMs,
      trackStats: report.trackStats,
      stages: report.stages.map((s) => ({
        name: s.name,
        elapsedMs: s.elapsedMs,
        samples: s.processedSamples,
        policies: s.policies.map((p) => ({
          policy: p.policy,
          accepted: p.accepted,
          frames: p.frames.map((f) => ({
            revision: f.revision,
            delay: f.delayAfterUpdateMs,
            candidateTiles: f.candidateTiles,
            stableTiles: f.settledTileIds,
          })),
          scanMs: p.medianPixelScanMs,
          encodeMs: p.medianJpegEncodeMs,
          bytes: p.jpegBytes,
        })),
      })),
      acceptedImages: report.acceptedImages,
    },
    null,
    2,
  ),
)
