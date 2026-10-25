// Shared video is the only source. No source DOM, scroll events, or page API.
const MAX_UNCHANGED_DELIVERY_SKIPS = 3

export function createStreamSampler({
  video,
  onFrame,
  onGap,
  options = {},
  environment = {},
}) {
  const env = {
    now: () => performance.now(),
    createCanvas: () => document.createElement("canvas"),
    setInterval: (callback, delay) => setInterval(callback, delay),
    clearInterval: (id) => clearInterval(id),
    ...environment,
  }
  const canvas = env.createCanvas()
  const context = canvas.getContext("2d", { willReadFrequently: true })
  let timer
  let identity
  let lastDelivery
  let unchangedDeliverySkips = 0
  let sequence = 0
  let callbacks = 0
  let callbackId
  const sampleTimes = []
  const counters = { samples: 0, unchangedDelivery: 0, gaps: 0 }

  function readFrame() {
    if (!identity || video.readyState < 2 || !video.videoWidth) return
    const delivery = {
      mediaTime: video.currentTime,
      presentedFrames:
        video.getVideoPlaybackQuality?.().totalVideoFrames ?? null,
      callbacks,
    }
    const signature = JSON.stringify(delivery)
    if (lastDelivery === signature) {
      counters.unchangedDelivery += 1
      unchangedDeliverySkips += 1
      if (unchangedDeliverySkips <= MAX_UNCHANGED_DELIVERY_SKIPS) return
      unchangedDeliverySkips = 0
    } else {
      unchangedDeliverySkips = 0
    }
    lastDelivery = signature
    if (
      video.videoWidth * video.videoHeight >
      (options.maxPixels ?? 8_388_608)
    ) {
      counters.gaps += 1
      onGap?.({
        ...identity,
        capturedAt: env.now(),
        reason: "source-too-large",
      })
      return
    }
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    context.drawImage(video, 0, 0)
    counters.samples += 1
    onFrame({
      ...identity,
      seq: ++sequence,
      capturedAt: env.now(),
      width: canvas.width,
      height: canvas.height,
      thumbnailWidth: canvas.width,
      thumbnailHeight: canvas.height,
      pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
      delivery,
      getDataUrl: () => canvas.toDataURL("image/png"),
    })
  }

  function sample() {
    const before = counters.samples
    const started = env.now()
    try {
      readFrame()
    } catch {
      counters.gaps += 1
      onGap?.({
        ...identity,
        capturedAt: env.now(),
        reason: "source-read-failed",
      })
    } finally {
      if (counters.samples > before) {
        sampleTimes.push(env.now() - started)
        if (sampleTimes.length > 200) sampleTimes.shift()
      }
    }
  }

  function stop() {
    env.clearInterval(timer)
    timer = undefined
    identity = undefined
    video.cancelVideoFrameCallback?.(callbackId)
    callbackId = undefined
    lastDelivery = undefined
    unchangedDeliverySkips = 0
    canvas.width = 0
    canvas.height = 0
  }

  function start(nextIdentity) {
    stop()
    identity = { ...nextIdentity }
    watchDelivery(identity)
    timer = env.setInterval(sample, options.intervalMs ?? 250)
  }

  function watchDelivery(token) {
    callbackId = video.requestVideoFrameCallback?.(() => {
      if (identity !== token) return
      callbacks += 1
      watchDelivery(token)
    })
  }

  return {
    start,
    stop,
    stats: () => ({ ...counters, callbacks, sampleTimes: sampleTimes.slice() }),
  }
}
