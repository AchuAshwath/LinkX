import { describe, expect, it } from "vitest"
import { completeStreamingMarkdown } from "@/lib/markdown-stream"

describe("completeStreamingMarkdown", () => {
  it("returns empty string when given empty input", () => {
    expect(completeStreamingMarkdown("")).toBe("")
  })

  it("auto-closes open code blocks", () => {
    const unclosedCode = "Here is code:\n```typescript\nconst x = 10"
    const completed = completeStreamingMarkdown(unclosedCode)
    expect(completed).toBe("Here is code:\n```typescript\nconst x = 10\n```")
  })

  it("auto-closes open inline code", () => {
    const unclosedInline = "Check `variable"
    const completed = completeStreamingMarkdown(unclosedInline)
    expect(completed).toBe("Check `variable`")
  })

  it("auto-closes open bold markers", () => {
    const unclosedBold = "This is **important"
    const completed = completeStreamingMarkdown(unclosedBold)
    expect(completed).toBe("This is **important**")
  })

  it("ensures trailing headings are terminated with newline for instant block parsing", () => {
    const inFlightHeading = "### Strategic Overview"
    const completed = completeStreamingMarkdown(inFlightHeading)
    expect(completed).toBe("### Strategic Overview\n")
  })
})
