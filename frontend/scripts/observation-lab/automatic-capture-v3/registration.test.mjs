import assert from "node:assert/strict"
import test from "node:test"
import { createViewportTracker } from "./registration.mjs"

const texture = (x, y, salt = 0) => {
  let value =
    Math.imul(x + 17 + salt, 0x45d9f3b) ^ Math.imul(y + 31, 0x119de1f3)
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  return (value ^ (value >>> 16)) & 255
}

const viewport = ({
  seq,
  y = 0,
  width = 240,
  height = 180,
  generation = 1,
  ownerChat = "chat-a",
  render,
} = {}) => {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const value = render ? render(column, row, y) : texture(column, row + y)
      const index = (row * width + column) * 4
      pixels[index] = value
      pixels[index + 1] = value
      pixels[index + 2] = value
      pixels[index + 3] = 255
    }
  }
  return {
    pixels,
    width,
    height,
    seq,
    generation,
    ownerChat,
    capturedAt: seq * 100,
  }
}

const fillTextBackground = (pixels, width, height, darkTheme) => {
  const background = darkTheme ? [18, 22, 28] : [244, 241, 232]
  for (let index = 0; index < width * height * 4; index += 4) {
    pixels[index] = background[0]
    pixels[index + 1] = background[1]
    pixels[index + 2] = background[2]
    pixels[index + 3] = 255
  }
}

const hasGlyphAt = (lineY, glyph, column) =>
  lineY >= 11 && lineY < 23 && ((glyph >>> ((column + lineY) % 15)) & 1) === 1

const paintGlyph = ({ pixels, width, row, column, glyph, inkColor }) => {
  const inkWidth = glyph & 2 ? 2 : 1
  for (let dx = 0; dx < inkWidth; dx += 1) {
    const x = column + dx
    if (x < width) pixels[(row * width + x) * 4] = inkColor
  }
}

const paintTextRow = (pixels, settings, row, inkColor) => {
  const documentY = row < settings.fixedHeadingHeight ? row : row + settings.y
  const line = Math.floor(documentY / 36)
  const lineY = documentY % 36
  const lastColumn = Math.min(
    settings.width - 24,
    settings.fixedSidebarWidth + 800,
  )
  for (
    let column = settings.fixedSidebarWidth + 40;
    column < lastColumn;
    column += 12
  ) {
    const glyph =
      Math.imul(column + line * 19 + settings.salt, 0x45d9f3b) ^
      Math.imul(lineY + settings.salt * 3, 0x119de1f3)
    if (hasGlyphAt(lineY, glyph, column)) {
      paintGlyph({
        pixels,
        width: settings.width,
        row,
        column,
        glyph,
        inkColor,
      })
    }
  }
}

const paintSidebarRow = (pixels, settings, row, inkColor) => {
  pixels[(row * settings.width + 12) * 4] = 0
  if (row % 36 >= 12) return
  for (
    let column = 20;
    column < settings.fixedSidebarWidth - 20;
    column += 12
  ) {
    if (texture(column, Math.floor(row / 36), 777) < 145) {
      pixels[(row * settings.width + column) * 4] = inkColor
    }
  }
}

const paintTextContent = (pixels, settings, darkTheme) => {
  const inkColor = darkTheme ? 245 : 25
  for (let row = 0; row < settings.height; row += 1) {
    paintTextRow(pixels, settings, row, inkColor)
  }
}

const paintSidebar = (pixels, settings, darkTheme) => {
  const inkColor = darkTheme ? 235 : 50
  for (let row = 0; row < settings.height; row += 1) {
    paintSidebarRow(pixels, settings, row, inkColor)
  }
}

const setOpaqueAlpha = (pixels) => {
  for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255
}

const textPage = ({
  seq,
  y = 0,
  width = 1440,
  height = 900,
  salt = 0,
  fixedSidebarWidth = 0,
  fixedHeadingHeight = 0,
  darkTheme = false,
} = {}) => {
  const settings = {
    y,
    width,
    height,
    salt,
    fixedSidebarWidth,
    fixedHeadingHeight,
  }
  const pixels = new Uint8ClampedArray(width * height * 4)
  fillTextBackground(pixels, width, height, darkTheme)
  paintTextContent(pixels, settings, darkTheme)
  if (fixedSidebarWidth) paintSidebar(pixels, settings, darkTheme)
  setOpaqueAlpha(pixels)
  return {
    pixels,
    width,
    height,
    seq,
    generation: 1,
    ownerChat: "text-chat",
    capturedAt: seq * 100,
  }
}

