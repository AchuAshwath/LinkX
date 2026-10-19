import { readFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"

test("fixture lab exports aggregate metrics without source text", async ({
  page,
}) => {
  await page.goto("/observation-lab.html")
  await page.getByLabel("Scenario").selectOption("scroll-pause-sidebar")
  await page.getByRole("button", { name: "Replay scenario" }).click()
  const preview = page.getByLabel("Synthetic fixture preview")
  await expect(page.locator("#run-status")).toContainText("Frame scroll-001")
  await expect(preview).toContainText("A small park can cool")
  await expect(preview).not.toContainText("Neighbors asked")
  await expect(page.locator("#run-status")).toContainText(
    "Replay complete: 2 accepted views",
  )
  await expect(preview.locator("article")).toHaveCount(2)
  await expect(preview).toContainText("Neighbors asked")
  await expect(preview).not.toContainText("A small park can cool")

  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "Export aggregate results" }).click()
  const download = await downloadPromise
  const report = await readFile((await download.path())!, "utf8")

  expect(report).toContain('"fixtureVersion": "2026-10-18.2"')
  expect(report).toContain('"fixtureProvenance"')
  expect(report).toContain(
    "Original fictional text created for the LinkX observation lab",
  )
  expect(report).toContain("MIT")
  expect(report).toContain(
    '"measurementMode": "scripted-fixture-policy-replay"',
  )
  expect(report).toContain('"scenarioId": "scroll-pause-sidebar"')
  expect(report).toContain('"acceptedViews": 2')
  expect(report).toContain('"meanMs": null')
  expect(report).not.toContain("A small park can cool a busy street")
  expect(report).not.toContain("reading order 1")
  expect(report).not.toContain("base64")
})

test("fixture motion stops when reduced motion is requested", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/observation-lab.html")
  const sidebar = page.locator(".fixture-sidebar").first()

  await expect
    .poll(() =>
      sidebar.evaluate((element) => getComputedStyle(element).animationName),
    )
    .toBe("none")
})

test("fixture replay changes visible content at 400% zoom", async ({
  page,
}) => {
  await page.goto("/observation-lab.html")
  await page.getByLabel("Scenario").selectOption("small-text-zoom")
  await page.getByRole("button", { name: "Replay scenario" }).click()
  await expect(page.locator("#run-status")).toContainText(
    "Replay complete: 2 accepted views",
  )

  const preview = page.getByLabel("Synthetic fixture preview")
  await expect(preview.locator("article")).toHaveCount(1)
  await expect(preview).not.toContainText("weekly workshop")
  await expect
    .poll(() =>
      preview.evaluate((element) => (element as HTMLElement).style.zoom),
    )
    .toBe("400%")
})

test("OCR comparison shows actual Vision lines and keeps corrections out of exports", async ({
  page,
}) => {
  await page.goto("/observation-lab.html")
  const comparison = page.getByRole("region", {
    name: "Recorded OCR comparison",
  })
  await comparison.getByLabel("OCR comparison case").selectOption("columns")
  await expect(
    comparison.locator("img[alt*='Synthetic two-column reading order image']"),
  ).toBeVisible()
  await expect(comparison).toContainText(
    "Native macOS Vision · fresh-process text",
  )
  await expect(comparison.locator("#ocr-native-fresh")).toContainText(
    "A new audio guide is available in English.",
  )
  await expect(comparison.locator("#ocr-native-metrics")).toContainText(
    "28/28 word errors",
  )
  await expect(comparison.locator("#ocr-native-metrics")).toContainText(
    "right-column text first",
  )
  await expect(comparison).toContainText("row-major")
  await expect(comparison).toContainText("A new")

  const correction = comparison.getByLabel("Proposed correction (local only)")
  await correction.fill("PRIVATE correction that must not export")
  await comparison
    .getByRole("button", { name: "Save correction in this session" })
    .click()
  await expect(comparison.getByRole("status")).toContainText(
    "saved in memory only",
  )

  await page.getByLabel("Scenario").selectOption("two-columns")
  await page.getByRole("button", { name: "Replay scenario" }).click()
  await expect(page.locator("#run-status")).toContainText("Replay complete")
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "Export aggregate results" }).click()
  const download = await downloadPromise
  const report = await readFile((await download.path())!, "utf8")
  expect(report).not.toContain("PRIVATE correction that must not export")
  expect(report).not.toContain("The museum opens its west gallery first")
  expect(report).not.toContain("row-major")
  expect(report).not.toContain("A new audio guide is available in English")

  await comparison
    .getByRole("button", { name: "Skip this OCR evidence" })
    .click()
  await expect(comparison.getByRole("status")).toContainText(
    "skipped for this session",
  )
})

test("poster OCR comparison reports the recorded empty result and uncertainty", async ({
  page,
}) => {
  await page.goto("/observation-lab.html")
  const comparison = page.getByRole("region", {
    name: "Recorded OCR comparison",
  })
  await comparison.getByLabel("OCR comparison case").selectOption("image-text")
  await expect(comparison).toContainText("no text returned")
  await expect(comparison).toContainText("baseline, PSM 6, and 2× upscale")
  await expect(comparison.locator("#ocr-native-fresh")).toContainText(
    "NORTH HARBOR REPAIR FAIR",
  )
  await expect(comparison).toContainText(
    "separate from the fresh native result above",
  )
  await expect(
    comparison.getByLabel("Proposed correction (local only)"),
  ).toBeEditable()
})
