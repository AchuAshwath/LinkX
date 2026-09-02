/**
 * Normalizes in-flight streaming markdown so partial/incomplete tokens
 * (like unclosed code fences, dangling asterisks, or uncompleted headings)
 * are rendered as structured HTML in real-time rather than raw markdown syntax.
 */
export function completeStreamingMarkdown(raw: string): string {
  if (!raw) return ""

  let text = raw

  // 1. Auto-close code blocks if an odd number of triple backticks exists
  const tripleBackticks = text.match(/```/g)
  if (tripleBackticks && tripleBackticks.length % 2 === 1) {
    text += "\n```"
    return text
  }

  // 2. Auto-close inline code if an odd number of single backticks exists
  const singleBackticks = text.replace(/```/g, "").match(/`/g)
  if (singleBackticks && singleBackticks.length % 2 === 1) {
    text += "`"
    return text
  }

  // 3. Auto-close bold markdown if an odd number of ** exists
  const boldPairs = text.match(/\*\*/g)
  if (boldPairs && boldPairs.length % 2 === 1) {
    text += "**"
  }

  // 4. Auto-close italic markdown if an odd number of single * exists
  const remainingAsterisks = text.replace(/\*\*/g, "").match(/\*/g)
  if (remainingAsterisks && remainingAsterisks.length % 2 === 1) {
    text += "*"
  }

  // 5. If text ends with an active heading line without a newline, ensure proper heading closure
  // e.g. "### Heading Title"
  if (/(?:^|\n)#{1,6}\s+[^\n]+$/.test(text)) {
    text += "\n"
  }

  return text
}
