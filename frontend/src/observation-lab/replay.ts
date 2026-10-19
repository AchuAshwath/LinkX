import type { FixtureFrame, ReadingFixture } from "@/observation-lab/fixtures"

export interface ReplayConfiguration {
  sampleHz: number
  settleMs: number
}

export interface ReplayObservation {
  frameId: string
  atMs: number
  visibleBlockIds: string[]
  textOverrides: Record<string, string>
  zoomPercent: 100 | 200 | 400
  outcome: "accepted" | "not-sampled" | "unchanged" | "not-settled"
  expectedAccepted: boolean
}

export interface FixtureReplay {
  observations: ReplayObservation[]
  acceptedViewCount: number
  coveragePercent: number
  missedExpectedViews: number
  unexpectedAcceptedViews: number
}

function signatureForFrame(
  frame: FixtureFrame,
  fixture: ReadingFixture,
): string {
  const blocks = frame.visibleBlockIds.map((id) => {
    const block = fixture.blocks.find((candidate) => candidate.id === id)
    return [id, frame.textOverrides?.[id] ?? block?.text ?? ""]
  })
  return JSON.stringify({ blocks, zoomPercent: frame.zoomPercent ?? 100 })
}

export function replayReadingFixture(
  fixture: ReadingFixture,
  configuration: ReplayConfiguration,
): FixtureReplay {
  const sampleIntervalMs = 1000 / configuration.sampleHz
  let lastSampleAtMs: number | null = null
  let lastAcceptedSignature: string | null = null
  const acceptedBlocks = new Set<string>()
  const observations = fixture.frames.map((frame) => {
    const canSample =
      lastSampleAtMs === null || frame.atMs - lastSampleAtMs >= sampleIntervalMs
    if (canSample) lastSampleAtMs = frame.atMs

    const signature = signatureForFrame(frame, fixture)
    const changed = signature !== lastAcceptedSignature
    const settled = (frame.stableForMs ?? 1000) >= configuration.settleMs
    const accepted =
      canSample && changed && (lastAcceptedSignature === null || settled)

    if (accepted) {
      lastAcceptedSignature = signature
      for (const id of frame.visibleBlockIds) acceptedBlocks.add(id)
    }

    return {
      frameId: frame.id,
      atMs: frame.atMs,
      visibleBlockIds: frame.visibleBlockIds,
      textOverrides: frame.textOverrides ?? {},
      zoomPercent: frame.zoomPercent ?? 100,
      outcome: outcomeForFrame({ canSample, changed, settled, accepted }),
      expectedAccepted: frame.expectedAccepted,
    }
  })

  const acceptedViewCount = observations.filter(
    (observation) => observation.outcome === "accepted",
  ).length
  const missedExpectedViews = observations.filter(
    (observation) =>
      observation.expectedAccepted && observation.outcome !== "accepted",
  ).length
  const unexpectedAcceptedViews = observations.filter(
    (observation) =>
      !observation.expectedAccepted && observation.outcome === "accepted",
  ).length

  return {
    observations,
    acceptedViewCount,
    coveragePercent: Math.round(
      (acceptedBlocks.size / fixture.blocks.length) * 100,
    ),
    missedExpectedViews,
    unexpectedAcceptedViews,
  }
}

function outcomeForFrame(input: {
  canSample: boolean
  changed: boolean
  settled: boolean
  accepted: boolean
}): ReplayObservation["outcome"] {
  if (!input.canSample) return "not-sampled"
  if (!input.changed) return "unchanged"
  if (!input.settled && !input.accepted) return "not-settled"
  return "accepted"
}
