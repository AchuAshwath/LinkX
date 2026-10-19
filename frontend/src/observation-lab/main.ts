import {
  FIXTURE_PROVENANCE,
  FIXTURE_SET_VERSION,
  type FixtureBlock,
  type FixtureFrame,
  READING_FIXTURES,
  type ReadingFixture,
} from "@/observation-lab/fixtures"
import {
  NATIVE_OCR_RUN,
  OCR_EVIDENCE_CASES,
  type OcrCase,
} from "@/observation-lab/ocr-evidence"
import {
  type ReplayConfiguration,
  replayReadingFixture,
} from "@/observation-lab/replay"
import { createRunExport, type RunExportInput } from "@/observation-lab/report"
import "@/observation-lab/lab.css"

const root = document.querySelector<HTMLElement>("#observation-lab")!

root.innerHTML = `
  <div class="lab-shell">
    <header class="lab-header">
      <h1>LinkX Observation Fixture Lab</h1>
      <p>Version ${FIXTURE_SET_VERSION} · fictional, local-only reading scenarios</p>
    </header>
    <section class="lab-controls lab-card" aria-label="Fixture controls">
      <label class="lab-field">Scenario
        <select id="scenario-select"></select>
      </label>
      <label class="lab-field">Cache state
        <select id="cache-select"><option value="cold">Cold</option><option value="warm">Warm</option></select>
      </label>
      <label class="lab-field">Sample rate (Hz)
        <input id="sample-rate" type="number" min="1" max="4" value="4" />
      </label>
      <label class="lab-field">Settle window (ms)
        <input id="settle-window" type="number" min="0" max="3000" step="50" value="700" />
      </label>
      <button id="replay-button" type="button">Replay scenario</button>
      <button id="export-button" type="button" disabled>Export aggregate results</button>
    </section>
    <div class="lab-grid" style="margin-top: 1rem">
      <section class="lab-card" aria-labelledby="scenario-title">
        <h2 id="scenario-title"></h2>
        <p id="scenario-description"></p>
        <div id="fixture-preview" class="fixture-preview" aria-label="Synthetic fixture preview"></div>
        <p class="lab-footer">Ground truth is shown only in this lab. It is not sent to product extraction or exported. ${FIXTURE_PROVENANCE.source}; ${FIXTURE_PROVENANCE.license}.</p>
      </section>
      <section class="lab-card" aria-labelledby="run-title">
        <h2 id="run-title">Replay results</h2>
        <p id="run-status" role="status" aria-live="polite">Choose a fixture and replay its scripted views.</p>
        <pre id="run-results" class="lab-results"></pre>
      </section>
    </div>
    <section class="lab-card ocr-comparison" aria-label="Recorded OCR comparison" style="margin-top: 1rem">
      <h2>Recorded OCR comparison</h2>
      <p>Actual native macOS Vision outputs from the dated synthetic fixture run, beside its exact PNG inputs and fixture reading order. Archived browser Tesseract results are identified separately.</p>
      <label class="lab-field">OCR comparison case
        <select id="ocr-case-select"></select>
      </label>
      <div class="ocr-columns">
        <figure>
          <img id="ocr-fixture-image" alt="" />
          <figcaption id="ocr-image-caption"></figcaption>
        </figure>
        <section aria-labelledby="ground-truth-title">
          <h3 id="ground-truth-title">Ground truth · expected reading order</h3>
          <ol id="ocr-ground-truth"></ol>
        </section>
        <section aria-labelledby="ocr-result-title">
          <h3 id="ocr-result-title">Native macOS Vision · fresh-process text</h3>
          <pre id="ocr-native-fresh" class="ocr-raw"></pre>
          <p id="ocr-native-metrics"></p>
          <h4>Same image · reused-process text</h4>
          <pre id="ocr-native-reused" class="ocr-raw"></pre>
          <h4 id="ocr-archive-title">Archived browser Tesseract report summary</h4>
          <p id="ocr-recorded-summary"></p>
          <p class="lab-evidence-source" id="ocr-source"></p>
          <p class="lab-uncertainty" id="ocr-uncertainty"></p>
        </section>
      </div>
      <div class="lab-correction">
        <label class="lab-field" for="ocr-correction">Proposed correction (local only)
          <textarea id="ocr-correction" rows="3" placeholder="Enter a correction for this session. It is not saved or exported."></textarea>
        </label>
        <button id="ocr-save-correction" type="button">Save correction in this session</button>
        <button id="ocr-skip" type="button">Skip this OCR evidence</button>
        <p id="ocr-correction-status" role="status" aria-live="polite">No correction saved; no evidence skipped.</p>
      </div>
      <p class="lab-footer">This panel is a local research aid. It does not submit or persist corrections, alter ground truth, or change product OCR behavior.</p>
    </section>
  </div>
`

