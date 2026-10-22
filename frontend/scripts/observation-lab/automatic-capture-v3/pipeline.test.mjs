import assert from "node:assert/strict"
import test from "node:test"
import { createCapturePipeline } from "./pipeline.mjs"

const WIDTH = 48
const HEIGHT = 32
const ENCODED_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="
const frame = (seq, pixels, options = {}) => ({
  seq,
  generation: options.generation ?? 1,
  ownerChat: options.ownerChat ?? "chat-a",
  capturedAt: options.capturedAt ?? seq * 100,
  width: options.width ?? WIDTH,
  height: options.height ?? HEIGHT,
  pixels,
  frameCounter: options.frameCounter,
  getDataUrl: options.getDataUrl ?? (() => ENCODED_PNG),
})

const solid = (value = 180, width = WIDTH, height = HEIGHT) => {
  const pixels = new Uint8Array(width * height * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels.set([value, value, value, 255], offset)
  }
  return pixels
}

const changeRect = (
  source,
  { x, y, width, height, value, imageWidth = WIDTH },
) => {
  const pixels = Uint8Array.from(source)
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      pixels.set([value, value, value, 255], (row * imageWidth + column) * 4)
    }
  }
  return pixels
}

const textured = (height = HEIGHT) => {
  const pixels = new Uint8Array(WIDTH * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const value = (x * 19 + y * 31 + x * y * 7) & 255
      pixels.set([value, value, value, 255], (y * WIDTH + x) * 4)
    }
  }
  return pixels
}

const scrollByRows = (source, shift, sequence) => {
  const pixels = new Uint8Array(source.length)
  const rowsToCopy = HEIGHT - shift
  pixels.set(source.subarray(shift * WIDTH * 4, HEIGHT * WIDTH * 4))
  for (let y = rowsToCopy; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const value = (x * 13 + y * 23 + sequence * 41) & 255
      pixels.set([value, value, value, 255], (y * WIDTH + x) * 4)
    }
  }
  return pixels
}

const sparseArticle = (shift) => {
  let pixels = solid(255)
  pixels = changeRect(pixels, { x: 4, y: 5, width: 20, height: 3, value: 20 })
  for (let line = 0; line < 5; line += 1) {
    const y = 20 + line * 6 - shift
    if (y < 16 || y + 1 >= HEIGHT) continue
    for (let x = 5; x < WIDTH - 5; x += 5) {
      pixels = changeRect(pixels, {
        x: x,
        y: y,
        width: 3,
        height: 1,
        value: 20,
      })
    }
  }
  return pixels
}

const testTracker = () => ({
  observe: ({ seq }) => ({
    kind: seq === 1 ? "initial" : "revision",
    shiftY: 0,
    confidence: 1,
    newRegions: [],
    reason: null,
    segment: 1,
  }),
  reset: () => {},
  stats: () => ({}),
})

const pipelineFor = ({
  accepted = [],
  gaps = [],
  clock = { value: 0 },
  options = {},
} = {}) =>
  createCapturePipeline({
    onCandidate: (candidate) => accepted.push(candidate),
    onGap: (gap) => gaps.push(gap),
    now: () => clock.value,
    options: {
      tracker: testTracker(),
      initialSettleMs: 200,
      settleMs: 100,
      sampleIntervalMs: 100,
      ...options,
    },
  })

test("admits a stable initial frame and suppresses identical accepted full pixels", () => {
  const accepted = []
  const clock = { value: 0 }
  const pipeline = pipelineFor({ accepted, clock })
  const pixels = textured()
  assert.equal(pipeline.offer(frame(1, pixels)).status, "baseline")
  clock.value = 100
  assert.equal(pipeline.offer(frame(2, pixels)).status, "observing")
  clock.value = 200
  const first = pipeline.offer(frame(3, pixels))
  assert.equal(first.status, "accepted-initial")
  assert.equal(first.candidate.dataUrl, ENCODED_PNG)
  clock.value = 300
  assert.equal(pipeline.offer(frame(4, pixels)).status, "duplicate")
  assert.equal(accepted.length, 1)
})

test("admits a persistent two-pixel digit change without a thumbnail or area veto", () => {
  const accepted = []
  const clock = { value: 0 }
  const pipeline = pipelineFor({
    accepted,
    clock,
    options: { initialCandidate: false },
  })
  const base = textured()
  pipeline.offer(frame(1, base))
  const digit = changeRect(base, {
    x: 21,
    y: 13,
    width: 2,
    height: 3,
    value: 255,
  })
  clock.value = 100
  assert.equal(pipeline.offer(frame(2, digit)).status, "observing")
  clock.value = 200
  const first = pipeline.offer(frame(3, digit))
  assert.equal(first.status, "accepted")
  clock.value = 300
  const result = pipeline.offer(frame(4, digit))
  assert.equal(result.status, "duplicate")
  assert.equal(first.candidate.seq, 3)
  assert.equal(first.candidate.observation.kind, "revision")
  assert.equal(accepted.length, 1)
})

