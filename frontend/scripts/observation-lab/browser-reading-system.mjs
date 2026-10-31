// Controlled full-app smoke: real capture/session/HTTP/DB, scripted external model.
// Start reading_system_server.py on 8000 and this candidate's Vite on 4000 first.
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, expect, request } from "@playwright/test"
import dotenv from "dotenv"

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
)
dotenv.config({ path: path.join(root, ".env"), quiet: true })
dotenv.config({
  path: path.join(root, ".env.local"),
  override: true,
  quiet: true,
})
const base = "http://127.0.0.1:4000"
const api = await request.newContext({ baseURL: base })
const checks = []
let adminToken
let userToken
let userId
let browser
let currentPage
const threadIds = []
const cancelledOperations = []
const resultPath = path.join(root, "docs/observation/system-smoke-result.json")

async function jsonResponse(response) {
  assert(response.ok(), `HTTP ${response.status()}`)
  return response.json()
}

async function login(username, password) {
  const data = await jsonResponse(
    await api.post("/api/v1/login/access-token", {
      form: { username, password },
    }),
  )
  return data.access_token
}

function headers(token) {
  return { Authorization: `Bearer ${token}` }
}

async function makeThread(title) {
  const thread = await jsonResponse(
    await api.post("/api/v1/ai/threads/", {
      headers: headers(userToken),
      data: { prompt: title, model: "gpt-5.6-luna" },
    }),
  )
  threadIds.push(thread.id)
  return thread.id
}

async function installSource(page) {
  await page.addInitScript(() => {
    let pageNumber = 1
    let track
    let paint
    window.__readingSource = {
      change() {
        pageNumber += 1
        paint?.()
      },
      end() {
        track?.dispatchEvent(new Event("ended"))
      },
    }
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 1280
      canvas.height = 800
      const ctx = canvas.getContext("2d")
      paint = () => {
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, 1280, 800)
        ctx.fillStyle = "#131820"
        ctx.font = "28px Arial"
        ctx.fillText(
          `Controlled reading page ${pageNumber} — badge P2R7`,
          45,
          48,
        )
        for (let i = 0; i < 18; i += 1) {
          ctx.fillText(
            `Section ${pageNumber}.${i}: water moon-basil after sunset; retain this visible detail.`,
            45,
            92 + i * 36,
          )
        }
      }
      paint()
      const stream = canvas.captureStream(12)
      track = stream.getVideoTracks()[0]
      const getSettings = track.getSettings.bind(track)
      track.getSettings = () => ({
        ...getSettings(),
        displaySurface: "browser",
      })
      return stream
    }
  })
}

async function checkCaptureClose({ page, input, preview, requests, mode }) {
  await page.waitForFunction(
    () => window.browserReadingDebug.snapshot().memory.notes.length > 0,
    null,
    { timeout: 35_000 },
  )
  await input.fill("What is the badge on the shared page?")
  const responseReady = page.waitForResponse((response) =>
    response.url().endsWith("/browser-chat"),
  )
  await input.press("Enter")
  const response = await responseReady
  assert.equal(response.status(), 200)
  const operationId = requests.at(-1).request_id
  let completed = false
  const finished = response.finished().then(() => {
    completed = true
  })
  assert.equal(completed, false)
  if (mode === "source") await page.evaluate(() => window.__readingSource.end())
  else {
    await preview.hover()
    await preview
      .getByRole("button", { name: "Stop sharing browser tab" })
      .click()
  }
  await preview.waitFor({ state: "detached" })
  const cleared = await page.evaluate(
    () => window.browserReadingDebug.snapshot().memory,
  )
  assert.equal(cleared.notes.length, 0)
  assert.equal(cleared.summary, "")
  await page
    .getByRole("button", { name: "Add attachment or browser tab" })
    .click()
  await page.getByRole("menuitem", { name: "Browser tab", exact: true }).click()
  await preview.waitFor({ state: "visible" })
  await expect(
    page.getByText(/Browser processing is still settling/),
  ).toHaveCount(0)
  assert.equal(cancelledOperations.includes(operationId), false)
  await finished
  const events = await response.text()
  assert(events.includes("event: text_delta"))
  assert(events.includes("The badge is P2R7."))
  assert.equal(events.includes("event: error"), false)
  assert.equal(cancelledOperations.includes(operationId), false)
  checks.push(
    `${mode} close clears memory and allows replacement sharing during a submitted question`,
  )
  checks.push(
    `${mode} close preserves the original answer without cancelling its operation`,
  )
}

