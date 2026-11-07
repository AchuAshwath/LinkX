// Real app regression with a barrier-controlled external model test double.
// Backend: uv run --no-sync python -m scripts.observation_lab.pending_capture_server
// Frontend: VITE_API_URL=http://127.0.0.1:8001 bun run dev --port 4001 --strictPort
// Run from frontend: bun scripts/observation-lab/pending-capture-close.mjs
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
const base = "http://127.0.0.1:4001"
const api = await request.newContext({ baseURL: base })
const controls = await request.newContext({ baseURL: "http://127.0.0.1:8001" })
const output = path.join(root, "docs/observation/pending-capture-close")
const answer = "The access code is SAPPHIRE-742."
const runDate = "2026-11-06"
const regressionControl = process.argv.includes("--regression-control")
const resultFile = regressionControl ? "regression-control.json" : "result.json"
const checks = []
const threads = []
let browser
let userId
let userToken
let adminToken

async function json(response) {
  assert(response.ok(), `HTTP ${response.status()}: ${await response.text()}`)
  return response.json()
}

function auth(token) {
  return { Authorization: `Bearer ${token}` }
}

async function login(email, password) {
  const data = await json(
    await api.post("/api/v1/login/access-token", {
      form: { username: email, password },
    }),
  )
  return data.access_token
}

async function fixtureState() {
  return json(await controls.get("/__test__/state"))
}

async function waitForRead(label) {
  await expect
    .poll(
      async () => {
        const state = await fixtureState()
        return state.events.some(
          (event) => event.phase === "read_started" && event.label === label,
        )
      },
      { timeout: 15_000 },
    )
    .toBe(true)
}

async function release(label) {
  await json(await controls.post(`/__test__/release/${label}`))
}

async function installSource(page) {
  await page.addInitScript(() => {
    let view = 0
    let paint
    let track
    window.__pendingSource = {
      show(number) {
        view = number
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
      const colors = ["rgb(180,20,20)", "rgb(20,180,20)", "rgb(20,20,180)"]
      const facts = [
        "Welcome page. No access code is shown.",
        "The loading dock opens at nine. No access code is shown.",
        "The access code is SAPPHIRE-742.",
      ]
      paint = () => {
        ctx.fillStyle = "white"
        ctx.fillRect(0, 0, 1280, 800)
        ctx.fillStyle = colors[view]
        ctx.fillRect(0, 0, 1280, 70)
        ctx.fillStyle = "#131820"
        ctx.font = "28px Arial"
        for (let row = 0; row < 18; row += 1)
          ctx.fillText(
            `View ${view}, line ${row}: ${facts[view]}`,
            45,
            105 + row * 36,
          )
      }
      paint()
      const stream = canvas.captureStream(12)
      track = stream.getVideoTracks()[0]
      const settings = track.getSettings.bind(track)
      track.getSettings = () => ({ ...settings(), displaySurface: "browser" })
      return stream
    }
  })
}

async function installStreamCapture(page) {
  await page.addInitScript(() => {
    window.__browserChatStreams = []
    const fetchOriginal = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const response = await fetchOriginal(input, init)
      const requestUrl = input instanceof Request ? input.url : String(input)
      if (
        new URL(requestUrl, window.location.href).pathname.endsWith(
          "/browser-chat",
        )
      ) {
        void response
          .clone()
          .text()
          .then((body) => window.__browserChatStreams.push(body))
      }
      return response
    }
  })
}

async function installRegressionControl(page) {
  if (!regressionControl) return
  // Mutate only this browser's served module, never the working tree or normal app.
  await page.route("**/src/observation/reading/session.ts*", async (route) => {
    const response = await route.fetch()
    const body = await response.text()
    const original = "...blockedOperations,"
    assert(body.includes(original), "The regression injection point must exist")
    await route.fulfill({
      response,
      body: body.replace(original, `${original}\n question?.operationId,`),
    })
  })
}

async function startCase(mode) {
  await json(await controls.post("/__test__/reset"))
  const thread = await json(
    await api.post("/api/v1/ai/threads/", {
      headers: auth(userToken),
      data: { prompt: `Pending close ${mode}`, model: "gpt-5.6-luna" },
    }),
  )
  threads.push(thread.id)
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  })
  await page.addInitScript(
    (token) => localStorage.setItem("access_token", token),
    userToken,
  )
  await installSource(page)
  await installStreamCapture(page)
  await installRegressionControl(page)
  const observed = { requests: [], cancelled: [], errors: [] }
  page.on("pageerror", (error) => observed.errors.push(error.message))
  page.on("request", (req) => {
    if (req.url().endsWith("/browser-chat"))
      observed.requests.push(req.postDataJSON())
    if (
      req.method() === "DELETE" &&
      req.url().includes("/ai/observation/operations/")
    )
      observed.cancelled.push(req.url().split("/").at(-1))
  })
  await page.goto(`${base}/ai?threadId=${thread.id}`)
  await page.waitForFunction(() => Boolean(window.browserReadingDebug))
  await page
    .getByRole("button", { name: "Add attachment or browser tab" })
    .click()
  await page.getByRole("menuitem", { name: "Browser tab", exact: true }).click()
  await waitForRead("warmup")
  for (const view of [1, 2]) {
    await page.evaluate((number) => window.__pendingSource.show(number), view)
    await page.waitForFunction(
      (count) => window.browserReadingDebug.snapshot().queue.pending === count,
      view,
    )
  }
  return { page, thread, observed, mode }
}

