/** Controlled local integration demo. No credentials or raw packets are written. */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const frontend = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
)
const base = new URL(
  process.env.OBSERVATION_DEMO_URL || "http://127.0.0.1:4002",
)
const api = new URL(process.env.OBSERVATION_API_URL || "http://127.0.0.1:8001")
for (const url of [base, api]) {
  assert(
    ["localhost", "127.0.0.1"].includes(url.hostname),
    "Use a local demo server",
  )
}
const output =
  process.env.OBSERVATION_DEMO_OUTPUT || "/tmp/linkx-observation-final-demo"
await mkdir(output, { recursive: true })

function localToken() {
  const code = `import httpx,os\nfrom app.core.config import settings\nr=httpx.post(os.environ['OBSERVATION_API_URL']+'/api/v1/login/access-token',data={'username':settings.FIRST_SUPERUSER,'password':settings.FIRST_SUPERUSER_PASSWORD})\nr.raise_for_status()\nprint(r.json()['access_token'])`
  try {
    return execFileSync("uv", ["run", "python", "-c", code], {
      cwd: path.resolve(frontend, "../backend"),
      env: { ...process.env, OBSERVATION_API_URL: api.origin },
      stdio: ["ignore", "pipe", "pipe"],
    })
      .toString()
      .trim()
  } catch {
    throw new Error(
      "Could not authenticate with the local configured demo account",
    )
  }
}

const results = {
  mode: "live-provider-current-view-integration",
  environment: {},
  turns: [],
}

