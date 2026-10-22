import assert from "node:assert/strict"
import test from "node:test"
import { createCapturePipeline } from "./pipeline.mjs"

const WIDTH = 640
const HEIGHT = 360
const PNG = "data:image/png;base64,AA=="
const frame = (seq, pixels, capturedAt) => ({
  seq,
  generation: 1,
  ownerChat: "motion-test",
  capturedAt,
  width: WIDTH,
  height: HEIGHT,
  pixels,
  getDataUrl: () => PNG,
})

test("captures readable continuous scrolls with bounded motion probes", () => {
  const capture = setupPipeline()
  offerStaticInitial(capture)
  for (let time = 1000, seq = 4; time <= 13000; time += 250, seq += 1) {
    const scrollY = Math.round((20 * (time - 1000)) / 80)
    capture.offer(seq, time, renderArticle(scrollY))
  }
  const motionCandidates = capture.candidates.filter(
    (candidate) => candidate.capturedAt > 1000 && candidate.capturedAt <= 13000,
  )
  const intervals = motionCandidates
    .slice(1)
    .map(
      (candidate, index) =>
        candidate.capturedAt - motionCandidates[index].capturedAt,
    )
  const coveredRows = unionLength(
    motionCandidates.map((candidate) => {
      const scrollY = Math.round((20 * (candidate.capturedAt - 1000)) / 80)
      return [scrollY, scrollY + HEIGHT]
    }),
  )

  assert.ok(
    motionCandidates.length >= 4,
    `captured ${motionCandidates.length} motion frames`,
  )
  assert.ok(intervals.every((interval) => interval >= 1000))
  assert.ok(
    coveredRows >= HEIGHT * 4,
    `covered ${coveredRows / HEIGHT} viewports`,
  )
  assert.ok(
    motionCandidates.every(
      (candidate) => candidate.admission === "coherent-scroll",
    ),
  )
  assert.ok(motionCandidates.every((candidate) => candidate.motion.shiftY >= 2))
  assert.ok(capture.pipeline.stats().motion.probeAttempts <= 13)
  assert.ok(capture.pipeline.stats().motion.maxProbeAnchorBytes <= 256 * 1024)
})

test("uses coherent motion for an initial viewport that is already scrolling", () => {
  const capture = setupPipeline()
  for (let time = 0, seq = 0; time <= 2000; time += 250, seq += 1) {
    capture.offer(seq, time, renderArticle(Math.round((20 * time) / 80)))
  }

  assert.ok(capture.candidates.length > 0)
  assert.equal(capture.candidates[0].admission, "coherent-scroll")
  assert.ok(capture.candidates[0].capturedAt >= 600)
})

test("rejects large discontinuous joins that have too little viewport overlap", () => {
  const capture = setupPipeline()
  offerStaticInitial(capture)
  capture.offer(4, 1000, renderArticle(0))
  capture.offer(5, 1250, renderArticle(0))
  capture.offer(6, 1500, renderArticle(0))
  capture.offer(7, 1750, renderArticle(0))
  capture.offer(8, 2000, renderArticle(800))

  assert.equal(
    capture.candidates.some(
      (candidate) => candidate.admission === "coherent-scroll",
    ),
    false,
  )
  const probes = capture.pipeline.stats().motion.recentProbes
  assert.ok(probes.length > 0)
  assert.ok(probes.some((probe) => probe.reason === "no-confident-overlap"))
})

test("does not badge same-position label changes or unrelated scenes as scrolling", () => {
  const capture = setupPipeline()
  offerStaticInitial(capture)
  let seq = 4
  for (let time = 1000; time <= 3500; time += 250) {
    const pixels = renderArticle(0)
    drawLabel(pixels, time % 500 === 0 ? 20 : 230)
    capture.offer(seq++, time, pixels)
  }
  for (let time = 3750; time <= 5750; time += 250) {
    capture.offer(seq++, time, renderNoise(time))
  }

  assert.equal(
    capture.candidates.some(
      (candidate) => candidate.admission === "coherent-scroll",
    ),
    false,
  )
  assert.ok(capture.pipeline.stats().motion.probeAttempts > 0)
})

test("rejects a blurred moving viewport and releases probe memory on clear", () => {
  const capture = setupPipeline()
  offerStaticInitial(capture)
  let seq = 4
  for (let time = 1000; time <= 3000; time += 250) {
    const sharp = renderArticle(Math.round((20 * (time - 1000)) / 80))
    capture.offer(seq++, time, blur(sharp))
  }

  const beforeClear = capture.pipeline.stats()
  assert.ok(beforeClear.motion.qualityRejected > 0)
  assert.equal(
    capture.candidates.some(
      (candidate) => candidate.admission === "coherent-scroll",
    ),
    false,
  )
  capture.pipeline.clear()
  const stats = capture.pipeline.stats()
  assert.equal(stats.pending, 0)
  assert.equal(stats.retainedPixelBytes, 0)
  assert.equal(stats.motion.probeAnchorBytes, 0)
})