const paintNativeGlyph = ({ pixels, width, row, column, glyph }) => {
  const color = 25
  const glyphWidth = glyph & 2 ? 9 : 6
  for (let dx = 0; dx < glyphWidth; dx += 1) {
    const index = (row * width + column + dx) * 4
    pixels[index] = color
    pixels[index + 1] = color
    pixels[index + 2] = color
  }
}

const paintNativeTextRow = ({ pixels, width, row, y }) => {
  const documentY = row + y
  const line = Math.floor(documentY / 72)
  const lineY = documentY % 72
  if (lineY >= 46) return
  const lineWidth = Math.floor(
    (width * (60 + (texture(0, line, 19) % 40))) / 100,
  )
  for (let column = 160; column < lineWidth; column += 12) {
    const glyph = texture(column, line, 73)
    if (glyph < 190) {
      paintNativeGlyph({ pixels, width, row, column, glyph })
    }
  }
}

const nativeTextPage = ({ seq, y = 0, width = 2880, height = 1550 } = {}) => {
  const pixels = new Uint8ClampedArray(width * height * 4)
  fillTextBackground(pixels, width, height, false)
  for (let row = 0; row < height; row += 1) {
    paintNativeTextRow({ pixels, width, row, y })
  }
  return {
    pixels,
    width,
    height,
    seq,
    generation: 1,
    ownerChat: "native-chat",
    capturedAt: seq * 100,
  }
}

const paintThinNativeRow = ({ pixels, width, row, y }) => {
  const documentY = row + y
  if (documentY < 140) return
  const line = Math.floor((documentY - 140) / 52)
  const lineY = (documentY - 140) % 52
  if (lineY < 8 || lineY > 31) return
  const lineEnd = width - 400 - (texture(0, line, 811) % 240)
  for (let column = 480; column < lineEnd; column += 14) {
    const glyph = texture(column, line, 613)
    const strokeA = 8 + (glyph % 13)
    const strokeB = 20 + ((glyph >>> 3) % 9)
    if (lineY !== strokeA && lineY !== strokeB) continue
    const shade = 25 + (glyph % 5) * 8
    for (let dx = 0; dx < 7; dx += 1) {
      const index = (row * width + column + dx) * 4
      pixels[index] = shade
      pixels[index + 1] = shade
      pixels[index + 2] = shade
    }
  }
}

const thinNativeTextPage = ({
  seq,
  y = 0,
  width = 2880,
  height = 1550,
} = {}) => {
  const pixels = new Uint8ClampedArray(width * height * 4)
  fillTextBackground(pixels, width, height, false)
  for (let row = 0; row < height; row += 1) {
    paintThinNativeRow({ pixels, width, row, y })
  }
  return {
    pixels,
    width,
    height,
    seq,
    generation: 1,
    ownerChat: "thin-native-chat",
    capturedAt: seq * 100,
  }
}

const paintFixedTocRow = ({ pixels, width, row }) => {
  if (row < 100) return
  const line = Math.floor((row - 100) / 52)
  const lineY = (row - 100) % 52
  if (lineY < 12 || lineY > 30 || (lineY - 12) % 3 !== 0) return
  for (let column = width - 430; column < width - 40; column += 14) {
    const glyph = texture(column, line, 239)
    if (glyph > 210) continue
    const index = (row * width + column) * 4
    pixels[index] = 25
    pixels[index + 1] = 25
    pixels[index + 2] = 25
  }
}

const nativeArticlePage = ({ seq, y = 0, width = 2880, height = 1550 }) => {
  const pixels = new Uint8ClampedArray(width * height * 4)
  fillTextBackground(pixels, width, height, false)
  for (let row = 0; row < height; row += 1) {
    paintThinNativeRow({ pixels, width, row, y })
    paintFixedTocRow({ pixels, width, row })
  }
  return {
    pixels,
    width,
    height,
    seq,
    generation: 1,
    ownerChat: "native-article-chat",
    capturedAt: seq * 100,
  }
}

