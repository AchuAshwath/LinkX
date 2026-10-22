import assert from "node:assert/strict"
import test from "node:test"
import { createCapturePipeline } from "./pipeline.mjs"

const frame = (seq, pixels, { width, height }, capturedAt = seq * 100) => ({
  seq,
  generation: 1,
  ownerChat: "audit-chat",
  capturedAt,
  width,
  height,
  pixels,
  getDataUrl: () =>
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
})

const whiteFrame = (width, height) => {
  const pixels = new Uint8Array(width * height * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels.set([255, 255, 255, 255], offset)
  }
  return pixels
}

const oneLine = () => {
  const width = 160
  const height = 120
  const pixels = whiteFrame(width, height)
  for (let x = 12; x < width - 12; x += 1) {
    const offset = (60 * width + x) * 4
    pixels.set([20, 20, 20, 255], offset)
  }
  return { width, height, pixels }
}

const sidebarAndScrollingBody = (scroll) => {
  const width = 320
  const height = 240
  const pixels = whiteFrame(width, height)
  for (let y = 0; y < height; y += 1) {
    paintSidebarRow({ pixels, width, y })
    paintArticleRow({ pixels, width, y, scroll })
  }
  return { width, height, pixels }
}

function paintSidebarRow({ pixels, width, y }) {
  if (y % 16 >= 12) return
  for (let x = 8; x < 96; x += 1) {
    if ((x + Math.floor(y / 5) * 3) % 13 < 4)
      pixels.set([20, 20, 20, 255], (y * width + x) * 4)
  }
}

function paintArticleRow({ pixels, width, y, scroll }) {
  const documentY = y + scroll
  const lineY = documentY % 24
  if (lineY < 5 || lineY >= 13) return
  for (let x = 150; x < 185; x += 1) {
    if ((x * 7 + Math.floor(documentY / 24) * 11 + lineY) % 9 < 3)
      pixels.set([20, 20, 20, 255], (y * width + x) * 4)
  }
}

test("a stable one-line viewport produces an initial candidate", () => {
  const accepted = []
  const pipeline = createCapturePipeline({
    onCandidate: (candidate) => accepted.push(candidate),
    now: () => 0,
    options: {
      initialSettleMs: 0,
      initialStableCoverage: 0.65,
      settleMs: 0,
      sampleIntervalMs: 100,
    },
  })
  const content = oneLine()

  for (let seq = 1; seq <= 12; seq += 1) {
    pipeline.offer(
      frame(seq, content.pixels, {
        width: content.width,
        height: content.height,
      }),
    )
  }

  assert.equal(accepted.length, 1)
  assert.equal(pipeline.stats().gaps, 0)
})

test("a stable sidebar cannot pass initial admission while article text scrolls", () => {
  const accepted = []
  const pipeline = createCapturePipeline({
    onCandidate: (candidate) => accepted.push(candidate),
    now: () => 0,
    options: {
      initialSettleMs: 0,
      initialStableCoverage: 0.65,
      settleMs: 0,
      sampleIntervalMs: 100,
      initialMinInformativeTiles: 4,
    },
  })

  for (let seq = 1; seq <= 12; seq += 1) {
    const content = sidebarAndScrollingBody((seq - 1) * 4)
    pipeline.offer(
      frame(seq, content.pixels, {
        width: content.width,
        height: content.height,
      }),
    )
  }

  assert.equal(accepted.length, 0)
})

test("delayed or repeated sequence numbers cannot become fresh evidence", () => {
  const accepted = []
  const tracker = {
    observe: ({ seq }) => ({
      kind: "revision",
      shiftY: 0,
      confidence: 1,
      newRegions: [],
      reason: "audit",
      segment: 1,
      seq,
    }),
    reset() {},
    stats: () => ({}),
  }
  const pipeline = createCapturePipeline({
    onCandidate: (candidate) => accepted.push(candidate),
    now: () => 0,
    options: {
      tracker,
      initialCandidate: false,
      settleMs: 0,
      sampleIntervalMs: 100,
    },
  })
  const width = 48
  const height = 32
  const baseline = whiteFrame(width, height)
  const firstChange = Uint8Array.from(baseline)
  firstChange.set([0, 0, 0, 255], (10 * width + 10) * 4)
  const delayedChange = Uint8Array.from(firstChange)
  delayedChange.set([0, 0, 0, 255], (20 * width + 30) * 4)

  pipeline.offer(frame(10, baseline, { width: width, height: height }, 1000))
  pipeline.offer(frame(12, firstChange, { width: width, height: height }, 1100))
  pipeline.offer(frame(13, firstChange, { width: width, height: height }, 1200))
  pipeline.offer(
    frame(11, delayedChange, { width: width, height: height }, 1300),
  )
  pipeline.offer(
    frame(11, delayedChange, { width: width, height: height }, 1400),
  )

  assert.deepEqual(
    accepted.map(({ seq }) => seq),
    [13],
  )
  assert.equal(pipeline.stats().stale, 2)
})

test("a failed canvas encoding marker produces a gap instead of a candidate", () => {
  const accepted = []
  const tracker = {
    observe: () => ({
      kind: "initial",
      shiftY: null,
      confidence: 1,
      newRegions: [],
      reason: "audit",
      segment: 1,
    }),
    reset() {},
    stats: () => ({}),
  }
  const pipeline = createCapturePipeline({
    onCandidate: (candidate) => accepted.push(candidate),
    now: () => 0,
    options: {
      tracker,
      initialSettleMs: 0,
      settleMs: 0,
      sampleIntervalMs: 100,
    },
  })
  const width = 64
  const height = 64
  const pixels = whiteFrame(width, height)
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      pixels.set([0, 0, 0, 255], (y * width + x) * 4)
    }
  }
  const brokenEncoding = {
    ...frame(2, pixels, { width: width, height: height }),
    getDataUrl: () => "data:,",
  }

  pipeline.offer(frame(1, pixels, { width: width, height: height }))
  pipeline.offer(brokenEncoding)

  assert.equal(accepted.length, 0)
  assert.equal(pipeline.stats().gaps, 1)
})

test("a reduced comparison buffer cannot masquerade as full source detail", () => {
  const pipeline = createCapturePipeline()
  const content = oneLine()
  const result = pipeline.offer({
    ...frame(1, content.pixels, {
      width: content.width * 2,
      height: content.height * 2,
    }),
    thumbnailWidth: content.width,
    thumbnailHeight: content.height,
  })
  assert.equal(result.status, "gap")
  assert.equal(result.gap.reason, "malformed-pixels")
})