function setupPipeline(options = {}) {
  const candidates = []
  const clock = { value: 0 }
  const pipeline = createCapturePipeline({
    now: () => clock.value,
    onCandidate: (candidate) => candidates.push(candidate),
    options: {
      initialSettleMs: 600,
      settleMs: 300,
      sampleIntervalMs: 100,
      ...options,
    },
  })
  return {
    candidates,
    pipeline,
    offer(seq, time, pixels) {
      clock.value = time
      const result = pipeline.offer(frame(seq, pixels, time))
      pipeline.takePending()
      return result
    },
  }
}

function offerStaticInitial(capture) {
  for (let time = 0, seq = 0; time <= 750; time += 250, seq += 1) {
    capture.offer(seq, time, renderArticle(0))
  }
  assert.equal(capture.candidates[0]?.admission, undefined)
}

function renderArticle(scrollY) {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4)
  pixels.fill(255)
  for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255
  drawStaticFurniture(pixels)
  const lineHeight = 24
  const firstLine = Math.floor(scrollY / lineHeight)
  const lastLine = Math.ceil((scrollY + HEIGHT) / lineHeight)
  for (let line = firstLine; line <= lastLine; line += 1) {
    drawTextLine(pixels, line * lineHeight - scrollY + 29, line)
  }
  return pixels
}

function drawStaticFurniture(pixels) {
  for (let y = 30; y < HEIGHT - 12; y += 18) {
    drawSidebarRow(pixels, y)
  }
  for (let x = 36; x < WIDTH - 24; x += 8) {
    drawHeaderMark(pixels, x)
  }
}

function drawSidebarRow(pixels, y) {
  for (let x = 8; x < 20; x += 1) {
    if ((x + y) % 4 < 2) setGray(pixels, x, y, 58)
  }
}

function drawHeaderMark(pixels, x) {
  const markWidth = 2 + ((x / 8) % 3)
  for (let y = 8; y < 17; y += 1) {
    for (let dx = 0; dx < markWidth; dx += 1) {
      setGray(pixels, x + dx, y, 54)
    }
  }
}

function drawTextLine(pixels, y, line) {
  const lineWidth = WIDTH - 56 - ((line * 37) % 110)
  let x = 28
  let word = 0
  while (x < lineWidth) {
    const wordWidth = 18 + ((line * 19 + word * 31) % 63)
    drawWord({ pixels, x, y, line, word, wordWidth })
    x += wordWidth + 10
    word += 1
  }
}

function drawWord({ pixels, x, y, line, word, wordWidth }) {
  const glyphs = Math.max(2, Math.floor(wordWidth / 7))
  for (let glyph = 0; glyph < glyphs; glyph += 1) {
    drawGlyph({ pixels, x: x + glyph * 7, y, line, word, glyph })
  }
}

function drawGlyph({ pixels, x, y, line, word, glyph }) {
  const seed = line * 97 + word * 43 + glyph * 17
  const glyphHeight = 9 + ((line + glyph) % 4)
  for (let gy = 0; gy < glyphHeight; gy += 1) {
    for (let gx = 0; gx < 5; gx += 1) {
      if (isGlyphInk(seed, gx, gy)) setGray(pixels, x + gx, y + gy, 34)
    }
  }
}

const isGlyphInk = (seed, x, y) => {
  const edge = x === 0 || x === 4 || y === 0 || y === 10
  return (edge && (seed + x + y) % 3 !== 0) || (seed + x * 5 + y * 11) % 7 === 0
}

function drawLabel(pixels, value) {
  for (let y = 18; y < 50; y += 1) {
    for (let x = 16; x < 188; x += 1) {
      if ((x + y) % 5 < 2) setGray(pixels, x, y, value)
    }
  }
}

function renderNoise(seed) {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4)
  let state = seed | 0
  for (let offset = 0; offset < pixels.length; offset += 4) {
    state = (Math.imul(state, 1664525) + 1013904223) | 0
    const value = state >>> 24
    pixels.set([value, value, value, 255], offset)
  }
  return pixels
}

function blur(source) {
  const output = new Uint8Array(source.length)
  for (let y = 1; y < HEIGHT - 1; y += 1) {
    for (let x = 1; x < WIDTH - 1; x += 1) {
      setGray(output, x, y, blurredPixel(source, x, y))
    }
  }
  for (let offset = 3; offset < output.length; offset += 4) output[offset] = 255
  return output
}

function blurredPixel(source, x, y) {
  let total = 0
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      total += source[((y + dy) * WIDTH + x + dx) * 4]
    }
  }
  return Math.round(total / 9)
}

function setGray(pixels, x, y, value) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return
  const offset = (y * WIDTH + x) * 4
  pixels[offset] = value
  pixels[offset + 1] = value
  pixels[offset + 2] = value
  pixels[offset + 3] = 255
}

function unionLength(intervals) {
  const sorted = intervals.toSorted(([left], [right]) => left - right)
  let covered = 0
  let start = null
  let end = null
  for (const [nextStart, nextEnd] of sorted) {
    if (start === null) {
      start = nextStart
      end = nextEnd
    } else if (nextStart <= end) {
      end = Math.max(end, nextEnd)
    } else {
      covered += end - start
      start = nextStart
      end = nextEnd
    }
  }
  return start === null ? covered : covered + end - start
}