async function submitCase(test) {
  const { page, observed } = test
  const responseReady = page.waitForResponse((response) =>
    response.url().endsWith("/browser-chat"),
  )
  const input = page.getByPlaceholder("Ask anything")
  await input.fill("What is the access code on the shared page?")
  await input.press("Enter")
  await expect(input).toHaveValue("")
  await page
    .getByLabel("Messages")
    .getByText("What is the access code on the shared page?", { exact: true })
    .waitFor()
  await release("warmup")
  const response = await responseReady
  assert.equal(response.status(), 200)
  await waitForRead("first")
  assert.equal(observed.requests.length, 1)
  const payload = observed.requests[0]
  assert.equal(payload.browser_context.pending_frames.length, 2)
  assert(
    !JSON.stringify(payload.browser_context.notes).includes("SAPPHIRE-742"),
  )
  const status = page.getByRole("status", { name: "Image transcription" })
  await expect(status.getByText("1 of 2 images", { exact: true })).toBeVisible()
  await expect(page.getByText(answer, { exact: true })).toHaveCount(0)
  const state = await fixtureState()
  assert(!state.events.some((event) => event.label === "second"))
  assert(!state.events.some((event) => event.decision === "answer"))
  return { operationId: payload.request_id, status }
}

async function closeSharing(test) {
  const preview = test.page.getByRole("region", {
    name: "Shared browser tab preview",
    exact: true,
  })
  if (test.mode === "source")
    await test.page.evaluate(() => window.__pendingSource.end())
  else {
    await preview.hover()
    await preview
      .getByRole("button", { name: "Stop sharing browser tab" })
      .click()
  }
  await preview.waitFor({ state: "detached" })
  const snapshot = await test.page.evaluate(() =>
    window.browserReadingDebug.snapshot(),
  )
  assert.equal(snapshot.state, "stopped")
  assert.deepEqual(snapshot.memory.notes, [])
  assert.equal(snapshot.memory.summary, "")
}

function eventsOf(text, name) {
  return text
    .split("\n\n")
    .filter((block) => block.startsWith(`event: ${name}\n`))
    .map((block) => JSON.parse(block.split("\ndata: ")[1]))
}

async function verifyAnswer(test, submitted) {
  const { page, observed, mode, thread } = test
  await release("first")
  await waitForRead("second")
  await expect(
    submitted.status.getByText("2 of 2 images", { exact: true }),
  ).toBeVisible()
  await expect(page.getByText(answer, { exact: true })).toHaveCount(0)
  assert(!observed.cancelled.includes(submitted.operationId))
  await page.screenshot({ path: path.join(output, `${mode}-after-close.png`) })
  await release("second")
  await expect
    .poll(() => page.evaluate(() => window.__browserChatStreams.length))
    .toBe(1)
  const text = await page.evaluate(() => window.__browserChatStreams[0])
  assert.deepEqual(eventsOf(text, "error"), [])
  const answerChunks = eventsOf(text, "text_delta").map(
    (event) => event.content,
  )
  assert(
    answerChunks.length >= 2,
    "the final agent answer must contain real chunks",
  )
  assert.equal(answerChunks.join(""), answer)
  const ids = observed.requests[0].browser_context.pending_frames.map(
    (frame) => frame.id,
  )
  assert.deepEqual(
    eventsOf(text, "browser_note").map((note) => note.id),
    ids,
  )
  const notes = eventsOf(text, "browser_note")
  assert(!notes[0].text.includes("SAPPHIRE-742"))
  assert(notes[1].text.includes("SAPPHIRE-742"))
  assert.deepEqual(eventsOf(text, "browser_receipt")[0], {
    operation_id: submitted.operationId,
    completed_ids: ids,
    failed_ids: [],
    unused_ids: [],
  })
  await expect(
    page.getByLabel("Messages").getByText(answer, { exact: true }),
  ).toBeVisible()
  const saved = await json(
    await api.get(`/api/v1/ai/threads/${thread.id}`, {
      headers: auth(userToken),
    }),
  )
  assert.deepEqual(
    saved.transcript.messages.map((message) => message.role),
    ["user", "assistant"],
  )
  assert.equal(saved.transcript.messages[1].parts[0].text, answer)
  assert(!JSON.stringify(saved.transcript).includes("image_data_url"))
  assert(!JSON.stringify(saved.transcript).includes("First view:"))
  const memory = await page.evaluate(
    () => window.browserReadingDebug.snapshot().memory,
  )
  assert.deepEqual(memory.notes, [])
  assert.equal(memory.summary, "")
  assert(!observed.cancelled.includes(submitted.operationId))
  assert.deepEqual(observed.errors, [])
  const state = await fixtureState()
  assert.deepEqual(
    state.events
      .filter((event) => event.phase === "read_completed")
      .map((event) => event.label),
    ["warmup", "first", "second"],
  )
  checks.push({ mode, passed: true, events: state.events })
}