const select = root.querySelector<HTMLSelectElement>("#scenario-select")!
const preview = root.querySelector<HTMLDivElement>("#fixture-preview")!
const title = root.querySelector<HTMLHeadingElement>("#scenario-title")!
const description = root.querySelector<HTMLParagraphElement>(
  "#scenario-description",
)!
const replayButton = root.querySelector<HTMLButtonElement>("#replay-button")!
const exportButton = root.querySelector<HTMLButtonElement>("#export-button")!
const status = root.querySelector<HTMLParagraphElement>("#run-status")!
const results = root.querySelector<HTMLPreElement>("#run-results")!
let lastExport: ReturnType<typeof createRunExport> | null = null
const correctionState = new Map<
  OcrCase,
  { correction?: string; skipped?: boolean }
>()
const ocrSelect = root.querySelector<HTMLSelectElement>("#ocr-case-select")!
const ocrImage = root.querySelector<HTMLImageElement>("#ocr-fixture-image")!
const groundTruth = root.querySelector<HTMLOListElement>("#ocr-ground-truth")!
const correctionInput =
  root.querySelector<HTMLTextAreaElement>("#ocr-correction")!
const correctionStatus = root.querySelector<HTMLParagraphElement>(
  "#ocr-correction-status",
)!

const fixtureImageUrls: Record<OcrCase, string> = {
  "scroll-100": new URL("./fixture-images/scroll-100.png", import.meta.url)
    .href,
  "zoom-200": new URL("./fixture-images/zoom-200.png", import.meta.url).href,
  "zoom-400": new URL("./fixture-images/zoom-400.png", import.meta.url).href,
  columns: new URL("./fixture-images/columns.png", import.meta.url).href,
  clipped: new URL("./fixture-images/clipped.png", import.meta.url).href,
  "image-text": new URL("./fixture-images/image-text.png", import.meta.url)
    .href,
}

function selectedOcrCase() {
  return (
    OCR_EVIDENCE_CASES.find((item) => item.id === ocrSelect.value) ??
    OCR_EVIDENCE_CASES[0]
  )
}

function renderOcrComparison(): void {
  const evidence = selectedOcrCase()
  const saved = correctionState.get(evidence.id)
  ocrImage.src = fixtureImageUrls[evidence.id]
  ocrImage.alt = evidence.rawImageLabel
  root.querySelector<HTMLElement>("#ocr-image-caption")!.textContent =
    evidence.rawImageLabel
  groundTruth.replaceChildren(
    ...evidence.groundTruth.map((text) => {
      const item = document.createElement("li")
      item.textContent = text
      return item
    }),
  )
  root.querySelector<HTMLElement>("#ocr-native-fresh")!.textContent =
    evidence.nativeFreshLines.join("\n") || "(No text recognized.)"
  root.querySelector<HTMLElement>("#ocr-native-reused")!.textContent =
    evidence.nativeReusedLines.join("\n") || "(No text recognized.)"
  root.querySelector<HTMLElement>("#ocr-native-metrics")!.textContent =
    `${evidence.nativeFinding} Ordered fixture score: ${evidence.nativeErrors}/${evidence.nativeWords} word errors · ${NATIVE_OCR_RUN.recognitionLevel}, ${NATIVE_OCR_RUN.language}, language correction ${NATIVE_OCR_RUN.languageCorrection ? "on" : "off"}.`
  const archiveTitle = root.querySelector<HTMLElement>("#ocr-archive-title")!
  const archiveSummary = root.querySelector<HTMLElement>(
    "#ocr-recorded-summary",
  )!
  archiveTitle.hidden = evidence.recordedSummary === null
  archiveSummary.hidden = evidence.recordedSummary === null
  archiveSummary.textContent = evidence.recordedSummary ?? ""
  root.querySelector<HTMLElement>("#ocr-source")!.textContent =
    `Evidence source: ${evidence.source}`
  root.querySelector<HTMLElement>("#ocr-uncertainty")!.textContent =
    evidence.uncertainty
  correctionInput.value = saved?.correction ?? ""
  correctionStatus.textContent = saved?.skipped
    ? "OCR evidence skipped for this session."
    : saved?.correction
      ? "Correction saved in memory only for this session."
      : "No correction saved; no evidence skipped."
}