try {
  adminToken = await login(
    process.env.FIRST_SUPERUSER,
    process.env.FIRST_SUPERUSER_PASSWORD,
  )
  const password = crypto.randomUUID()
  const email = `reading-smoke-${Date.now()}@example.com`
  const user = await jsonResponse(
    await api.post("/api/v1/users/signup", {
      headers: headers(adminToken),
      data: { email, password, full_name: "Reading smoke" },
    }),
  )
  userId = user.id
  userToken = await login(email, password)
  const owner = await makeThread("Controlled browser reading")
  const other = await makeThread("Other chat")
  browser = await chromium.launch({ channel: "chrome", headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  })
  await context.addInitScript(
    (token) => localStorage.setItem("access_token", token),
    userToken,
  )
  const page = await context.newPage()
  currentPage = page
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  const requests = []
  const readFrames = []
  page.on("request", (req) => {
    if (
      req.method() === "DELETE" &&
      req.url().includes("/ai/observation/operations/")
    )
      cancelledOperations.push(req.url().split("/").at(-1))
    if (req.url().endsWith("/browser-chat"))
      requests.push(JSON.parse(req.postData() || "{}"))
    if (req.url().endsWith("/ai/observation/read"))
      readFrames.push(JSON.parse(req.postData() || "{}").frame)
  })
  await installSource(page)
  await page.goto(`${base}/ai?threadId=${owner}`)
  await page.waitForFunction(() => Boolean(window.browserReadingDebug))
  await page.evaluate(() =>
    window.browserReadingDebug.enable({ content: true }),
  )
  await page
    .getByRole("button", { name: "Add attachment or browser tab" })
    .click()
  await page.getByRole("menuitem", { name: "Browser tab", exact: true }).click()
  const preview = page.getByRole("region", {
    name: "Shared browser tab preview",
    exact: true,
  })
  await preview.waitFor({ state: "visible" })
  const geometry = await preview.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const close = element.querySelector("button")
    return {
      x: box.x,
      width: box.width,
      position: style.position,
      radii: [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomLeftRadius,
        style.borderBottomRightRadius,
      ],
      closeOpacity: getComputedStyle(close).opacity,
    }
  })
  assert.equal(geometry.position, "fixed")
  assert(geometry.x < 400 && geometry.width > 150)
  assert.equal(new Set(geometry.radii).size, 1)
  assert.equal(geometry.closeOpacity, "0")
  checks.push("floating preview, symmetric radius, hover-only close")
  await page.waitForResponse(
    (response) =>
      response.url().endsWith("/ai/observation/read") && response.ok(),
    { timeout: 35_000 },
  )
  assert(readFrames.length >= 1)
  const initialFrame = readFrames[0].image_data_url
  assert(initialFrame)
  checks.push("actual video sampler and v3 pipeline produced a background note")
  const memory = await page.evaluate(
    () => window.browserReadingDebug.snapshot().memory,
  )
  assert(memory.notes.length >= 1)
  assert(memory.usedBytes > 0 && memory.usedBytes <= memory.maxBytes)
  assert(!JSON.stringify(memory).includes("image_data_url"))
  checks.push(
    "console debugger exposes detached browser notes and memory usage without image payloads",
  )
  // Real SPA thread navigation must preserve the native stream without attaching it elsewhere.
  await page.getByText("Other chat", { exact: true }).click()
  await page.waitForFunction(
    (id) => new URL(location.href).searchParams.get("threadId") === id,
    other,
  )
  await page.getByText("Controlled browser reading", { exact: true }).click()
  await page.waitForFunction(
    (id) => new URL(location.href).searchParams.get("threadId") === id,
    owner,
  )
  await page
    .getByRole("region", { name: "Shared browser tab preview", exact: true })
    .waitFor()
  checks.push("sharing survives SPA chat navigation")
  const input = page.getByPlaceholder("Ask anything")
  await input.fill("What is the badge on the shared page?")
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/browser-chat"),
  )
  await input.press("Enter")
  const firstResponse = await responsePromise
  assert.equal(firstResponse.status(), 200)
  let firstResponseFinished = false
  const firstFinished = firstResponse.finished().then(() => {
    firstResponseFinished = true
  })
  await page
    .getByText("The badge is P2R7.", { exact: false })
    .waitFor({ timeout: 20_000 })
  assert.equal(
    firstResponseFinished,
    false,
    "answer text is visible while the separate title generation is still pending",
  )
  assert.equal(requests.length, 1)
  assert(requests[0].browser_context.notes.length >= 1)
  assert.equal(requests[0].request_id.length, 36)
  const budget = await page.evaluate(
    () => window.browserReadingDebug.snapshot().budget,
  )
  assert(budget)
  assert(budget.input_limit > 12_000)
  assert(budget.input_limit < budget.model_input_capacity)
  assert(budget.estimated_input_tokens <= budget.input_limit)
  checks.push(
    "console budget uses the selected model window with reserved output space",
  )
  checks.push("question uses temporary notes through real browser-chat runner")
  await page.getByText("Shared Page Details", { exact: true }).waitFor()
  await firstFinished
  const namedThread = await jsonResponse(
    await api.get(`/api/v1/ai/threads/${owner}`, {
      headers: headers(userToken),
    }),
  )
  assert.equal(namedThread.title, "Shared Page Details")
  checks.push(
    "first browser answer is visible before title generation updates the sidebar",
  )
  assert.equal(
    await page.getByRole("region", { name: "Browser context tools" }).count(),
    0,
  )
  assert.equal(
    await page.getByText("Browser context incomplete", { exact: true }).count(),
    0,
  )
  checks.push(
    "answers from retained context finish without a fake tool trace or incomplete heading",
  )
  const nextRead = page.waitForRequest((req) =>
    req.url().endsWith("/ai/observation/read"),
  )
  await page.evaluate(() => window.__readingSource.change())
  const changedRead = await nextRead
  const changedFrame = JSON.parse(changedRead.postData() || "{}").frame
  assert(changedFrame?.image_data_url)
  assert.notEqual(changedFrame.image_data_url, initialFrame)
  checks.push(
    "stationary initial view was captured and later changed view read after its only paint",
  )
  await page.waitForTimeout(800)
  await page.evaluate(() => window.__readingSource.change())
  await page.waitForTimeout(1000)
  await page.evaluate(() => window.__readingSource.change())
  await page.waitForTimeout(1000)
  await input.fill("Summarize everything including the shared badge")
  const batchResponse = page.waitForResponse((response) =>
    response.url().endsWith("/browser-chat"),
  )
  await input.press("Enter")
  await expect(input).toHaveValue("", { timeout: 1_000 })
  const nextDraft =
    "A separate draft typed while the images are still processing"
  await input.fill(nextDraft)
  // The question must appear before the in-flight read has completed, even
  // when that read takes longer than the old 15-second cancellation deadline.
  await page
    .getByLabel("Messages")
    .getByText("Summarize everything including the shared badge", {
      exact: true,
    })
    .waitFor({ timeout: 2_000 })
  assert.equal(
    requests.length,
    1,
    "wait for current read before starting question inference",
  )
  checks.push(
    "prompt appears immediately while the background read is still active",
  )
  checks.push("submitted draft clears before the active image read completes")
  const batch = await batchResponse
  assert.equal(batch.status(), 200)
  const tools = page.getByRole("region", { name: "Browser context tools" })
  const activeStatus = tools.getByRole("status", {
    name: "Image transcription",
  })
  await activeStatus.waitFor()
  assert.equal(await activeStatus.getAttribute("aria-busy"), "true")
  assert.equal(await activeStatus.locator("svg.lucide-image").count(), 0)
  assert.equal(await tools.getByRole("button").count(), 0)
  const initialStatus = await activeStatus.textContent()
  await page.waitForTimeout(2400)
  assert.notEqual(await activeStatus.textContent(), initialStatus)
  assert.equal(
    await tools.getByRole("status", { name: "Image transcription" }).count(),
    1,
  )
  assert.equal(
    await page.getByRole("button", { name: "Toggle thinking details" }).count(),
    0,
  )
  await page.screenshot({
    path: path.join(root, "docs/observation/system-smoke-running.png"),
  })
  checks.push(
    "one rotating active status shows image progress without a pending image icon or thinking wrapper",
  )
  await tools
    .getByRole("button", { name: "Read image 1 of 2", exact: true })
    .waitFor({ timeout: 30_000 })
  await activeStatus.getByText("2 of 2 images", { exact: true }).waitFor()
  assert.equal(
    await tools.getByRole("status", { name: "Image transcription" }).count(),
    1,
  )
  await page.screenshot({
    path: path.join(root, "docs/observation/system-smoke-progress.png"),
  })
  checks.push(
    "completed first-image preview remains while the single active status advances to image two",
  )
  const batchEvents = await batch.text()
  assert(batchEvents.includes("event: browser_activity"))
  assert(batchEvents.includes("Reading shared view."))
  assert.equal(requests.length, 2)
  assert(requests[1].browser_context.pending_frames.length >= 1)
  assert(requests[1].browser_context.pending_frames.length <= 2)
  assert(batchEvents.includes("event: browser_note"))
  assert(batchEvents.includes("event: browser_receipt"))
  await page
    .getByText("The badge is P2R7.", { exact: false })
    .last()
    .waitFor({ timeout: 30_000 })
  await expect(input).toHaveValue(nextDraft)
  checks.push("later typing survives delayed browser question acknowledgement")
  checks.push(
    "frozen pending batch uses sequential wait/read/reevaluate with transient note receipts",
  )
  await tools
    .getByRole("button", { name: /^Read image/ })
    .first()
    .waitFor()
  await tools
    .getByRole("button", { name: /^Read image/ })
    .first()
    .click()
  await tools
    .getByText(
      "Controlled shared page. Badge P2R7; water moon-basil after sunset.",
      { exact: true },
    )
    .first()
    .waitFor()
  assert.equal(await tools.getByText(/Read [0-9]+ characters/).count(), 0)
  assert.equal(await tools.locator("svg.animate-spin").count(), 0)
  assert.equal(
    await tools.getByRole("status", { name: "Image transcription" }).count(),
    0,
  )
  checks.push(
    "completed image tools show extracted content instead of counts after transcript refresh",
  )
  const saved = await jsonResponse(
    await api.get(`/api/v1/ai/threads/${owner}`, {
      headers: headers(userToken),
    }),
  )
  assert.deepEqual(
    saved.transcript.messages.map((message) => message.role),
    ["user", "assistant", "user", "assistant"],
  )
  assert(!JSON.stringify(saved.transcript).includes("browser_context"))
  assert(!JSON.stringify(saved.transcript).includes("image_data_url"))
  assert(!JSON.stringify(saved.transcript).includes("note_preview"))
  checks.push("Postgres stores only ordinary user/final assistant turns")
  await page.mouse.move(1, 1)
  await page.screenshot({
    path: path.join(root, "docs/observation/system-smoke.png"),
  })
  await input.fill("Explain Python tuples in one sentence.")
  const generalResponse = page.waitForResponse((response) =>
    response.url().endsWith("/browser-chat"),
  )
  await input.press("Enter")
  assert.equal((await generalResponse).status(), 200)
  await page
    .getByText("Python tuples are immutable sequences.", { exact: true })
    .waitFor()
  assert.equal(
    await page.getByText("Browser context incomplete", { exact: true }).count(),
    0,
  )
  checks.push(
    "sharing stays active while a general-knowledge answer uses no browser evidence",
  )
  await input.fill("Exercise invalid browser evaluation")
  const failureResponse = page.waitForResponse((response) =>
    response.url().endsWith("/browser-chat"),
  )
  await input.press("Enter")
  const failure = await failureResponse
  assert.equal(failure.status(), 200)
  const failureEvents = await failure.text()
  const errorBlocks = failureEvents
    .split("\n\n")
    .filter((block) => block.startsWith("event: error\n"))
  assert.equal(errorBlocks.length, 1)
  const failureDetail = JSON.parse(errorBlocks[0].split("\ndata: ")[1])
  assert.equal(failureDetail.code, "evaluation_invalid_output")
  assert.equal(typeof failureDetail.operation_id, "string")
  await expect(
    page
      .getByLabel("Messages")
      .getByText(`(Error: ${failureDetail.message})`, { exact: true }),
  ).toHaveCount(1)
  await expect(page.getByText(/Stream ended before completion/)).toHaveCount(0)
  await expect(
    page.getByText("This unvalidated answer must never be displayed."),
  ).toHaveCount(0)
  const afterFailure = await jsonResponse(
    await api.get(`/api/v1/ai/threads/${owner}`, {
      headers: headers(userToken),
    }),
  )
  assert.deepEqual(
    afterFailure.transcript.messages.map((message) => message.role),
    ["user", "assistant", "user", "assistant", "user", "assistant", "user"],
  )
  checks.push(
    "invalid model evaluation displays one classified error and persists no fabricated answer",
  )
  for (const mode of ["preview", "source"])
    await checkCaptureClose({ page, input, preview, requests, mode })
  await preview.hover()
  await preview
    .getByRole("button", { name: "Stop sharing browser tab" })
    .click()
  await preview.waitFor({ state: "detached" })
  const stoppedMemory = await page.evaluate(() =>
    window.browserReadingDebug.snapshot(),
  )
  assert.equal(stoppedMemory.memory.notes.length, 0)
  assert.equal(stoppedMemory.memory.summary, "")
  assert.equal(stoppedMemory.budget, null)
  await page.reload()
  assert.equal(await preview.count(), 0)
  assert.deepEqual(errors, [])
  checks.push("Stop and reload clear browser context without UI errors")
  await writeFile(
    resultPath,
    `${JSON.stringify(
      { passed: true, model: "scripted external provider", checks },
      null,
      2,
    )}\n`,
  )
  console.log(JSON.stringify({ passed: true, checks }))
} catch (error) {
  await mkdir(path.dirname(resultPath), { recursive: true })
  await writeFile(
    resultPath,
    `${JSON.stringify({ passed: false, checks, error: error.message }, null, 2)}\n`,
  )
  if (currentPage) {
    console.error(`controlled failure URL: ${currentPage.url()}`)
    await currentPage.screenshot({
      path: path.join(root, "docs/observation/system-smoke-failure.png"),
    })
  }
  console.error(error.message)
  process.exitCode = 1
} finally {
  await browser?.close()
  if (userToken) {
    for (const id of threadIds)
      await api.delete(`/api/v1/ai/threads/${id}`, {
        headers: headers(userToken),
      })
  }
  if (userId)
    await api.delete(`/api/v1/users/${userId}`, {
      headers: headers(adminToken),
    })
  await api.dispose()
}
