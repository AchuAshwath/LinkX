import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import {
  FIXTURE_SET_VERSION,
  READING_FIXTURES,
} from "../../src/observation-lab/fixtures.ts"

const frontendDir = path.resolve(import.meta.dirname, "../..")
const projectDir = path.resolve(frontendDir, "..")
const outputDir = path.resolve(
  process.argv[2] ??
    path.join(
      projectDir,
      "docs/observation/evidence/native-ocr-final-2026-10-19",
    ),
)
const inputDir = path.join(os.tmpdir(), "linkx-native-ocr-final-inputs")
const fixtureImageDir = path.join(
  frontendDir,
  "src/observation-lab/fixture-images",
)
const executable = path.join(os.tmpdir(), `linkx-vision-ocr-${process.pid}`)
const inputNames = [
  "scroll-100",
  "zoom-200",
  "zoom-400",
  "columns",
  "clipped",
  "image-text",
]
const fixtureByImage = {
  "scroll-100": ["scroll-pause-sidebar", ["s1", "s2"]],
  "zoom-200": ["small-text-zoom", ["z1", "z2", "z3"]],
  "zoom-400": ["small-text-zoom", ["z1"]],
  columns: ["two-columns", ["c1", "c2", "c3", "c4"]],
  clipped: ["clipped-card", ["p1", "p2"]],
  "image-text": ["image-text-card", ["i1", "i2", "i3"]],
}

await mkdir(outputDir, { recursive: true })
await mkdir(fixtureImageDir, { recursive: true })
execFileSync(
  "bun",
  ["scripts/observation-lab/capture-frames.ts", "representative", inputDir],
  {
    cwd: frontendDir,
    stdio: "inherit",
  },
)
execFileSync(
  "swiftc",
  ["scripts/observation-lab/VisionOCR.swift", "-o", executable],
  {
    cwd: frontendDir,
    stdio: "inherit",
  },
)

const imagePaths = inputNames.map((name) => path.join(inputDir, `${name}.png`))
await Promise.all(
  imagePaths.map((imagePath) =>
    copyFile(imagePath, path.join(fixtureImageDir, path.basename(imagePath))),
  ),
)
const environment = {
  os: execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim(),
  architecture: os.arch(),
  cpu: execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], {
    encoding: "utf8",
  }).trim(),
  swift: execFileSync("swift", ["--version"], { encoding: "utf8" }).trim(),
}
const hashes = Object.fromEntries(
  await Promise.all(
    imagePaths.map(async (imagePath) => {
      const bytes = await readFile(imagePath)
      return [
        path.basename(imagePath),
        createHash("sha256").update(bytes).digest("hex"),
      ]
    }),
  ),
)

const coldRuns = []
for (const imagePath of imagePaths) {
  const run = runProcess(["accurate", "corrected", imagePath])
  coldRuns.push(enrichResult(run, [imagePath])[0])
}
const reusedRun = runProcess(["accurate", "corrected", ...imagePaths])
const reusedRuns = enrichResult(reusedRun, imagePaths)

