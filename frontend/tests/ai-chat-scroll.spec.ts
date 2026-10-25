import { resolve } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"

async function distanceFromEnd(viewport: Locator) {
  return viewport.evaluate(
    (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
  )
}

async function expectAtEnd(viewport: Locator) {
  await expect.poll(() => distanceFromEnd(viewport)).toBeLessThan(8)
}

async function captureVisibleMessage(viewport: Locator) {
  return viewport.evaluate((node) => {
    const viewportTop = node.getBoundingClientRect().top
    const item = Array.from(
      node.querySelectorAll<HTMLElement>("[data-message-id]"),
    ).find((message) => message.getBoundingClientRect().bottom > viewportTop)
    if (!item?.dataset.messageId) return null
    return {
      id: item.dataset.messageId,
      top: item.getBoundingClientRect().top - viewportTop,
    }
  })
}

async function visibleMessageOffset(viewport: Locator, messageId: string) {
  return viewport.evaluate((node, id) => {
    const item = node.querySelector<HTMLElement>(`[data-message-id="${id}"]`)
    return item
      ? item.getBoundingClientRect().top - node.getBoundingClientRect().top
      : null
  }, messageId)
}

async function expectMessageAnchor(
  viewport: Locator,
  anchor: { id: string; top: number },
  tolerance = 32,
) {
  await expect
    .poll(() => visibleMessageOffset(viewport, anchor.id))
    .toBeGreaterThan(anchor.top - tolerance)
  await expect
    .poll(() => visibleMessageOffset(viewport, anchor.id))
    .toBeLessThan(anchor.top + tolerance)
}

async function exercisePinnedFollow(page: Page, viewport: Locator) {
  await expectAtEnd(viewport)
  await page.getByRole("button", { name: "Read image 1 of 1" }).click()
  await expectAtEnd(viewport)

  await page.getByRole("button", { name: "Grow answer" }).click()
  await expectAtEnd(viewport)

  await viewport.hover()
  await page.mouse.wheel(0, 460)
  await page.getByRole("button", { name: "Append activity" }).click()
  await expectAtEnd(viewport)

  const endPosition = await viewport.evaluate((node) => node.scrollTop)
  await viewport.hover()
  await viewport.evaluate((node) => {
    node.dataset.scrollTrace = "[]"
    node.addEventListener(
      "scroll",
      () => {
        const trace = JSON.parse(node.dataset.scrollTrace ?? "[]") as number[]
        trace.push(node.scrollTop)
        node.dataset.scrollTrace = JSON.stringify(trace)
      },
      { capture: true },
    )
    node.addEventListener(
      "wheel",
      (event) => {
        if (event.deltaY < 0) {
          node.dataset.tinyWheelSeen = String(event.deltaY)
          node.scrollTop = node.scrollHeight - node.clientHeight - 4
        }
      },
      { capture: true, once: true },
    )
  })
  await page.mouse.wheel(0, -4)
  await expect(viewport).toHaveAttribute("data-tiny-wheel-seen", "-4")
  await expect
    .poll(() =>
      viewport.evaluate((node, end) => {
        const trace = JSON.parse(node.dataset.scrollTrace ?? "[]") as number[]
        return trace.some((top) => top < end)
      }, endPosition),
    )
    .toBe(true)
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollTop))
    .toBeLessThan(endPosition)
  const readingPosition = await viewport.evaluate((node) => node.scrollTop)
  await page.getByRole("button", { name: "Append activity" }).click()
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollTop))
    .toBeLessThanOrEqual(readingPosition)
}

async function exerciseReadingAndJump(page: Page, viewport: Locator) {
  const pinnedPosition = await viewport.evaluate((node) => node.scrollTop)
  await viewport.hover()
  await page.mouse.wheel(0, -460)
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollTop))
    .toBeLessThan(pinnedPosition - 100)
  const readingAnchor = await captureVisibleMessage(viewport)
  expect(readingAnchor).not.toBeNull()

  await page.getByRole("button", { name: "Complete response" }).click()
  await page.getByRole("button", { name: "Append activity" }).click()
  await expect.poll(() => distanceFromEnd(viewport)).toBeGreaterThan(100)
  if (readingAnchor) await expectMessageAnchor(viewport, readingAnchor)

  await page.getByRole("button", { name: "Scroll to end" }).click()
  await expectAtEnd(viewport)
  await page.getByRole("button", { name: "Append activity" }).click()
  await expectAtEnd(viewport)
}

async function exerciseThreadSwitch(page: Page, viewport: Locator) {
  await viewport.focus()
  await page.keyboard.press("End")
  await expectAtEnd(viewport)
  await page.getByRole("button", { name: "Append activity" }).click()
  await expectAtEnd(viewport)

  const pinnedPosition = await viewport.evaluate((node) => node.scrollTop)
  await viewport.focus()
  await page.keyboard.press("Shift+Space")
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollTop))
    .toBeLessThan(pinnedPosition - 100)
  const readingAnchor = await captureVisibleMessage(viewport)
  expect(readingAnchor).not.toBeNull()
  await page.getByRole("button", { name: "Append activity" }).click()
  if (readingAnchor) await expectMessageAnchor(viewport, readingAnchor, 128)

  await page.getByRole("button", { name: "Switch thread" }).click()
  await expectAtEnd(viewport)
}

async function exerciseComposer(page: Page, viewport: Locator) {
  const composer = page.locator('[data-chat-scroll-fixture="true"] form')
  const viewportBox = await viewport.boundingBox()
  const composerBox = await composer.boundingBox()
  if (!viewportBox || !composerBox)
    throw new Error("Chat layout is not visible")
  expect(viewportBox.y + viewportBox.height).toBeLessThanOrEqual(composerBox.y)

  await page
    .getByRole("button", { name: "Add attachment or browser tab" })
    .click()
  const stopSharing = page.getByRole("menuitem", {
    name: "Stop sharing browser tab",
  })
  await expect(stopSharing).toBeVisible()
  await expect(stopSharing).toHaveText("Stop sharing")
  await expect
    .poll(() =>
      stopSharing.evaluate((element) => {
        const range = document.createRange()
        const textNode = Array.from(element.childNodes).find(
          (child) => child.nodeType === Node.TEXT_NODE,
        )
        if (!textNode) return 0
        range.selectNode(textNode)
        return range.getClientRects().length
      }),
    )
    .toBe(1)
  expect((await stopSharing.boundingBox())?.height).toBeLessThanOrEqual(40)
  await page.getByRole("menu").screenshot({
    path: resolve(process.cwd(), "../docs/observation/chat-scroll-menu.png"),
    animations: "disabled",
  })
  await stopSharing.click()
  await page
    .getByRole("button", { name: "Add attachment or browser tab" })
    .click()
  await expect(
    page.getByRole("menuitem", { name: "Browser tab" }),
  ).toBeVisible()
}

test("chat follows the active answer, pauses for reading, and resumes at the end", async ({
  page,
}) => {
  await page.goto("/login")
  await page.evaluate(async () => {
    const { mountChatScrollFixture } = await import(
      "/tests/harness/chat-scroll-fixture.tsx"
    )
    const container = document.createElement("div")
    container.dataset.chatScrollFixture = "true"
    document.body.append(container)
    mountChatScrollFixture(container)
  })

  const viewport = page.locator('[data-slot="message-scroller-viewport"]')
  await expect(viewport).toBeVisible()
  await exercisePinnedFollow(page, viewport)
  await exerciseReadingAndJump(page, viewport)
  await exerciseThreadSwitch(page, viewport)
  await exerciseComposer(page, viewport)
})