test("estimates a content scroll and reports only the newly exposed strip", () => {
  const tracker = createViewportTracker()
  const first = tracker.observe(viewport({ seq: 1, y: 0 }))
  const next = tracker.observe(viewport({ seq: 2, y: 45 }))

  assert.equal(first.kind, "initial")
  assert.equal(next.kind, "overlap")
  assert.ok(Math.abs(next.shiftY - 45) <= 6, `shift ${next.shiftY}`)
  assert.ok(next.confidence >= 0.7)
  assert.deepEqual(next.newRegions, [
    { x: 0, y: 180 - next.shiftY, width: 240, height: next.shiftY },
  ])
  assert.equal(next.segment, first.segment)
})

test("classifies a small same-position content edit as a revision", () => {
  const tracker = createViewportTracker()
  tracker.observe(viewport({ seq: 1 }))
  const changed = viewport({ seq: 2, render: (x, y) => texture(x, y) })
  const pixel = (91 * changed.width + 121) * 4
  changed.pixels[pixel] = 255 - changed.pixels[pixel]
  changed.pixels[pixel + 1] = 255 - changed.pixels[pixel + 1]
  changed.pixels[pixel + 2] = 255 - changed.pixels[pixel + 2]

  const result = tracker.observe(changed)

  assert.equal(result.kind, "revision")
  assert.equal(result.shiftY, 0)
  assert.deepEqual(result.newRegions, [])
})

test("recognizes a reverse exact revisit from a bounded recent anchor", () => {
  const tracker = createViewportTracker()
  const start = viewport({ seq: 1, y: 0 })
  tracker.observe(start)
  tracker.observe(viewport({ seq: 2, y: 45 }))

  const result = tracker.observe(viewport({ seq: 3, y: 0 }))

  assert.equal(result.kind, "revisit")
  assert.equal(result.shiftY, null)
  assert.equal(result.confidence, 0)
  assert.equal(result.visualEquality, true)
  assert.equal(result.matchedSequence, 1)
  assert.equal(result.reason, "identical-pixels-position-unknown")
  assert.equal(result.segment, 1)
})

test("keeps an identical periodic viewport geometrically unknown", () => {
  const tracker = createViewportTracker()
  const repeated = (x, y, scroll) => texture(x, (y + scroll) % 12)
  tracker.observe(viewport({ seq: 40, y: 0, render: repeated }))
  const result = tracker.observe(viewport({ seq: 41, y: 12, render: repeated }))

  assert.equal(result.kind, "revisit")
  assert.equal(result.shiftY, null)
  assert.equal(result.confidence, 0)
  assert.equal(result.visualEquality, true)
  assert.equal(result.matchedSequence, 40)
  assert.equal(result.reason, "identical-pixels-position-unknown")
})

test("uses a revisited viewport as the basis for the next relative estimate", () => {
  const tracker = createViewportTracker()
  tracker.observe(viewport({ seq: 1, y: 0 }))
  tracker.observe(viewport({ seq: 2, y: 45 }))
  assert.equal(tracker.observe(viewport({ seq: 3, y: 0 })).kind, "revisit")

  const next = tracker.observe(viewport({ seq: 4, y: 15 }))
  assert.equal(next.kind, "overlap")
  assert.ok(Math.abs(next.shiftY - 15) <= 1)
})

test("rejects repeated row patterns and stationary header disagreement", () => {
  const repeated = (x, y, scroll) => texture(x, (y + scroll) % 12)
  const tracker = createViewportTracker()
  tracker.observe(viewport({ seq: 1, render: repeated }))
  const ambiguous = tracker.observe(
    viewport({ seq: 2, y: 6, render: repeated }),
  )
  assert.equal(ambiguous.kind, "unaligned")
  assert.equal(ambiguous.reason, "ambiguous-overlap")
  assert.equal(ambiguous.segment, 2)

  const fixedHeader = (x, y, scroll) =>
    y < 120 ? texture(x, y, 30) : texture(x, y + scroll)
  const sticky = createViewportTracker()
  sticky.observe(viewport({ seq: 1, render: fixedHeader }))
  const moved = sticky.observe(viewport({ seq: 2, y: 42, render: fixedHeader }))
  assert.equal(moved.kind, "unaligned")
})

