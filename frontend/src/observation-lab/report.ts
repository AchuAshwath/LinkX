export interface RunExportInput {
  fixtureVersion: string
  fixtureProvenance: {
    source: string
    license: string
  }
  scenarioId: string
  config: {
    sampleHz: number
    settleMs: number
  }
  environment: {
    browser: string
    os: string
    device: string
    displayScale: number
    width: number
    height: number
    cache: "cold" | "warm" | "unknown"
    modelId: string | null
  }
  measurements: {
    acceptedViews: number
    coveragePercent: number
    localProcessingMs: number[]
    uploadMs: number[]
    providerMs: number[]
    misses: number
    unexpectedAcceptedViews: number
    failures: number
  }
}

interface TimingSummary {
  meanMs: number | null
  p95Ms: number | null
  samples: number
}

export interface RunExport {
  measurementMode: "scripted-fixture-policy-replay"
  fixtureVersion: string
  fixtureProvenance: RunExportInput["fixtureProvenance"]
  scenarioId: string
  config: RunExportInput["config"]
  environment: RunExportInput["environment"]
  measurements: {
    acceptedViews: number
    coveragePercent: number
    localProcessing: TimingSummary
    upload: TimingSummary
    provider: TimingSummary
    misses: number
    unexpectedAcceptedViews: number
    failures: number
  }
}

function summarizeTiming(samples: number[]): TimingSummary {
  if (samples.length === 0) {
    return { meanMs: null, p95Ms: null, samples: 0 }
  }

  const ordered = [...samples].sort((left, right) => left - right)
  const total = ordered.reduce((sum, sample) => sum + sample, 0)
  const p95Index = Math.ceil(ordered.length * 0.95) - 1

  return {
    meanMs: Number((total / ordered.length).toFixed(2)),
    p95Ms: ordered[p95Index],
    samples: ordered.length,
  }
}

export function createRunExport(input: RunExportInput): RunExport {
  return {
    measurementMode: "scripted-fixture-policy-replay",
    fixtureVersion: input.fixtureVersion,
    fixtureProvenance: { ...input.fixtureProvenance },
    scenarioId: input.scenarioId,
    config: {
      sampleHz: input.config.sampleHz,
      settleMs: input.config.settleMs,
    },
    environment: {
      browser: input.environment.browser,
      os: input.environment.os,
      device: input.environment.device,
      displayScale: input.environment.displayScale,
      width: input.environment.width,
      height: input.environment.height,
      cache: input.environment.cache,
      modelId: input.environment.modelId,
    },
    measurements: {
      acceptedViews: input.measurements.acceptedViews,
      coveragePercent: input.measurements.coveragePercent,
      localProcessing: summarizeTiming(input.measurements.localProcessingMs),
      upload: summarizeTiming(input.measurements.uploadMs),
      provider: summarizeTiming(input.measurements.providerMs),
      misses: input.measurements.misses,
      unexpectedAcceptedViews: input.measurements.unexpectedAcceptedViews,
      failures: input.measurements.failures,
    },
  }
}
