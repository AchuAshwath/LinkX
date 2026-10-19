import { mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { chromium } from "playwright"

const out = path.resolve(
  process.env.LIVE_CAPTURE_OUTPUT ?? path.join(os.tmpdir(), "linkx-live-capture-v1"),
)
await mkdir(out, { recursive: true })
const names = [
  "global-anchor",
  "global-last-accepted",
  "tiled-anchor",
  "tiled-last-accepted",
]
const policies = [
  { name: "sample-200-settle-150", sampleMs: 200, settleMs: 150 },
  { name: "sample-500-settle-300", sampleMs: 500, settleMs: 300 },
]
const browser = await chromium.launchPersistentContext(
  `${out}/chrome-profile-v7`,
  {
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: false,
    args: [
      "--auto-select-desktop-capture-source=LinkX synthetic live capture lab",
      "--use-fake-ui-for-media-stream",
    ],
  },
)
const controller = await browser.newPage()
await controller.goto("http://127.0.0.1:4013/self")
const started = performance.now()
await controller.click("#start")
await controller.waitForFunction(() => window.stream, { timeout: 15000 })
const captureSetupMs = performance.now() - started
const settings = await controller.evaluate(() =>
  window.stream.getVideoTracks()[0].getSettings(),
)
const clockOffsetMs =
  performance.now() - (await controller.evaluate(() => performance.now()))
const scenarios = [
  { name: "paused", initial: ["paused", 0], durationMs: 1400, expected: [] },
  {
    name: "animation",
    initial: ["animation", 0],
    durationMs: 1400,
    expected: [],
  },
  {
    name: "one-digit",
    initial: ["one-digit", 0],
    durationMs: 2500,
    updates: [[500, "one-digit", 1]],
    expected: [1],
  },
  {
    name: "cumulative",
    initial: ["cumulative", 0],
    durationMs: 8000,
    updates: [
      [500, "cumulative", 1],
      [2500, "cumulative", 2],
      [4500, "cumulative", 3],
      [6500, "cumulative", 4],
    ],
    expected: [1, 2, 3, 4],
  },
]
const report = {
  prototype: "THROWAWAY actual getDisplayMedia tab-capture policy experiment",
  environment: {
    chrome: await browser.browser().version(),
    host: "macOS 15.7.7 Apple M4 arm64",
    source:
      "synthetic local tab; Chrome headed persistent isolated profile; no user tab/desktop capture",
    api: 'getDisplayMedia({video:{displaySurface:"browser"},audio:false}); drawImage(video); requestVideoFrameCallback',
    settings,
    captureSetupMs,
  },
  configs: policies,
  scenarios: [],
}
for (const config of policies) {
  for (const scenario of scenarios) {
    const start = performance.now()
    await controller.evaluate(
      ([k, r]) => window.setScenario(k, r),
      scenario.initial,
    )
    await new Promise((r) => setTimeout(r, 450))
    await controller.evaluate(
      async (p) => window.captureAnalyzer.setup(p),
      names,
    )
    const rows = []
    let revision = 0,
      updateIndex = 0
    while (performance.now() - start < scenario.durationMs) {
      const elapsed = performance.now() - start
      while (updateIndex < (scenario.updates ?? []).length) {
        const update = (scenario.updates ?? [])[updateIndex]
        const at = update[0]
        if (elapsed < at) break
        const [time, k, r] = update
        await controller.evaluate(
          ([kind, rev]) => window.setScenario(kind, rev),
          [k, r],
        )
        revision = r
        rows.push({
          event: "revision",
          revision,
          atMs: performance.now() - start,
          requestedAtMs: time,
        })
        updateIndex++
      }
      const sample = await controller.evaluate(
        (args) => window.captureAnalyzer.sample(args),
        {
          policyNames: names,
          globalLimit: 0.003,
          tile: 32,
          tileLimit: 0.08,
          settle: config.settleMs,
          scenario: scenario.name,
          revision,
          sampleNo: rows.filter((x) => x.sample).length,
        },
      )
      rows.push({
        sample: true,
        scenario: scenario.name,
        revision,
        atMs: performance.now() - start,
        frameAtMs: sample.atMs + clockOffsetMs - start,
        videoTime: sample.videoTime,
        width: sample.width,
        height: sample.height,
        results: sample.results,
      })
      const next = config.sampleMs - (performance.now() - (start + elapsed))
      if (next > 0) await new Promise((r) => setTimeout(r, next))
    }
    const summary = await controller.evaluate(
      ({ policyNames, expected, clockOffsetMs, startedAt }) =>
        policyNames.map((policy) => {
          const s = window.captureAnalyzer.states[policy],
            acceptedRevisions = [
              ...new Set(
                s.frames.filter((f) => f.revision > 0).map((f) => f.revision),
              ),
            ],
            median = (a) => {
              const v = [...a].sort((x, y) => x - y)
              return v.length ? v[Math.floor(v.length / 2)] : null
            }
          return {
            policy,
            accepted: s.accepted,
            acceptedRevisions,
            missedExpected: expected.filter(
              (r) => !acceptedRevisions.includes(r),
            ),
            duplicateCandidates: s.duplicateCandidates,
            medianPixelScanMs: median(s.scanMs),
            medianAcceptedScanMs: median(s.acceptedScanMs),
            medianJpegEncodeMs: median(s.encodeMs),
            jpegBytes: s.jpegBytes,
            acceptedFrames: s.frames.map((f) => ({
              ...f,
              atScenarioMs: f.atMs + clockOffsetMs - startedAt,
            })),
          }
        }),
      {
        policyNames: names,
        expected: scenario.expected,
        clockOffsetMs,
        startedAt: start,
      },
    )
    report.scenarios.push({
      name: scenario.name,
      expectedRevisions: scenario.expected,
      samplingConfig: config.name,
      elapsedMs: performance.now() - start,
      sampleCount: rows.filter((x) => x.sample).length,
      policies: summary,
      samples: rows,
    })
  }
}
const streamData = await controller.evaluate(() => ({
  snapshot: window.captureAnalyzer.snapshot(),
  jpeg: window.__savedJpeg
    ? Array.from(new Uint8Array(window.__savedJpeg))
    : null,
}))
report.finalFrameStats = streamData.snapshot
if (streamData.jpeg) {
  await writeFile(`${out}/accepted-sample-v3.jpg`, Buffer.from(streamData.jpeg))
  report.acceptedSample = streamData.snapshot.jpegMeta
}
await writeFile(
  `${out}/results-v3.json`,
  `${JSON.stringify(report, null, 2)}\n`,
)
await controller.evaluate(() =>
  window.stream.getTracks().forEach((t) => t.stop()),
)
await browser.close()
console.log(
  JSON.stringify(
    {
      captureSetupMs,
      settings,
      frameStats: report.finalFrameStats.frameStats,
      scenarios: report.scenarios.map((s) => ({
        name: s.name,
        samplingConfig: s.samplingConfig,
        elapsedMs: s.elapsedMs,
        sampleCount: s.sampleCount,
        policies: s.policies.map((p) => ({
          policy: p.policy,
          accepted: p.accepted,
          revisions: p.acceptedRevisions,
          missed: p.missedExpected,
          duplicates: p.duplicateCandidates,
          scan: p.medianPixelScanMs,
          encode: p.medianJpegEncodeMs,
          bytes: p.jpegBytes,
        })),
      })),
      acceptedSample: report.acceptedSample,
    },
    null,
    2,
  ),
)
