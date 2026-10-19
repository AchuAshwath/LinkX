import { describe, expect, it } from "vitest"
import {
  FIXTURE_PROVENANCE,
  READING_FIXTURES,
} from "@/observation-lab/fixtures"
import { replayReadingFixture } from "@/observation-lab/replay"

describe("fixture policy replay", () => {
  it("records repository ownership and the applicable license", () => {
    expect(FIXTURE_PROVENANCE).toEqual({
      source: "Original fictional text created for the LinkX observation lab",
      license: "MIT; see the repository LICENSE",
    })
  })

  it("uses sample and settle settings to classify scripted views", () => {
    const standard = replayReadingFixture(READING_FIXTURES[0], {
      sampleHz: 4,
      settleMs: 700,
    })
    const strict = replayReadingFixture(READING_FIXTURES[0], {
      sampleHz: 4,
      settleMs: 900,
    })

    expect(standard.observations.map((frame) => frame.outcome)).toEqual([
      "accepted",
      "unchanged",
      "accepted",
    ])
    expect(strict.observations.map((frame) => frame.outcome)).toEqual([
      "accepted",
      "unchanged",
      "not-settled",
    ])
    expect(standard.missedExpectedViews).toBe(0)
    expect(strict.missedExpectedViews).toBe(1)
  })

  it("marks frames missed by the configured sample rate", () => {
    const replay = replayReadingFixture(READING_FIXTURES[0], {
      sampleHz: 1,
      settleMs: 700,
    })

    expect(replay.observations[1].outcome).toBe("not-sampled")
    expect(replay.acceptedViewCount).toBe(2)
  })
})