test("starts a segment for unrelated content and dimension changes", () => {
  const tracker = createViewportTracker()
  const initial = tracker.observe(viewport({ seq: 1 }))
  const unrelated = tracker.observe(
    viewport({ seq: 2, render: (x, y) => texture(x, y, 993) }),
  )
  const resized = tracker.observe(viewport({ seq: 3, width: 120, height: 90 }))

  assert.equal(unrelated.kind, "unaligned")
  assert.equal(unrelated.segment, initial.segment + 1)
  assert.equal(resized.kind, "unaligned")
  assert.equal(resized.reason, "dimensions-changed")
  assert.equal(resized.segment, unrelated.segment + 1)
})

test("bounds retained anchors by count and bytes and reports diagnostics", () => {
  const maxAnchorBytes = 240 * 180 * 4 * 2 + 60_000
  const tracker = createViewportTracker({
    options: { maxAnchors: 2, maxAnchorBytes },
  })
  tracker.observe(viewport({ seq: 1, y: 0 }))
  tracker.observe(viewport({ seq: 2, y: 45 }))
  tracker.observe(viewport({ seq: 3, y: 90 }))

  const stats = tracker.stats()
  assert.equal(stats.anchorCount, 2)
  assert.ok(stats.anchorBytes <= maxAnchorBytes)
  assert.ok(stats.comparisons > 0)
  assert.ok(stats.elapsedMs >= 0)
})

test("generation and chat ownership changes invalidate old anchors", () => {
  const tracker = createViewportTracker()
  const initial = tracker.observe(viewport({ seq: 1 }))
  const next = tracker.observe(viewport({ seq: 2, y: 0, generation: 2 }))
  assert.equal(next.kind, "unaligned")
  assert.equal(next.reason, "generation-changed")
  assert.equal(next.segment, initial.segment + 1)

  const chat = tracker.observe(
    viewport({ seq: 3, ownerChat: "chat-b", generation: 2 }),
  )
  assert.equal(chat.kind, "unaligned")
  assert.equal(chat.reason, "owner-changed")
  assert.equal(chat.segment, next.segment + 1)
})

test("reset clears recent views and begins a fresh segment", () => {
  const tracker = createViewportTracker()
  tracker.observe(viewport({ seq: 1 }))
  tracker.observe(viewport({ seq: 2, y: 45 }))
  tracker.reset()

  const fresh = tracker.observe(viewport({ seq: 3 }))

  assert.equal(fresh.kind, "initial")
  assert.equal(fresh.segment, 1)
  assert.equal(tracker.stats().anchorCount, 1)
})

test("does not call unrelated sparse white-page text a same-position revision", () => {
  const tracker = createViewportTracker()
  tracker.observe(textPage({ seq: 1, salt: 1 }))
  const result = tracker.observe(textPage({ seq: 2, salt: 91 }))

  assert.equal(result.kind, "unaligned")
  assert.equal(result.segment, 2)
})

test("resolves a three-pixel shift in sparse text instead of treating it as a revision", () => {
  const tracker = createViewportTracker()
  tracker.observe(textPage({ seq: 1 }))
  const result = tracker.observe(textPage({ seq: 2, y: 3 }))

  assert.equal(result.kind, "overlap", JSON.stringify(result))
  assert.ok(Math.abs(result.shiftY - 3) <= 1, `shift ${result.shiftY}`)
})

test("matches high-contrast text on dark backgrounds using contrast features", () => {
  const tracker = createViewportTracker()
  tracker.observe(textPage({ seq: 1, darkTheme: true }))
  const result = tracker.observe(textPage({ seq: 2, y: 24, darkTheme: true }))

  assert.equal(result.kind, "overlap", JSON.stringify(result))
  assert.equal(result.shiftY, 24)
})

test("resolves a 24-pixel scroll and a three-pixel reverse scroll", () => {
  const downTracker = createViewportTracker()
  downTracker.observe(textPage({ seq: 1 }))
  const down = downTracker.observe(textPage({ seq: 2, y: 24 }))
  assert.equal(down.kind, "overlap")
  assert.equal(down.shiftY, 24)

  const upTracker = createViewportTracker()
  upTracker.observe(textPage({ seq: 1, y: 3 }))
  const up = upTracker.observe(textPage({ seq: 2 }))
  assert.equal(up.kind, "overlap")
  assert.equal(up.shiftY, -3)
})