for (const evidence of OCR_EVIDENCE_CASES) {
  const option = document.createElement("option")
  option.value = evidence.id
  option.textContent = evidence.title
  ocrSelect.append(option)
}

for (const fixture of READING_FIXTURES) {
  const option = document.createElement("option")
  option.value = fixture.id
  option.textContent = fixture.title
  select.append(option)
}

function selectedFixture(): ReadingFixture {
  return (
    READING_FIXTURES.find((fixture) => fixture.id === select.value) ??
    READING_FIXTURES[0]
  )
}

function blockCard(
  block: FixtureBlock,
  fixture: ReadingFixture,
  textOverride: string | undefined,
): HTMLElement {
  const card = document.createElement("article")
  card.className = "fixture-card"
  const text = document.createElement("p")
  text.textContent = textOverride ?? block.text
  if (fixture.layout === "quotes" && block.id.startsWith("q"))
    text.className = "fixture-quote"
  const label = document.createElement("small")
  label.textContent = `${block.card} · reading order ${block.order}${block.partial ? " · partial" : ""}`
  card.append(text, label)
  return card
}

function fixtureColumns(): HTMLElement[] {
  const columns = [document.createElement("div"), document.createElement("div")]
  for (const column of columns) column.className = "fixture-column"
  return columns
}

function visibleFixtureBlocks(
  fixture: ReadingFixture,
  frame?: FixtureFrame,
): FixtureBlock[] {
  const visibleIds = frame ? new Set(frame.visibleBlockIds) : null
  if (!visibleIds) return fixture.blocks
  return fixture.blocks.filter((block) => visibleIds.has(block.id))
}

function appendFixtureBlocks({
  fixture,
  frame,
  cards,
}: {
  fixture: ReadingFixture
  frame?: FixtureFrame
  cards: HTMLElement[]
}): void {
  const columns = fixture.layout === "columns"
  const visibleBlocks = visibleFixtureBlocks(fixture, frame)
  for (const block of visibleBlocks) {
    const target = columns && block.card === "right" ? cards[1] : cards[0]
    target.append(blockCard(block, fixture, frame?.textOverrides?.[block.id]))
  }
}

function appendFixtureDecoration(
  fixture: ReadingFixture,
  cards: HTMLElement[],
) {
  if (fixture.layout === "columns") preview.classList.add("fixture-columns")
  if (fixture.layout === "sidebar") {
    const sidebar = document.createElement("div")
    sidebar.className = "fixture-sidebar"
    sidebar.setAttribute("aria-label", "Independent animated sidebar")
    preview.append(sidebar)
  }
  if (fixture.layout === "columns") preview.append(...cards)
}

function renderFixture(fixture: ReadingFixture, frame?: FixtureFrame): void {
  title.textContent = fixture.title
  description.textContent = fixture.description
  preview.replaceChildren()
  preview.className = `fixture-preview fixture-${fixture.layout}`
  preview.style.zoom = frame ? `${frame.zoomPercent ?? 100}%` : "100%"
  const cards = fixture.layout === "columns" ? fixtureColumns() : [preview]
  appendFixtureBlocks({ fixture, frame, cards })
  appendFixtureDecoration(fixture, cards)
}

