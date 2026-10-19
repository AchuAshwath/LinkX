import { READING_FIXTURES } from "./fixtures"
import nativeRun from "./native-ocr-final-2026-10-19.json"

export const OCR_CASES = [
  { id: "scroll-100", title: "Scroll pause · 100%" },
  { id: "zoom-200", title: "Small text · 200%" },
  { id: "zoom-400", title: "Small text · 400%" },
  { id: "columns", title: "Two-column reading order" },
  { id: "clipped", title: "Clipped card boundary" },
  { id: "image-text", title: "Text printed inside an image" },
] as const

export type OcrCase = (typeof OCR_CASES)[number]["id"]

export interface OcrEvidenceCase {
  id: OcrCase
  title: string
  imageName: string
  fixtureId: string
  fixtureBlockIds: string[]
  rawImageLabel: string
  groundTruth: string[]
  nativeFreshLines: string[]
  nativeReusedLines: string[]
  nativeErrors: number
  nativeWords: number
  nativeFinding: string
  recordedSummary: string | null
  source: string
  uncertainty: string
}

const imageByCase: Record<OcrCase, string> = {
  "scroll-100": "scroll-100.png",
  "zoom-200": "zoom-200.png",
  "zoom-400": "zoom-400.png",
  columns: "columns.png",
  clipped: "clipped.png",
  "image-text": "image-text.png",
}

const archiveSummaries: Partial<Record<OcrCase, string>> = {
  columns:
    "Archived browser Tesseract report: row-major output instead of column-major; merged ‘A new’ as ‘Anew’ (confidence 95). This is separate from the fresh native result above.",
  "image-text":
    "Archived browser Tesseract report: no text returned in baseline, PSM 6, and 2× upscale attempts. This is separate from the fresh native result above.",
}

export const OCR_EVIDENCE_CASES: OcrEvidenceCase[] = OCR_CASES.map((item) => {
  const imageName = imageByCase[item.id]
  const fresh = nativeRun.coldFreshProcess.find(
    (result) => result.image === imageName,
  )!
  const reused = nativeRun.reusedSingleProcess.images.find(
    (result) => result.image === imageName,
  )!
  const fixture = READING_FIXTURES.find(
    (candidate) => candidate.id === fresh.fixtureId,
  )!
  const groundTruth = fixture.blocks
    .filter((block) => fresh.fixtureBlockIds.includes(block.id))
    .sort((left, right) => left.order - right.order)
    .map((block) => block.text)

  return {
    id: item.id,
    title: item.title,
    imageName,
    fixtureId: fresh.fixtureId,
    fixtureBlockIds: fresh.fixtureBlockIds,
    rawImageLabel: `Synthetic ${item.title.toLowerCase()} image rendered from the ${nativeRun.fixtureVersion} fixture source.`,
    groundTruth,
    nativeFreshLines: nativeRun.coldFreshProcess.find(
      (result) => result.image === imageName,
    )!.recognizedLines,
    nativeReusedLines: reused.recognizedLines,
    nativeErrors: fresh.wordErrors,
    nativeWords: fresh.wordCount,
    nativeFinding:
      item.id === "columns"
        ? "Reading-order failure: Vision returned the right-column text first, then alternated across columns."
        : "No ordered-token edits were measured on this fixture in this run.",
    recordedSummary: archiveSummaries[item.id] ?? null,
    source: archiveSummaries[item.id]
      ? "Fresh native Vision output: native-ocr-final-2026-10-19.json. Archived browser summary: docs/observation/evidence/browser-tesseract-v1.md."
      : "Fresh native Vision output: native-ocr-final-2026-10-19.json.",
    uncertainty:
      "Synthetic English fixture only. Native macOS Vision output does not establish browser Tesseract behavior, general OCR accuracy, or user accessibility outcomes.",
  }
})

export const NATIVE_OCR_RUN = {
  engine: nativeRun.configuration.engine,
  recognitionLevel: nativeRun.configuration.recognitionLevel,
  language: nativeRun.configuration.language,
  languageCorrection: nativeRun.configuration.languageCorrection,
  os: nativeRun.environment.os,
  cpu: nativeRun.environment.cpu,
}
