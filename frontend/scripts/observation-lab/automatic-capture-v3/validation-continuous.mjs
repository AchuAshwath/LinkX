import fs from "node:fs/promises"
import { createCapturePipeline } from "./pipeline.mjs"

const width = 640
const height = 360
const scrollStartMs = 1000
const durationMs = 12_000
const sampleMs = 250
const rowsPerViewport = height
const imageDataUrl = "data:image/png;base64,AA=="
const accepted = []
const statuses = []
const gaps = []
let clock = 0

const pipeline = createCapturePipeline({
  now: () => clock,
  onCandidate: (candidate) => accepted.push(candidate),
  onGap: (gap) => gaps.push(gap),
  options: { sampleIntervalMs: 100, initialSettleMs: 600, settleMs: 300 },
})

for (
  let time = 0, seq = 0;
  time <= scrollStartMs + durationMs + 1000;
  time += sampleMs, seq += 1
) {
  clock = time
  const elapsedMotion = Math.min(durationMs, Math.max(0, time - scrollStartMs))
  const scrollY = Math.round((20 * elapsedMotion) / 80)
  const pixels = renderArticle(width, height, scrollY)
  const result = pipeline.offer({
    seq,
    generation: 1,
    ownerChat: "continuous-scroll-validation",
    capturedAt: time,
    width,
    height,
    pixels,
    getDataUrl: () => imageDataUrl,
  })
  statuses.push({ time, scrollY, status: result.status })
  pipeline.takePending()
}

const motionCandidates = accepted.filter(
  (item) =>
    item.capturedAt > scrollStartMs &&
    item.capturedAt <= scrollStartMs + durationMs,
)
const acceptedScrolls = motionCandidates.map((item) => ({
  time: item.capturedAt - scrollStartMs,
  scrollY: Math.round((20 * (item.capturedAt - scrollStartMs)) / 80),
}))
const coveredRows = unionLength(
  acceptedScrolls.map(({ scrollY }) => [scrollY, scrollY + rowsPerViewport]),
)
const report = {
  fixture:
    "synthetic readable article, 640x360 RGBA, 20 CSS px / 80 ms continuous scroll",
  sampling: {
    sampleMs,
    initialSettleMs: scrollStartMs,
    motionDurationMs: durationMs,
    cssPixelsPerSecond: 250,
  },
  initialCandidate: accepted.some((item) => item.capturedAt <= scrollStartMs),
  acceptedDuringMotion: motionCandidates.length,
  acceptedScrolls,
  acceptedCoveredViewportHeights: coveredRows / height,
  statuses: summarizeStatuses(
    statuses.filter(
      (entry) =>
        entry.time > scrollStartMs && entry.time <= scrollStartMs + durationMs,
    ),
  ),
  initialStatuses: statuses.filter((entry) => entry.time <= scrollStartMs),
  finalStatuses: statuses.filter(
    (entry) => entry.time > scrollStartMs + durationMs,
  ),
  finalSettleAccepted: accepted.some(
    (item) => item.capturedAt > scrollStartMs + durationMs,
  ),
  stats: pipeline.stats(),
  gaps,
}
await fs.writeFile(
  "/tmp/linkx-capture-v3-continuous.json",
  JSON.stringify(report, null, 2),
)
console.log(JSON.stringify(report, null, 2))

function renderArticle(frameWidth, frameHeight, scrollY) {
  const pixels = new Uint8Array(frameWidth * frameHeight * 4)
  pixels.fill(255)
  for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255
  const lineHeight = 24
  const firstLine = Math.floor(scrollY / lineHeight)
  const lastLine = Math.ceil((scrollY + frameHeight) / lineHeight)
  for (let line = firstLine; line <= lastLine; line += 1) {
    const y = line * lineHeight - scrollY + 3
    drawTextLine({ pixels, frameWidth, frameHeight, y, line })
  }
  return pixels
}

function drawTextLine({ pixels, frameWidth, frameHeight, y, line }) {
  const lineWidth = frameWidth - 56 - ((line * 37) % 110)
  let x = 28
  let word = 0
  while (x < lineWidth) {
    const wordWidth = 18 + ((line * 19 + word * 31) % 63)
    drawWord({ pixels, frameWidth, frameHeight, x, y, line, word, wordWidth })
    x += wordWidth + 10
    word += 1
  }
}

function drawWord({
  pixels,
  frameWidth,
  frameHeight,
  x,
  y,
  line,
  word,
  wordWidth,
}) {
  const glyphs = Math.max(2, Math.floor(wordWidth / 7))
  for (let glyph = 0; glyph < glyphs; glyph += 1) {
    drawGlyph({
      pixels,
      frameWidth,
      frameHeight,
      x: x + glyph * 7,
      y,
      line,
      word,
      glyph,
    })
  }
}

function drawGlyph({
  pixels,
  frameWidth,
  frameHeight,
  x,
  y,
  line,
  word,
  glyph,
}) {
  const seed = line * 97 + word * 43 + glyph * 17
  const glyphHeight = 9 + ((line + glyph) % 4)
  for (let gy = 0; gy < glyphHeight; gy += 1) {
    for (let gx = 0; gx < 5; gx += 1) {
      if (glyphPixel(seed, gx, gy)) {
        setPixel({
          pixels,
          frameWidth,
          frameHeight,
          x: x + gx,
          y: y + gy,
          value: 34,
        })
      }
    }
  }
}

function glyphPixel(seed, x, y) {
  const edge = x === 0 || x === 4 || y === 0 || y === 10
  return (edge && (seed + x + y) % 3 !== 0) || (seed + x * 5 + y * 11) % 7 === 0
}

function setPixel({ pixels, frameWidth, frameHeight, x, y, value }) {
  if (x < 0 || y < 0 || x >= frameWidth || y >= frameHeight) return
  const offset = (y * frameWidth + x) * 4
  pixels[offset] = value
  pixels[offset + 1] = value
  pixels[offset + 2] = value
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
      continue
    }
    if (nextStart <= end) {
      end = Math.max(end, nextEnd)
      continue
    }
    covered += end - start
    start = nextStart
    end = nextEnd
  }
  return start === null ? covered : covered + end - start
}

function summarizeStatuses(entries) {
  return entries.reduce((summary, entry) => {
    summary[entry.status] = (summary[entry.status] ?? 0) + 1
    return summary
  }, {})
}