test("does not admit one-frame pixel noise", () => {
  const accepted = []
  const clock = { value: 0 }
  const pipeline = pipelineFor({
    accepted,
    clock,
    options: { initialCandidate: false },
  })
  const base = solid()
  pipeline.offer(frame(1, base))
  const noisy = changeRect(base, {
    x: 11,
    y: 9,
    width: 1,
    height: 1,
    value: 255,
  })
  clock.value = 100
  pipeline.offer(frame(2, noisy))
  clock.value = 200
  pipeline.offer(frame(3, base))
  clock.value = 300
  assert.equal(pipeline.offer(frame(4, base)).status, "duplicate")
  assert.equal(accepted.length, 0)
})

test("settles changed text while a separate region keeps animating", () => {
  const accepted = []
  const clock = { value: 0 }
  const pipeline = pipelineFor({
    accepted,
    clock,
    options: { initialCandidate: false },
  })
  let pixels = textured()
  pipeline.offer(frame(1, pixels))
  const text = changeRect(pixels, {
    x: 23,
    y: 15,
    width: 2,
    height: 3,
    value: 255,
  })
  for (let seq = 2; seq <= 5; seq += 1) {
    pixels = changeRect(text, {
      x: 1,
      y: 1,
      width: 4,
      height: 4,
      value: seq % 2 ? 20 : 240,
    })
    clock.value = seq * 100
    const result = pipeline.offer(frame(seq, pixels))
    if (seq === 3) assert.equal(result.status, "accepted")
  }
  assert.equal(accepted.length, 1)
})

test("captures an initially readable viewport while one separate tile animates", () => {
  const accepted = []
  const clock = { value: 0 }
  const pipeline = pipelineFor({ accepted, clock })
  const base = textured()
  pipeline.offer(frame(1, base))
  for (let seq = 2; seq <= 4; seq += 1) {
    const animation = changeRect(base, {
      x: 1,
      y: 1,
      width: 4,
      height: 4,
      value: seq % 2 ? 20 : 240,
    })
    clock.value = seq * 100
    const result = pipeline.offer(frame(seq, animation))
    if (seq === 2) assert.equal(result.status, "accepted-initial")
  }
  assert.equal(accepted.length, 1)
  assert.equal(accepted[0].seq, 2)
})

test("keeps unsettled scrolling frames out of tracker admission and avoids early candidates", () => {
  const observations = []
  const accepted = []
  const tracker = {
    observe: ({ seq }) => {
      observations.push(seq)
      return {
        kind: "overlap",
        shiftY: 24,
        confidence: 0.8,
        newRegions: [{ top: 8, bottom: 24 }],
        reason: "matched",
        segment: 1,
      }
    },
    reset: () => {},
    stats: () => ({}),
  }
  const pipeline = createCapturePipeline({
    onCandidate: (candidate) => accepted.push(candidate),
    options: { tracker, sampleIntervalMs: 100, settleMs: 100 },
  })
  const source = textured(HEIGHT + 48)
  pipeline.offer(frame(1, source.subarray(0, WIDTH * HEIGHT * 4)))
  for (let seq = 2; seq <= 5; seq += 1) {
    const pixels = scrollByRows(
      source.subarray(0, WIDTH * HEIGHT * 4),
      seq * 4,
      seq,
    )
    const result = pipeline.offer(frame(seq, pixels))
    assert.notEqual(result.status, "duplicate")
  }
  assert.deepEqual(observations, [])
  assert.equal(accepted.length, 0)
})

test("a sticky header and moving sparse article text do not settle as initial coverage", () => {
  const accepted = []
  const clock = { value: 0 }
  const pipeline = pipelineFor({ accepted, clock })
  pipeline.offer(frame(1, sparseArticle(0)))
  for (let seq = 2; seq <= 6; seq += 1) {
    clock.value = seq * 100
    const result = pipeline.offer(frame(seq, sparseArticle((seq - 1) * 3)))
    assert.notEqual(result.status, "accepted-initial")
  }
  assert.equal(accepted.length, 0)
})

