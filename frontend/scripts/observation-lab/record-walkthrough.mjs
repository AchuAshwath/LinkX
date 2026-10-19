import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdir, rename } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { chromium } from "@playwright/test"

const port = 4003
const url = `http://127.0.0.1:${port}/observation-lab.html`
const output = path.resolve(
  process.argv[2] ??
    path.join(os.tmpdir(), "linkx-observation-lab-walkthrough.webm"),
)
const tempDir = await mkdir(
  path.join(os.tmpdir(), `linkx-lab-video-${process.pid}`),
  { recursive: true },
).then(() => path.join(os.tmpdir(), `linkx-lab-video-${process.pid}`))
const server = spawn(
  "bun",
  [
    "run",
    "dev",
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  {
    cwd: path.resolve(import.meta.dirname, "../.."),
    stdio: "ignore",
  },
)
let browser

try {
  await waitForServer()
  browser = await chromium.launch({ channel: "chrome", headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: tempDir, size: { width: 1440, height: 1000 } },
  })
  const page = await context.newPage()
  await page.goto(url)
  await page.getByLabel("OCR comparison case").selectOption("columns")
  await page.getByLabel("Scenario").selectOption("two-columns")
  await page.getByRole("button", { name: "Replay scenario" }).click()
  await page
    .getByRole("status")
    .filter({ hasText: "Replay complete" })
    .waitFor()
  await page
    .getByLabel("Proposed correction (local only)")
    .fill("Suggested local correction for review")
  await page
    .getByRole("button", { name: "Save correction in this session" })
    .click()
  await page.waitForTimeout(500)
  const video = page.video()
  await context.close()
  const videoPath = await video.path()
  await rename(videoPath, output)
  console.log(`Saved local lab walkthrough: ${output}`)
} finally {
  await browser?.close()
  server.kill("SIGTERM")
  await once(server, "exit").catch(() => undefined)
}

async function waitForServer() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Lab server did not become ready at ${url}`)
}