async function verifyExplicitStop(test, submitted) {
  const { page, observed, thread } = test
  await page
    .getByRole("button", { name: "Stop generating", exact: true })
    .click()
  await expect
    .poll(() => observed.cancelled.includes(submitted.operationId))
    .toBe(true)
  await release("first")
  await expect.poll(async () => (await fixtureState()).active).toBe(0)
  await expect
    .poll(async () => {
      const state = await json(
        await api.get(
          `/api/v1/ai/observation/operations/${submitted.operationId}`,
          { headers: auth(userToken) },
        ),
      )
      return state.state
    })
    .toBe("settled")
  const state = await fixtureState()
  assert(!state.events.some((event) => event.label === "second"))
  assert(!state.events.some((event) => event.decision === "answer"))
  await expect(page.getByText(answer, { exact: true })).toHaveCount(0)
  const saved = await json(
    await api.get(`/api/v1/ai/threads/${thread.id}`, {
      headers: auth(userToken),
    }),
  )
  assert.deepEqual(
    saved.transcript.messages.map((message) => message.role),
    ["user"],
  )
  checks.push({ mode: "chat-stop", passed: true, events: state.events })
  await closeSharing(test)
}

async function assertCaptureDoesNotCancel(test, submitted) {
  if (regressionControl)
    await expect
      .poll(() => test.observed.cancelled.includes(submitted.operationId))
      .toBe(true)
  assert(
    !test.observed.cancelled.includes(submitted.operationId),
    "Closing sharing must not cancel the dispatched question before image 2",
  )
}

async function runCase(mode) {
  const test = await startCase(mode)
  try {
    const submitted = await submitCase(test)
    await test.page.screenshot({
      path: path.join(output, `${mode}-before-close.png`),
    })
    if (mode === "chat-stop") await verifyExplicitStop(test, submitted)
    else {
      await closeSharing(test)
      await assertCaptureDoesNotCancel(test, submitted)
      await verifyAnswer(test, submitted)
    }
  } catch (error) {
    await test.page.screenshot({
      path: path.join(output, `${mode}-failure.png`),
    })
    throw error
  } finally {
    for (const label of ["warmup", "first", "second"]) await release(label)
    await test.page.close()
  }
}

try {
  await mkdir(output, { recursive: true })
  adminToken = await login(
    process.env.FIRST_SUPERUSER,
    process.env.FIRST_SUPERUSER_PASSWORD,
  )
  const email = `pending-capture-${Date.now()}@example.com`
  const password = crypto.randomUUID()
  const user = await json(
    await api.post("/api/v1/users/signup", {
      data: { email, password, full_name: "Pending capture regression" },
    }),
  )
  userId = user.id
  userToken = await login(email, password)
  browser = await chromium.launch({ channel: "chrome", headless: true })
  const modes = regressionControl
    ? ["preview"]
    : ["preview", "source", "chat-stop"]
  for (const mode of modes) await runCase(mode)
  await writeFile(
    path.join(output, resultFile),
    `${JSON.stringify({ passed: true, run_date: runDate, provider: "barrier-controlled synthetic fixture", checks }, null, 2)}\n`,
  )
  console.log(JSON.stringify({ passed: true, checks }))
} catch (error) {
  await writeFile(
    path.join(output, resultFile),
    `${JSON.stringify({ passed: false, run_date: runDate, checks, error: error.message }, null, 2)}\n`,
  )
  console.error(error)
  process.exitCode = 1
} finally {
  await browser?.close()
  for (const id of threads)
    await api.delete(`/api/v1/ai/threads/${id}`, { headers: auth(userToken) })
  if (userId)
    await api.delete(`/api/v1/users/${userId}`, { headers: auth(adminToken) })
  await api.dispose()
  await controls.dispose()
}