test("preserves 2x native text rows across noninteger feature phases", () => {
  const cases = [
    { shiftY: 80 },
    { shiftY: 120 },
    { shiftY: 160 },
    { shiftY: 121, height: 1551 },
    { shiftY: 120, height: 2160 },
    { shiftY: 121, height: 2161 },
  ]
  for (const { shiftY, width = 2880, height = 1550 } of cases) {
    const tracker = createViewportTracker({
      options: { maxAnchorBytes: 256 * 1024 },
    })
    tracker.observe(nativeTextPage({ seq: 1, width, height }))
    const result = tracker.observe(
      nativeTextPage({ seq: 2, y: shiftY, width, height }),
    )

    assert.equal(
      result.kind,
      "overlap",
      JSON.stringify({ shiftY, width, height, result }),
    )
    assert.ok(
      Math.abs(result.shiftY - shiftY) <= 2,
      JSON.stringify({ shiftY, result }),
    )
    assert.ok(tracker.stats().anchorBytes <= 256 * 1024)
  }
})

test("keeps a portrait 4K frame bounded and rejects uncertain alignment", () => {
  const tracker = createViewportTracker({
    options: { maxAnchorBytes: 256 * 1024 },
  })
  tracker.observe(nativeTextPage({ seq: 1, width: 2160, height: 3840 }))
  const result = tracker.observe(
    nativeTextPage({ seq: 2, y: 121, width: 2160, height: 3840 }),
  )

  assert.equal(result.kind, "unaligned")
  assert.ok(
    ["ambiguous-overlap", "no-confident-overlap"].includes(result.reason),
  )
  assert.ok(tracker.stats().anchorBytes <= 256 * 1024)
})

test("finds a small native text shift despite coarse search phase", () => {
  for (const shiftY of [80, 120]) {
    const tracker = createViewportTracker({
      options: { maxAnchorBytes: 256 * 1024 },
    })
    tracker.observe(thinNativeTextPage({ seq: 1 }))
    const result = tracker.observe(thinNativeTextPage({ seq: 2, y: shiftY }))

    assert.equal(result.kind, "overlap", JSON.stringify({ shiftY, result }))
    assert.ok(Math.abs(result.shiftY - shiftY) <= 2)
  }
})

test("aligns article text while discounting a dense fixed table of contents", () => {
  const tracker = createViewportTracker({
    options: { maxAnchorBytes: 256 * 1024 },
  })
  tracker.observe(nativeArticlePage({ seq: 1 }))
  const result = tracker.observe(nativeArticlePage({ seq: 2, y: 120 }))

  assert.equal(result.kind, "overlap", JSON.stringify(result))
  assert.equal(result.shiftY, 120)
})

test("aligns moving text while discounting a fixed heading and sidebar", () => {
  const tracker = createViewportTracker()
  tracker.observe(
    textPage({
      seq: 1,
      width: 1280,
      fixedSidebarWidth: 190,
      fixedHeadingHeight: 56,
    }),
  )
  const result = tracker.observe(
    textPage({
      seq: 2,
      width: 1280,
      y: 24,
      fixedSidebarWidth: 190,
      fixedHeadingHeight: 56,
    }),
  )

  assert.equal(result.kind, "overlap", JSON.stringify(result))
  assert.equal(result.shiftY, 24)
})

test("rejects a stationary heading mixed with moving sparse text", () => {
  const tracker = createViewportTracker()
  tracker.observe(textPage({ seq: 1, fixedHeadingHeight: 360 }))
  const result = tracker.observe(
    textPage({ seq: 2, y: 24, fixedHeadingHeight: 360 }),
  )

  assert.equal(result.kind, "unaligned")
})

test("rejects unbounded options and keeps even a one-byte anchor budget bounded", () => {
  assert.throws(
    () => createViewportTracker({ options: { maxAnchors: 0 } }),
    RangeError,
  )
  assert.throws(
    () =>
      createViewportTracker({ options: { maxAnchorBytes: 32 * 1024 * 1024 } }),
    RangeError,
  )
  assert.throws(
    () => createViewportTracker({ options: { unknown: true } }),
    RangeError,
  )
  const tracker = createViewportTracker({
    options: { maxAnchorBytes: 1, maxAnchors: 3 },
  })
  tracker.observe(viewport({ seq: 1 }))
  tracker.observe(viewport({ seq: 2, y: 12 }))

  assert.equal(tracker.stats().anchorCount, 1)
  assert.ok(tracker.stats().anchorBytes <= 1)
})