test("passes full received pixels to the tracker only after initial settling", () => {
  const seen = []
  const clock = { value: 0 }
  const tracker = {
    observe: (observation) => {
      assert.ok(observation.pixels instanceof Uint8ClampedArray)
      seen.push({
        seq: observation.seq,
        width: observation.width,
        height: observation.height,
      })
      return {
        kind: "initial",
        shiftY: null,
        confidence: 1,
        newRegions: [],
        reason: "fixture",
        segment: 1,
      }
    },
    reset: () => {},
    stats: () => ({ observations: seen.length }),
  }
  const pipeline = createCapturePipeline({
    now: () => clock.value,
    options: {
      tracker,
      initialSettleMs: 200,
      settleMs: 100,
      sampleIntervalMs: 100,
    },
  })
  pipeline.offer(frame(1, textured()))
  clock.value = 100
  pipeline.offer(frame(2, textured()))
  clock.value = 200
  pipeline.offer(frame(3, textured()))
  assert.deepEqual(seen, [{ seq: 3, width: WIDTH, height: HEIGHT }])
  assert.equal(pipeline.stats().tracker.observations, 1)
})

test("a settled revisit is forwarded as a candidate with its tracker result", () => {
  const accepted = []
  const clock = { value: 0 }
  const tracker = {
    observe: ({ seq }) => ({
      kind: seq === 3 ? "revisit" : "initial",
      shiftY: 0,
      confidence: 1,
      newRegions: [],
      reason: "recent-frame",
      segment: 1,
    }),
    reset: () => {},
    stats: () => ({}),
  }
  const pipeline = createCapturePipeline({
    onCandidate: (candidate) => accepted.push(candidate),
    now: () => clock.value,
    options: {
      tracker,
      initialCandidate: false,
      sampleIntervalMs: 100,
      settleMs: 100,
    },
  })
  const base = solid()
  pipeline.offer(frame(1, base))
  const revisit = changeRect(base, {
    x: 12,
    y: 10,
    width: 3,
    height: 2,
    value: 250,
  })
  clock.value = 100
  pipeline.offer(frame(2, revisit))
  clock.value = 200
  const result = pipeline.offer(frame(3, revisit))
  assert.equal(result.status, "accepted")
  assert.equal(result.candidate.observation.kind, "revisit")
  assert.equal(accepted.length, 1)
})

test("a stalled stream frame counter does not create another candidate", () => {
  const accepted = []
  const clock = { value: 0 }
  const pipeline = pipelineFor({
    accepted,
    clock,
    options: { initialCandidate: false, settleMs: 0 },
  })
  const base = solid()
  pipeline.offer(frame(1, base, { frameCounter: 10 }))
  const changed = changeRect(base, {
    x: 12,
    y: 12,
    width: 3,
    height: 3,
    value: 250,
  })
  clock.value = 100
  pipeline.offer(frame(2, changed, { frameCounter: 11 }))
  clock.value = 200
  pipeline.offer(frame(3, changed, { frameCounter: 11 }))
  assert.equal(accepted.length, 0)
  assert.equal(pipeline.stats().offers, 3)
})

test("resets on dimensions and owner changes, while rejecting older generations", () => {
  const gaps = []
  const pipeline = pipelineFor({ gaps, options: { initialCandidate: false } })
  pipeline.offer(frame(1, solid()))
  assert.equal(
    pipeline.offer(frame(2, solid(), { generation: 0 })).status,
    "stale",
  )
  const resized = frame(3, solid(180, 24, 16), { width: 24, height: 16 })
  assert.equal(pipeline.offer(resized).status, "baseline")
  const otherOwner = frame(4, solid(180, 24, 16), {
    width: 24,
    height: 16,
    ownerChat: "chat-b",
  })
  assert.equal(pipeline.offer(otherOwner).status, "baseline")
  assert.deepEqual(
    gaps.map(({ reason }) => reason),
    ["dimensions-changed", "owner-changed"],
  )
})

test("reports malformed and oversized frames as explicit gaps", () => {
  const gaps = []
  const pipeline = pipelineFor({
    gaps,
    options: { maxSourcePixels: WIDTH * HEIGHT },
  })
  assert.equal(
    pipeline.offer(frame(1, new Uint8Array(4))).gap.reason,
    "malformed-pixels",
  )
  assert.equal(
    pipeline.offer(
      frame(2, solid(180, WIDTH + 1, HEIGHT), { width: WIDTH + 1 }),
    ).gap.reason,
    "oversize",
  )
  assert.deepEqual(
    gaps.map(({ reason }) => reason),
    ["malformed-pixels", "oversize"],
  )
})

test("rejects invalid or backwards capture timestamps with gaps", () => {
  const gaps = []
  const pipeline = pipelineFor({ gaps, options: { initialCandidate: false } })
  pipeline.offer(frame(1, solid(), { capturedAt: 200 }))
  assert.equal(
    pipeline.offer(frame(2, solid(), { capturedAt: 100 })).gap.reason,
    "backwards-timestamp",
  )
  assert.equal(
    pipeline.offer(frame(3, solid(), { capturedAt: "nope" })).gap.reason,
    "invalid-timestamp",
  )
  assert.deepEqual(
    gaps.map(({ reason }) => reason),
    ["backwards-timestamp", "invalid-timestamp"],
  )
})