function runtimeEnvironment(): RunExportInput["environment"] {
  return {
    browser: navigator.userAgent,
    os: navigator.platform,
    device: "Local browser viewport",
    displayScale: window.devicePixelRatio || 1,
    width: window.innerWidth,
    height: window.innerHeight,
    cache: root.querySelector<HTMLSelectElement>("#cache-select")!.value as
      | "cold"
      | "warm",
    modelId: null,
  }
}

function readReplayConfiguration(): ReplayConfiguration {
  const sampleHz = Number(
    root.querySelector<HTMLInputElement>("#sample-rate")!.value,
  )
  const settleMs = Number(
    root.querySelector<HTMLInputElement>("#settle-window")!.value,
  )
  return {
    sampleHz: Number.isFinite(sampleHz)
      ? Math.min(4, Math.max(1, sampleHz))
      : 4,
    settleMs: Number.isFinite(settleMs)
      ? Math.min(3000, Math.max(0, settleMs))
      : 700,
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

async function replay(fixture: ReadingFixture): Promise<void> {
  const configuration = readReplayConfiguration()
  const replayResult = replayReadingFixture(fixture, configuration)
  const frameById = new Map(fixture.frames.map((frame) => [frame.id, frame]))
  let previousAtMs = 0
  const lines: string[] = []
  select.disabled = true
  replayButton.disabled = true
  exportButton.disabled = true
  results.textContent = ""

  for (const observation of replayResult.observations) {
    await delay(Math.max(0, observation.atMs - previousAtMs))
    previousAtMs = observation.atMs
    const frame = frameById.get(observation.frameId)
    if (!frame) continue
    renderFixture(fixture, frame)
    const expected = frame.expectedAccepted
      ? "expected accepted"
      : "expected unchanged"
    lines.push(
      `${frame.id} · ${frame.atMs} ms · ${observation.outcome} · ${expected}`,
    )
    results.textContent = lines.join("\n")
    status.textContent = `Frame ${frame.id}: ${observation.outcome}; ${expected}.`
  }

  lastExport = createRunExport({
    fixtureVersion: FIXTURE_SET_VERSION,
    fixtureProvenance: FIXTURE_PROVENANCE,
    scenarioId: fixture.id,
    config: configuration,
    environment: runtimeEnvironment(),
    measurements: {
      acceptedViews: replayResult.acceptedViewCount,
      coveragePercent: replayResult.coveragePercent,
      localProcessingMs: [],
      uploadMs: [],
      providerMs: [],
      misses: replayResult.missedExpectedViews,
      unexpectedAcceptedViews: replayResult.unexpectedAcceptedViews,
      failures: 0,
    },
  })
  status.textContent = `Replay complete: ${replayResult.acceptedViewCount} accepted views · ${replayResult.coveragePercent}% block coverage · ${replayResult.missedExpectedViews} expected views missed · ${replayResult.unexpectedAcceptedViews} unexpected views accepted.`
  select.disabled = false
  replayButton.disabled = false
  exportButton.disabled = false
}

function exportResults(): void {
  if (!lastExport) return
  const file = new Blob([JSON.stringify(lastExport, null, 2)], {
    type: "application/json",
  })
  const url = URL.createObjectURL(file)
  const link = document.createElement("a")
  link.href = url
  link.download = `observation-run-${lastExport.scenarioId}.json`
  link.click()
  URL.revokeObjectURL(url)
}

select.addEventListener("change", () => renderFixture(selectedFixture()))
ocrSelect.addEventListener("change", renderOcrComparison)
root
  .querySelector<HTMLButtonElement>("#ocr-save-correction")!
  .addEventListener("click", () => {
    const correction = correctionInput.value.trim()
    correctionState.set(selectedOcrCase().id, correction ? { correction } : {})
    renderOcrComparison()
  })
root
  .querySelector<HTMLButtonElement>("#ocr-skip")!
  .addEventListener("click", () => {
    correctionState.set(selectedOcrCase().id, { skipped: true })
    renderOcrComparison()
  })
replayButton.addEventListener("click", () => replay(selectedFixture()))
exportButton.addEventListener("click", exportResults)
renderFixture(selectedFixture())
renderOcrComparison()
