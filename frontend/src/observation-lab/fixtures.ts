export const FIXTURE_SET_VERSION = "2026-10-18.2"
export const FIXTURE_PROVENANCE = {
  source: "Original fictional text created for the LinkX observation lab",
  license: "MIT; see the repository LICENSE",
} as const

export interface FixtureBlock {
  id: string
  card: string
  text: string
  order: number
  partial?: boolean
}

export interface FixtureFrame {
  id: string
  atMs: number
  visibleBlockIds: string[]
  expectedAccepted: boolean
  stableForMs?: number
  zoomPercent?: 100 | 200 | 400
  textOverrides?: Record<string, string>
}

export interface ReadingFixture {
  id: string
  title: string
  description: string
  layout:
    | "feed"
    | "columns"
    | "small-text"
    | "clipped"
    | "quotes"
    | "sidebar"
    | "image-text"
  blocks: FixtureBlock[]
  frames: FixtureFrame[]
}

export const READING_FIXTURES: ReadingFixture[] = [
  {
    id: "scroll-pause-sidebar",
    title: "Scroll pause with animated sidebar",
    description:
      "Two pauses overlap one card while a separate sidebar keeps animating.",
    layout: "sidebar",
    blocks: [
      {
        id: "s1",
        card: "card-a",
        text: "A small park can cool a busy street when its trees shade the pavement.",
        order: 1,
      },
      {
        id: "s2",
        card: "card-b",
        text: "The north entrance stays open during the evening repair work.",
        order: 2,
      },
      {
        id: "s3",
        card: "card-c",
        text: "Neighbors asked for a safer crossing near the library.",
        order: 3,
      },
    ],
    frames: [
      {
        id: "scroll-001",
        atMs: 0,
        visibleBlockIds: ["s1", "s2"],
        expectedAccepted: true,
        stableForMs: 1000,
      },
      {
        id: "scroll-002",
        atMs: 450,
        visibleBlockIds: ["s1", "s2"],
        expectedAccepted: false,
        stableForMs: 450,
      },
      {
        id: "scroll-003",
        atMs: 1200,
        visibleBlockIds: ["s2", "s3"],
        expectedAccepted: true,
        stableForMs: 800,
      },
    ],
  },
  {
    id: "small-text-zoom",
    title: "Small text at 200% and 400% zoom",
    description:
      "The same fictional article is shown with progressively fewer visible lines.",
    layout: "small-text",
    blocks: [
      {
        id: "z1",
        card: "article",
        text: "Mira Chen opened the community repair room in 2024.",
        order: 1,
      },
      {
        id: "z2",
        card: "article",
        text: "The weekly workshop now lends tools to twelve nearby blocks.",
        order: 2,
      },
      {
        id: "z3",
        card: "article",
        text: "A printed schedule is posted beside the blue entrance.",
        order: 3,
      },
    ],
    frames: [
      {
        id: "zoom-200",
        atMs: 0,
        visibleBlockIds: ["z1", "z2", "z3"],
        expectedAccepted: true,
        zoomPercent: 200,
      },
      {
        id: "zoom-400",
        atMs: 900,
        visibleBlockIds: ["z1"],
        expectedAccepted: true,
        zoomPercent: 400,
      },
    ],
  },
  {
    id: "two-columns",
    title: "Two-column reading order",
    description:
      "Compare column-major and row-major layouts against the supplied reading order.",
    layout: "columns",
    blocks: [
      {
        id: "c1",
        card: "left",
        text: "The museum opens its west gallery first.",
        order: 1,
      },
      {
        id: "c2",
        card: "left",
        text: "Visitors can reserve a quiet room online.",
        order: 2,
      },
      {
        id: "c3",
        card: "right",
        text: "A new audio guide is available in English.",
        order: 3,
      },
      {
        id: "c4",
        card: "right",
        text: "School groups enter through the courtyard.",
        order: 4,
      },
    ],
    frames: [
      {
        id: "columns-001",
        atMs: 0,
        visibleBlockIds: ["c1", "c2", "c3", "c4"],
        expectedAccepted: true,
      },
    ],
  },
  {
    id: "clipped-card",
    title: "Clipped card boundary",
    description:
      "A card cut by the viewport edge remains marked partial in the ground truth.",
    layout: "clipped",
    blocks: [
      {
        id: "p1",
        card: "card-top",
        text: "The ferry will leave the west pier at six.",
        order: 1,
      },
      {
        id: "p2",
        card: "card-bottom",
        text: "A second sailing is planned if the wind remains light.",
        order: 2,
        partial: true,
      },
    ],
    frames: [
      {
        id: "clip-001",
        atMs: 0,
        visibleBlockIds: ["p1", "p2"],
        expectedAccepted: true,
      },
    ],
  },
  {
    id: "quotes-counters",
    title: "Repeated quote and changing counters",
    description:
      "Identical quoted text belongs to separate cards; counters change between views.",
    layout: "quotes",
    blocks: [
      {
        id: "q1",
        card: "card-one",
        text: "We should keep the old footbridge.",
        order: 1,
      },
      { id: "q2", card: "card-one", text: "Likes: 14", order: 2 },
      {
        id: "q3",
        card: "card-two",
        text: "We should keep the old footbridge.",
        order: 3,
      },
      { id: "q4", card: "card-two", text: "Likes: 22", order: 4 },
    ],
    frames: [
      {
        id: "quote-001",
        atMs: 0,
        visibleBlockIds: ["q1", "q2", "q3", "q4"],
        expectedAccepted: true,
      },
      {
        id: "quote-002",
        atMs: 1500,
        visibleBlockIds: ["q1", "q2", "q3", "q4"],
        expectedAccepted: true,
        textOverrides: { q2: "Likes: 15", q4: "Likes: 23" },
      },
    ],
  },
  {
    id: "image-text-card",
    title: "Text printed inside an image",
    description:
      "A fictional poster presents a short heading and event details as image-like text.",
    layout: "image-text",
    blocks: [
      { id: "i1", card: "poster", text: "NORTH HARBOR REPAIR FAIR", order: 1 },
      { id: "i2", card: "poster", text: "Saturday · 10 am to 2 pm", order: 2 },
      {
        id: "i3",
        card: "poster",
        text: "Bring one small household item",
        order: 3,
      },
    ],
    frames: [
      {
        id: "image-text-001",
        atMs: 0,
        visibleBlockIds: ["i1", "i2", "i3"],
        expectedAccepted: true,
      },
    ],
  },
]