test("reports replaced pending evidence and returns only the latest candidate", () => {
  const gaps = []
  const clock = { value: 0 }
  const pipeline = pipelineFor({
    gaps,
    clock,
    options: { initialCandidate: false, settleMs: 0 },
  })
  const base = solid()
  pipeline.offer(frame(1, base))
  const a = changeRect(base, { x: 8, y: 8, width: 3, height: 3, value: 255 })
  clock.value = 100
  pipeline.offer(frame(2, a))
  clock.value = 200
  assert.equal(pipeline.offer(frame(3, a)).status, "accepted")
  const b = changeRect(a, { x: 37, y: 20, width: 3, height: 3, value: 10 })
  clock.value = 300
  pipeline.offer(frame(4, b))
  clock.value = 400
  assert.equal(pipeline.offer(frame(5, b)).status, "pending-replaced")
  assert.equal(gaps[0].reason, "pending-replaced")
  assert.equal(pipeline.takePending().seq, 5)
  assert.equal(pipeline.takePending(), undefined)
})

test("clearing a pipeline reports a pending candidate as a coverage gap", () => {
  const gaps = []
  const clock = { value: 0 }
  const pipeline = pipelineFor({
    gaps,
    clock,
    options: { initialCandidate: false, settleMs: 0 },
  })
  const base = solid()
  pipeline.offer(frame(1, base))
  const changed = changeRect(base, {
    x: 20,
    y: 12,
    width: 3,
    height: 3,
    value: 255,
  })
  clock.value = 100
  pipeline.offer(frame(2, changed))
  clock.value = 200
  pipeline.offer(frame(3, changed))
  assert.equal(
    pipeline.clear({ nextGeneration: 2 }).gap.reason,
    "pending-cleared",
  )
  assert.equal(pipeline.takePending(), undefined)
  assert.equal(gaps.at(-1).seq, 3)
})

test("stats bound source buffers and tracker anchors, and clear releases both", () => {
  const pixels = textured()
  const pipeline = createCapturePipeline({
    now: () => 0,
    options: { initialSettleMs: 0, settleMs: 0, sampleIntervalMs: 100 },
  })
  pipeline.offer(frame(1, pixels))
  pipeline.offer(frame(2, pixels))
  const retained = pipeline.stats()
  assert.equal(retained.retainedPixelBytes, pixels.byteLength * 2)
  assert.ok(retained.tracker.anchorBytes > 0)
  assert.equal(retained.pending, 1)
  pipeline.clear()
  const cleared = pipeline.stats()
  assert.equal(cleared.retainedPixelBytes, 0)
  assert.equal(cleared.tracker.anchorBytes, 0)
  assert.equal(cleared.pending, 0)
})

test("encoding and callback failures become gaps without corrupting accepted state", () => {
  const gaps = []
  let throwCandidate = true
  const pipeline = createCapturePipeline({
    onCandidate: () => {
      if (throwCandidate) throw new Error("consumer failed")
    },
    onGap: (gap) => gaps.push(gap),
    options: { tracker: testTracker(), initialCandidate: false, settleMs: 0 },
  })
  const base = solid()
  pipeline.offer(frame(1, base))
  const changed = changeRect(base, {
    x: 20,
    y: 14,
    width: 3,
    height: 3,
    value: 255,
  })
  pipeline.offer(frame(2, changed))
  const failed = pipeline.offer(
    frame(3, changed, {
      getDataUrl: () => {
        throw new Error("encode failed")
      },
    }),
  )
  assert.equal(failed.status, "gap")
  assert.equal(failed.gap.reason, "encoding-failed")
  throwCandidate = false
  pipeline.offer(frame(4, changed))
  const nextChange = changeRect(changed, {
    x: 36,
    y: 20,
    width: 3,
    height: 3,
    value: 10,
  })
  pipeline.offer(frame(5, nextChange))
  throwCandidate = true
  const callbackFailure = pipeline.offer(frame(6, nextChange))
  assert.equal(callbackFailure.status, "pending-replaced")
  assert.equal(pipeline.offer(frame(7, nextChange)).status, "duplicate")
  assert.equal(pipeline.stats().accepted, 2)
  assert.equal(gaps[0].reason, "encoding-failed")
  assert.equal(gaps[1].reason, "pending-replaced")
  assert.equal(gaps[2].reason, "candidate-callback-failed")
})
