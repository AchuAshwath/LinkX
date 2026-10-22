import assert from "node:assert/strict"
import test from "node:test"
import { createStreamSampler } from "./stream.mjs"

function fixture() {
  let at = 0
  let tick
  let encoded = 0
  const frames = []
  const gaps = []
  const video = {
    readyState: 2,
    videoWidth: 80,
    videoHeight: 40,
    currentTime: 0,
  }
  const pixels = new Uint8ClampedArray(80 * 40 * 4).fill(255)
  const context = {
    drawImage() {},
    getImageData: () => ({ data: pixels.slice() }),
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: () => {
      encoded += 1
      return "data:image/png;base64,AA=="
    },
  }
  const environment = {
    now: () => at,
    createCanvas: () => canvas,
    setInterval: (callback) => {
      tick = callback
      return 1
    },
    clearInterval: () => {
      tick = undefined
    },
  }
  const sampler = createStreamSampler({
    video,
    onFrame: (frame) => frames.push(frame),
    onGap: (gap) => gaps.push(gap),
    environment,
  })
  return {
    sampler,
    frames,
    gaps,
    video,
    canvas,
    context,
    encoded: () => encoded,
    tick: (time) => {
      at = time
      tick?.()
    },
  }
}

test("unchanged media delivery does not create repeated samples or encode images", () => {
  const item = fixture()
  item.sampler.start({ generation: 1, ownerChat: "A" })
  item.tick(250)
  item.tick(500)
  assert.equal(item.frames.length, 1)
  assert.equal(item.encoded(), 0)
})

test("delivered frames retain source dimensions and delivery diagnostics", () => {
  const item = fixture()
  item.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: 8 })
  item.video.currentTime = 1.25
  item.sampler.start({ generation: 3, ownerChat: "B" })
  item.tick(250)
  assert.deepEqual(item.frames[0].delivery, {
    mediaTime: 1.25,
    presentedFrames: 8,
    callbacks: 0,
  })
  assert.equal(item.frames[0].width, 80)
  assert.equal(item.frames[0].ownerChat, "B")
})

test("oversized sources become explicit gaps before allocating a pixel buffer", () => {
  const item = fixture()
  item.video.videoWidth = 10000
  item.video.videoHeight = 10000
  item.sampler.start({ generation: 1, ownerChat: "A" })
  item.tick(250)
  assert.equal(item.frames.length, 0)
  assert.equal(item.gaps[0]?.reason, "source-too-large")
  assert.equal(item.canvas.width, 0)
})

test("canvas failures are reported without crashing the sampling loop", () => {
  const item = fixture()
  item.context.getImageData = () => {
    throw new Error("Read failed")
  }
  item.sampler.start({ generation: 1, ownerChat: "A" })
  assert.doesNotThrow(() => item.tick(250))
  assert.equal(item.frames.length, 0)
  assert.equal(item.gaps[0]?.reason, "source-read-failed")
})

test("stop releases the source canvas and rejects late video callbacks", () => {
  const item = fixture()
  let callback
  item.video.requestVideoFrameCallback = (next) => {
    callback = next
    return 9
  }
  item.video.cancelVideoFrameCallback = () => {}
  item.sampler.start({ generation: 1, ownerChat: "A" })
  item.tick(250)
  const late = callback
  item.sampler.stop()
  assert.equal(typeof late, "function")
  late(500, { presentedFrames: 4 })
  item.tick(750)
  assert.equal(item.frames.length, 1)
  assert.equal(item.canvas.width, 0)
  assert.equal(item.sampler.stats().callbacks, 0)
})
