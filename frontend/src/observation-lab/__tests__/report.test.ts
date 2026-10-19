import { describe, expect, it } from "vitest"
import { createRunExport } from "@/observation-lab/report"

describe("fixture run export", () => {
  it("leaves timing unavailable when replay did not measure a stage", () => {
    const report = createRunExport({
      fixtureVersion: "2026-10-18.2",
      fixtureProvenance: {
        source: "Original fictional text created for the LinkX observation lab",
        license: "MIT; see the repository LICENSE",
      },
      scenarioId: "scroll-pause-sidebar",
      config: { sampleHz: 4, settleMs: 700 },
      environment: {
        browser: "Chromium",
        os: "macOS",
        device: "local browser viewport",
        displayScale: 2,
        width: 1440,
        height: 900,
        cache: "unknown",
        modelId: null,
      },
      measurements: {
        acceptedViews: 0,
        coveragePercent: 0,
        localProcessingMs: [],
        uploadMs: [],
        providerMs: [],
        misses: 0,
        unexpectedAcceptedViews: 0,
        failures: 0,
      },
    })

    expect(report.measurements.localProcessing).toEqual({
      meanMs: null,
      p95Ms: null,
      samples: 0,
    })
    expect(report.measurements.upload.meanMs).toBeNull()
    expect(report.measurements.provider.meanMs).toBeNull()
  })

  it("exports reproducible aggregate measurements without fixture content", () => {
    const run = {
      fixtureVersion: "2026-10-18.2",
      fixtureProvenance: {
        source: "Original fictional text created for the LinkX observation lab",
        license: "MIT; see the repository LICENSE",
      },
      scenarioId: "scroll-pause-sidebar",
      config: {
        sampleHz: 4,
        settleMs: 700,
        groundTruth: "Config sentinel: hidden text",
      },
      environment: {
        browser: "Chromium 140",
        os: "macOS 26",
        device: "developer laptop",
        displayScale: 2,
        width: 1440,
        height: 900,
        cache: "warm" as const,
        modelId: null,
      },
      measurements: {
        acceptedViews: 3,
        coveragePercent: 75,
        localProcessingMs: [12, 18, 20],
        uploadMs: [0],
        providerMs: [0],
        misses: 1,
        unexpectedAcceptedViews: 0,
        failures: 0,
      },
      fixtureGroundTruth: "Ground truth sentinel: fixture-only private text",
      ocrText: "OCR sentinel: observed fixture text",
      screenshotDataUrl: "data:image/png;base64,fixture-pixels",
    }
    const report = createRunExport(run)

    expect(report).toMatchObject({
      measurementMode: "scripted-fixture-policy-replay",
      fixtureVersion: "2026-10-18.2",
      scenarioId: "scroll-pause-sidebar",
      measurements: {
        acceptedViews: 3,
        coveragePercent: 75,
        misses: 1,
        failures: 0,
        localProcessing: { meanMs: 16.67, p95Ms: 20, samples: 3 },
        upload: { meanMs: 0, p95Ms: 0, samples: 1 },
      },
    })
    expect(JSON.stringify(report)).not.toContain("Ground truth sentinel")
    expect(JSON.stringify(report)).not.toContain("Config sentinel")
    expect(JSON.stringify(report)).not.toContain("OCR sentinel")
    expect(JSON.stringify(report)).not.toContain("base64")
  })
})
