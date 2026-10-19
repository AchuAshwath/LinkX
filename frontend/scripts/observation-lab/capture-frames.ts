import { mkdir } from "node:fs/promises"
import { chromium } from "playwright"
import { READING_FIXTURES } from "../../src/observation-lab/fixtures"

const mode = process.argv[2] ?? "representative"
const output = process.argv[3] ?? "/tmp/linkx-observation-ocr-inputs"
if (mode !== "representative" && mode !== "history") {
  throw new Error(`Unsupported capture mode: ${mode}`)
}
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: "chrome", headless: true })
const representativeCases = [
  {
    id: "scroll-pause-sidebar",
    blocks: ["s1", "s2"],
    name: "scroll-100",
    zoom: 1,
    overrides: {},
  },
  {
    id: "small-text-zoom",
    blocks: ["z1", "z2", "z3"],
    name: "zoom-200",
    zoom: 2,
    overrides: {},
  },
  {
    id: "small-text-zoom",
    blocks: ["z1"],
    name: "zoom-400",
    zoom: 4,
    overrides: {},
  },
  {
    id: "two-columns",
    blocks: ["c1", "c2", "c3", "c4"],
    name: "columns",
    zoom: 1,
    overrides: {},
  },
  {
    id: "clipped-card",
    blocks: ["p1", "p2"],
    name: "clipped",
    zoom: 1,
    overrides: {},
  },
  {
    id: "image-text-card",
    blocks: ["i1", "i2", "i3"],
    name: "image-text",
    zoom: 1,
    overrides: {},
  },
]
const historyCases = [
  {
    id: "scroll-pause-sidebar",
    blocks: ["s1", "s2"],
    name: "scroll-earlier",
    zoom: 1,
    overrides: {},
  },
  {
    id: "scroll-pause-sidebar",
    blocks: ["s2", "s3"],
    name: "scroll-current",
    zoom: 1,
    overrides: {},
  },
  {
    id: "small-text-zoom",
    blocks: ["z1", "z2", "z3"],
    name: "zoom-earlier",
    zoom: 2,
    overrides: {},
  },
  {
    id: "small-text-zoom",
    blocks: ["z1"],
    name: "zoom-current",
    zoom: 4,
    overrides: {},
  },
  {
    id: "quotes-counters",
    blocks: ["q1", "q2", "q3", "q4"],
    name: "counter-earlier",
    zoom: 1,
    overrides: {},
  },
  {
    id: "quotes-counters",
    blocks: ["q1", "q2", "q3", "q4"],
    name: "counter-current",
    zoom: 1,
    overrides: { q2: "Likes: 15", q4: "Likes: 23" },
  },
]
const cases = mode === "history" ? historyCases : representativeCases
for (const scenario of cases) {
  const fixture = READING_FIXTURES.find((item) => item.id === scenario.id)!
  const blocks = fixture.blocks
    .filter((block) => scenario.blocks.includes(block.id))
    .map((block) => ({
      ...block,
      text: scenario.overrides[block.id] ?? block.text,
    }))
  const columns = fixture.layout === "columns"
  const cards = columns
    ? ["left", "right"]
        .map(
          (card) =>
            `<section>${blocks
              .filter((block) => block.card === card)
              .map(
                (block) =>
                  `<article class="card"><p>${block.text}</p></article>`,
              )
              .join("")}</section>`,
        )
        .join("")
    : blocks
        .map((block) => `<article class="card"><p>${block.text}</p></article>`)
        .join("")
  const imageText = fixture.layout === "image-text"
  const clipped = fixture.layout === "clipped"
  const html = `<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;width:1280px;height:900px;background:#fff;color:#141414;font:20px Arial,sans-serif;padding:40px}
  main{display:${columns ? "grid" : "block"};grid-template-columns:1fr 1fr;gap:24px;zoom:${scenario.zoom}}
  .card{border:1px solid #aaa;border-radius:8px;background:${imageText ? "linear-gradient(135deg,#f5c77e,#f7e9c9 60%,#e7f0dc)" : "#f8f9fc"};padding:18px;margin-bottom:20px;${imageText ? "font-family:Georgia,serif;padding:24px" : ""}}
  p{margin:0;line-height:1.5}${clipped ? ".card:last-child{height:52px;overflow:hidden}" : ""}
  </style><main>${cards}</main>`
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  })
  await page.setContent(html)
  await page.screenshot({ path: `${output}/${scenario.name}.png` })
  await page.close()
}
await browser.close()
