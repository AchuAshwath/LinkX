import { createCapturePipeline } from "./pipeline.mjs"
import { createStreamSampler } from "./stream.mjs"

const $ = (id) => document.getElementById(id)
let generation = 0
let stream = null
let pipeline = null
let reader = null
let starting = false
let views = []
let events = []
let sampleTimes = []
let lastDecision
let acceptedCount = 0
let droppedPreviews = 0
let renderAt = 0

function event(record) {
  events.push(record)
  if (events.length > 160) events.shift()
}

function gap(record) {
  event({ ...record, type: "gap" })
  $("status").textContent =
    `Incomplete capture: ${record.reason}. See diagnostics.`
}

function accept(capture) {
  acceptedCount += 1
  const { dataUrl, ...metadata } = capture
  event({ type: "capture", ...metadata })
  views.push(capture)
  while (previewOverBudget()) {
    views.shift()
    droppedPreviews += 1
  }
  renderViews()
}

function previewOverBudget() {
  const bytes = views.reduce((sum, view) => sum + view.dataUrl.length * 2, 0)
  const pixels = views.reduce((sum, view) => sum + view.width * view.height, 0)
  const overMemory = bytes > 12_000_000 || pixels > 12_000_000
  return views.length > 6 || overMemory
}

function renderViews() {
  $("captures").replaceChildren()
  for (const view of [...views].reverse()) {
    const figure = document.createElement("figure")
    const button = document.createElement("button")
    const image = document.createElement("img")
    const caption = document.createElement("figcaption")
    image.src = view.dataUrl
    image.alt = `Captured viewport ${view.seq}`
    button.setAttribute("aria-label", `Inspect captured viewport ${view.seq}`)
    button.onclick = () => {
      $("full-image").src = view.dataUrl
      $("image-dialog").showModal()
    }
    caption.textContent = `#${view.seq} · ${view.observation?.kind ?? "new view"} · ${view.width} × ${view.height}`
    button.append(image)
    figure.append(button, caption)
    $("captures").append(figure)
  }
}

function snapshot() {
  return {
    version: "capture-v3",
    generation,
    sharing: stream !== null,
    acceptedCount,
    previews: views.length,
    droppedPreviews,
    pipeline: pipeline?.stats(),
    delivery: reader?.stats(),
    lastDecision,
    sampleTimes: sampleTimes.slice(),
    events: events.slice(),
    modelCalls: 0,
  }
}

function render() {
  $("counts").textContent = stream
    ? `${acceptedCount} captured views · ${views.length} recent previews · local only`
    : "No session"
  $("diagnostics").textContent = JSON.stringify(snapshot(), null, 2)
}

function sample(frame, token) {
  if (token !== generation || !stream) return
  const started = performance.now()
  lastDecision = pipeline.offer(frame)
  pipeline.takePending()
  const { candidate, ...decision } = lastDecision
  lastDecision = decision
  sampleTimes.push(performance.now() - started)
  if (sampleTimes.length > 200) sampleTimes.shift()
  if (performance.now() - renderAt < 500) return
  renderAt = performance.now()
  render()
}

function stop(message = "Sharing stopped. Captured images cleared.") {
  generation += 1
  const old = stream
  stream = null
  reader?.stop()
  pipeline?.clear({ nextGeneration: generation })
  old?.getTracks().forEach((track) => {
    track.stop()
  })
  views = []
  events = []
  sampleTimes = []
  lastDecision = undefined
  acceptedCount = 0
  droppedPreviews = 0
  $("preview").srcObject = null
  $("full-image").removeAttribute("src")
  $("image-dialog").close()
  $("stop").disabled = true
  $("close").disabled = true
  $("status").textContent = message
  renderViews()
  render()
}

async function attach(selected, token) {
  if (token !== generation) {
    selected.getTracks().forEach((track) => {
      track.stop()
    })
    return
  }
  const track = selected.getVideoTracks()[0]
  if (track.getSettings().displaySurface !== "browser") {
    selected.getTracks().forEach((item) => {
      item.stop()
    })
    throw new Error("Choose a browser tab for this experiment.")
  }
  stream = selected
  watchTrack(track, token)
  $("preview").srcObject = selected
  await $("preview").play()
  if (token !== generation) return
  if (track.readyState === "ended" || track.muted) {
    stop("Source became unavailable. Share the tab again to continue.")
    return
  }
  pipeline = createCapturePipeline({ onCandidate: accept, onGap: gap })
  pipeline.clear({ nextGeneration: token })
  reader = createStreamSampler({
    video: $("preview"),
    onFrame: (frame) => sample(frame, token),
    onGap: gap,
  })
  reader.start({ generation: token, ownerChat: "capture-validation" })
  $("stop").disabled = false
  $("close").disabled = false
  $("status").textContent =
    "Sharing. Read and scroll in the source tab, then inspect the captured views here."
  render()
}

function watchTrack(track, token) {
  const unavailable = () => {
    if (token === generation)
      stop("Source became unavailable. Share the tab again to continue.")
  }
  track.addEventListener("ended", unavailable, { once: true })
  track.addEventListener("mute", unavailable, { once: true })
}

async function start() {
  if (starting) return
  stop()
  starting = true
  $("start").disabled = true
  const token = generation
  try {
    const selected = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser" },
      audio: false,
      selfBrowserSurface: "exclude",
    })
    await attach(selected, token)
  } catch (error) {
    if (token === generation)
      stop(
        error.message || "Sharing did not start. Choose a tab and try again.",
      )
  } finally {
    starting = false
    $("start").disabled = false
  }
}

$("start").onclick = start
$("stop").onclick = () => stop()
$("close").onclick = () => stop()
$("dismiss").onclick = () => {
  $("image-dialog").close()
  $("full-image").removeAttribute("src")
}
$("image-dialog").addEventListener("close", () => {
  if (!$("image-dialog").open) $("full-image").removeAttribute("src")
})
$("download").onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(snapshot(), null, 2)], {
      type: "application/json",
    }),
  )
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = "browser-capture-diagnostics.json"
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
window.addEventListener("pagehide", () => stop())
window.captureLab = { snapshot, stop }
render()