const artifact = {
  protocol:
    "Native macOS Vision exploratory rerun; criteria recorded before execution in docs/observation/experiment-decision-2026-10-19.md",
  fixtureVersion: FIXTURE_SET_VERSION,
  environment,
  configuration: {
    engine: "Apple Vision VNRecognizeTextRequest",
    recognitionLevel: "accurate",
    language: "en-US",
    languageCorrection: true,
    requestRevision: "OS default; not independently pinned",
  },
  fixturePngSha256: hashes,
  timingMethod: {
    cold: "Six fresh executable processes, one PNG per process; processWallMs measured by the Node runner, recognitionMs is VNImageRequestHandler.perform only.",
    reused:
      "One fresh executable process handles six PNGs sequentially; processWallMs is measured by the Node runner, recognitionMs is per-image VNImageRequestHandler.perform.",
    overheadEstimate:
      "processWallMs minus recognitionMs; includes process startup, image decode, request setup, and JSON serialization, so it is not isolated startup time. Compilation is excluded.",
  },
  coldFreshProcess: coldRuns,
  reusedSingleProcess: {
    processWallMs: reusedRun.processWallMs,
    totalRecognitionMs: round(
      reusedRuns.reduce((total, result) => total + result.recognitionMs, 0),
    ),
    processSetupOverheadEstimateMs: round(
      reusedRun.processWallMs -
        reusedRuns.reduce((total, result) => total + result.recognitionMs, 0),
    ),
    images: reusedRuns,
  },
  scoring: {
    normalization: "lowercase [a-z0-9]+ tokens; punctuation discarded",
    order:
      "VNRecognizeTextRequest lines in the top-to-bottom order returned by the harness, compared to fixture reading order",
    pooled: pooledScore([...coldRuns]),
    byImage: coldRuns.map(
      ({
        image,
        wordErrors,
        wordCount,
        orderedWordErrorRate,
        recognizedLines,
        confidence,
        fixtureGroundTruth,
      }) => ({
        image,
        fixtureGroundTruth,
        recognizedLines,
        confidence,
        wordErrors,
        wordCount,
        orderedWordErrorRate,
        nonEmpty: recognizedLines.length > 0,
      }),
    ),
  },
}

await writeFile(
  path.join(outputDir, "results.json"),
  `${JSON.stringify(artifact, null, 2)}\n`,
)
await writeFile(
  path.join(outputDir, "SHA256SUMS.json"),
  `${JSON.stringify(hashes, null, 2)}\n`,
)
await writeFile(
  path.join(
    frontendDir,
    "src/observation-lab/native-ocr-final-2026-10-19.json",
  ),
  `${JSON.stringify(artifact, null, 2)}\n`,
)
console.log(`Wrote ${path.join(outputDir, "results.json")}`)

function runProcess(args) {
  const started = performance.now()
  const processResult = spawnSync(executable, args, { encoding: "utf8" })
  const processWallMs = round(performance.now() - started)
  if (processResult.status !== 0)
    throw new Error(
      processResult.stderr || `Vision process exited ${processResult.status}`,
    )
  const results = JSON.parse(processResult.stdout)
  return { processWallMs, results }
}

function enrichResult(run, files) {
  return run.results.map((result, index) => {
    const [fixtureId, blockIds] =
      fixtureByImage[path.basename(files[index], ".png")]
    const fixture = READING_FIXTURES.find((item) => item.id === fixtureId)
    const fixtureGroundTruth = fixture.blocks
      .filter((block) => blockIds.includes(block.id))
      .map((block) => block.text)
      .join(" ")
    const expectedTokens = tokenize(fixtureGroundTruth)
    const actualTokens = tokenize(result.recognizedLines.join(" "))
    const wordErrors = editDistance(expectedTokens, actualTokens)
    return {
      image: result.file,
      fixtureId,
      fixtureBlockIds: blockIds,
      fixtureGroundTruth,
      recognitionMs: result.elapsedMs,
      ...(files.length === 1
        ? {
            processWallMs: run.processWallMs,
            processSetupOverheadEstimateMs: round(
              run.processWallMs - result.elapsedMs,
            ),
          }
        : {}),
      recognizedLines: result.recognizedLines,
      confidence: result.confidence,
      wordErrors,
      wordCount: expectedTokens.length,
      orderedWordErrorRate:
        expectedTokens.length === 0
          ? null
          : Number((wordErrors / expectedTokens.length).toFixed(4)),
    }
  })
}

function pooledScore(results) {
  const wordErrors = results.reduce(
    (total, result) => total + result.wordErrors,
    0,
  )
  const wordCount = results.reduce(
    (total, result) => total + result.wordCount,
    0,
  )
  return {
    wordErrors,
    wordCount,
    orderedWordErrorRate: Number((wordErrors / wordCount).toFixed(4)),
    orderedTokenAccuracy: Number((1 - wordErrors / wordCount).toFixed(4)),
  }
}

function tokenize(text) {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? []
}

function editDistance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + Number(left[row - 1] !== right[column - 1]),
      )
    }
    previous = current
  }
  return previous[right.length]
}

function round(value) {
  return Number(value.toFixed(2))
}