let browser, context, thread, demoUser, authorization, adminAuthorization
try {
  browser = await chromium.launch({
    channel: "chrome",
    headless: process.env.OBSERVATION_DEMO_HEADED !== "1",
    args: [
      "--auto-select-tab-capture-source-by-title=LinkX observation final demo",
      "--disable-backgrounding-occluded-windows",
      "--disable-background-timer-throttling",
    ],
  })
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: {
      dir: path.join(output, "recording"),
      size: { width: 1440, height: 1000 },
    },
  })
  adminAuthorization = { Authorization: `Bearer ${localToken()}` }
  const email = `observation-demo-${randomUUID()}@example.com`
  const password = randomBytes(24).toString("hex")
  const demoUserResponse = await context.request.post(
    `${api.origin}/api/v1/users/`,
    {
      headers: adminAuthorization,
      data: { email, password, full_name: "Observation Demo" },
    },
  )
  assert(demoUserResponse.ok(), "Create isolated synthetic demo account")
  demoUser = await demoUserResponse.json()
  const login = await context.request.post(
    `${api.origin}/api/v1/login/access-token`,
    {
      form: { username: email, password },
    },
  )
  assert(login.ok(), "Authenticate isolated demo account")
  const { access_token: token } = await login.json()
  await context.addInitScript(
    (value) => localStorage.setItem("access_token", value),
    token,
  )
  authorization = { Authorization: `Bearer ${token}` }
  const created = await context.request.post(
    `${api.origin}/api/v1/ai/threads/`,
    {
      headers: authorization,
      data: { title: "Synthetic observation integration demo" },
    },
  )
  assert(created.ok(), "Create isolated demo thread")
  thread = await created.json()
  const source = await context.newPage()
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  const externalRequests = []
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (["localhost", "127.0.0.1"].includes(url.hostname))
      return route.continue()
    externalRequests.push({
      host: url.hostname,
      method: route.request().method(),
    })
    return route.abort()
  })
  await page.addInitScript(() => {
    window.__observationDemoTimings = []
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (...args) => {
      const url = typeof args[0] === "string" ? args[0] : args[0].url
      const startedAt = performance.now()
      const response = await originalFetch(...args)
      if (!url?.endsWith("/chat") || !response.body) return response
      const timing = { firstTextDeltaMs: null, completeMs: null }
      window.__observationDemoTimings.push(timing)
      const decoder = new TextDecoder()
      let text = ""
      const body = response.body.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            text = (text + decoder.decode(chunk, { stream: true })).slice(
              -10000,
            )
            if (
              timing.firstTextDeltaMs === null &&
              text.includes("event: text_delta")
            ) {
              timing.firstTextDeltaMs = performance.now() - startedAt
            }
            controller.enqueue(chunk)
          },
          flush() {
            timing.completeMs = performance.now() - startedAt
          },
        }),
      )
      return new Response(body, {
        status: response.status,
        headers: response.headers,
      })
    }
  })
  const requests = []
  page.on("request", (request) => {
    if (!request.url().endsWith("/chat") || request.method() !== "POST") return
    const body = request.postDataJSON()
    const packet = body.observation
    if (!packet) {
      requests.push({ observation: false })
      return
    }
    requests.push({
      startedAt: performance.now(),
      message: body.message,
      revision: packet.revision,
      sourceEpoch: packet.source_epoch,
      width: packet.width,
      height: packet.height,
      encodedCharacters: packet.image_data_url?.length,
      prepareMs:
        Date.parse(packet.delivered_at) - Date.parse(packet.captured_at),
    })
  })

  async function ask(question, expectedCode, expectedInstruction) {
    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/chat"),
    )
    await page.getByPlaceholder("Ask anything").fill(question)
    const started = performance.now()
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click()
    const response = await responsePromise
    assert.equal(response.status(), 200)
    const responseHeadersMs = performance.now() - started
    const stream = await response.text()
    const chunks = [...stream.matchAll(/event: text_delta\s+data: (.+)/g)]
      .map((match) => JSON.parse(match[1]).content)
      .join("")
    const usageMatch = stream.match(/event: observation_usage\s+data: (.+)/)
    assert(usageMatch, "Usage must come from the actual backend budget")
    const usage = JSON.parse(usageMatch[1])
    await writeFile(
      path.join(output, `attempt-${requests.length}.json`),
      JSON.stringify({ usage, answer: chunks }, null, 2),
    )
    assert(
      chunks.includes(expectedCode),
      "Answer must identify image-only code",
    )
    assert(
      chunks.toLowerCase().includes(expectedInstruction),
      "Answer must identify instruction",
    )
    assert.equal(usage.frame_count, 1)
    assert.equal(usage.history_frames, 0)
    assert(usage.estimated_input_tokens <= usage.input_limit)
    assert(usage.output_reserve > 0)
    assert(
      !stream.includes("event: tool_start"),
      "Observation cannot invoke tools",
    )
    await page.waitForFunction(
      () => window.__observationDemoTimings.at(-1)?.completeMs !== null,
    )
    const timing = await page.evaluate(() =>
      window.__observationDemoTimings.at(-1),
    )
    return {
      ...timing,
      usage,
      answer: chunks,
      responseHeadersMs,
      totalMs: performance.now() - started,
    }
  }

  await source.goto(`${base.origin}/scripts/observation-demo/source.html`)
  await page.goto(`${base.origin}/ai?threadId=${thread.id}`)
  await page.getByPlaceholder("Ask anything").waitFor()
  await page
    .getByRole("button", { name: "Add attachment or browser tab" })
    .focus()
  const setupStart = performance.now()
  await page.keyboard.press("Enter")
  await page
    .getByRole("menuitem", { name: "Browser tab", exact: true })
    .press("Enter")
  await page.waitForFunction(() => {
    const video = document.querySelector("#browser-observation-preview video")
    return video?.readyState >= 2 && video.videoWidth > 0
  })
  results.captureSetupMs = performance.now() - setupStart
  results.environment = await page
    .locator("#browser-observation-preview video")
    .evaluate((video) => ({
      browser: navigator.userAgent,
      track: ((s) => ({
        displaySurface: s.displaySurface,
        frameRate: s.frameRate,
        width: s.width,
        height: s.height,
      }))(video.srcObject.getVideoTracks()[0].getSettings()),
      width: video.videoWidth,
      height: video.videoHeight,
      audioTracks: video.srcObject.getAudioTracks().length,
    }))
  assert.equal(results.environment.track.displaySurface, "browser")
  assert.equal(results.environment.audioTracks, 0)
  results.sourceHasBrightNotice = await page
    .locator("#browser-observation-preview video")
    .evaluate((video) => {
      const canvas = document.createElement("canvas")
      canvas.width = 16
      canvas.height = 16
      const ctx = canvas.getContext("2d")
      ctx.drawImage(video, 0, 0, 16, 16)
      const pixels = ctx.getImageData(0, 0, 16, 16).data
      let bright = 0
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] > 180 && pixels[i + 1] > 180 && pixels[i + 2] > 180)
          bright++
      return bright > 80
    })
  assert(
    results.sourceHasBrightNotice,
    "Capture must select the synthetic notice, not the app itself",
  )
  await page.waitForTimeout(400)
  results.turns.push(
    await ask(
      "Read the code and instruction in the shared notice.",
      "B7Q2M",
      "east shade",
    ),
  )
  await source.getByRole("button", { name: "Next notice" }).press("Enter")
  await page.bringToFront()
  await page.waitForTimeout(500)
  results.turns.push(
    await ask(
      "Read the code and instruction currently visible. If the view changed, use only the current notice.",
      "R4X9K",
      "moon basil",
    ),
  )
  assert.equal(requests.length, 2, "One explicit chat POST per user question")
  assert.equal(requests[1].revision, requests[0].revision + 1)
  const transcriptResponse = await context.request.get(
    `${api.origin}/api/v1/ai/threads/${thread.id}`,
    { headers: authorization },
  )
  const transcript = await transcriptResponse.text()
  assert(
    !transcript.includes("data:image"),
    "No raw screenshots in transcript API",
  )
  assert(
    !transcript.includes("image_data_url"),
    "No observation packet in transcript API",
  )
  results.transcriptContainsImages = false
  results.requests = requests.map(({ startedAt, ...metadata }) => metadata)
  results.blockedBrowserExternalRequests = externalRequests
  results.uploadMs = null
  results.providerOnlyMs = null
  results.notes = [
    "First text-delta latency is measured at the browser streaming fetch boundary; response headers are measured separately.",
    "Source changes were scripted on a fictional fixture, not a manually operated platform.",
    "Cold = first turn in a fresh browser context; warm = second turn. Provider cache state is unknown.",
    "Browser external requests are blocked; backend provider transport is not observed by browser egress inspection.",
  ]
  await page.screenshot({ path: path.join(output, "app.png"), fullPage: true })
  await source.screenshot({ path: path.join(output, "source.png") })
  const summary = page
    .locator("summary")
    .filter({ hasText: "Browser context details" })
  await summary.focus()
  await page.keyboard.press("Enter")
  await page
    .getByText("Estimated input tokens", { exact: true })
    .waitFor({ state: "visible" })
  await page.screenshot({
    path: path.join(output, "details.png"),
    fullPage: true,
  })
  await page.getByRole("button", { name: "Reset browser context" }).focus()
  await page.keyboard.press("Enter")
  await page
    .locator("#browser-observation-preview")
    .waitFor({ state: "detached" })
  await summary.waitFor({ state: "detached" })
  await page.reload()
  await page.getByPlaceholder("Ask anything").waitFor()
  assert.equal(await page.locator("#browser-observation-preview").count(), 0)
  assert.equal(await summary.count(), 0)
  results.keyboardDetailsResetAndReload = true
  results.passed = true
} finally {
  const failures = []
  const release = async (label, operation) => {
    try {
      const response = await operation()
      if (response?.ok && !response.ok()) failures.push(label)
    } catch {
      failures.push(label)
    }
  }
  if (thread)
    await release("thread", () =>
      context.request.delete(`${api.origin}/api/v1/ai/threads/${thread.id}`, {
        headers: authorization,
      }),
    )
  if (demoUser)
    await release("account", () =>
      context.request.delete(`${api.origin}/api/v1/users/${demoUser.id}`, {
        headers: adminAuthorization,
      }),
    )
  if (context) await release("context", () => context.close())
  if (browser) await release("browser", () => browser.close())
  results.cleanupFailures = failures
  await writeFile(
    path.join(output, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  )
}
assert.equal(
  results.cleanupFailures.length,
  0,
  "All demo resources must be released",
)
console.log(
  JSON.stringify({
    passed: results.passed,
    output,
    turns: results.turns.length,
  }),
)
