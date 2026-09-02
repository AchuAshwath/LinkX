/**
 * Normalizes in-flight streaming markdown so partial/incomplete tokens
 * are rendered as structured HTML in real-time rather than raw markdown syntax.
 */

function closeCodeBlocks(text: string): string | null {
  const tripleBackticks = text.match(/```/g)
  return tripleBackticks && tripleBackticks.length % 2 === 1
    ? `${text}\n\`\`\``
    : null
}

function closeInlineCode(text: string): string | null {
  const singleBackticks = text.replace(/```/g, "").match(/`/g)
  return singleBackticks && singleBackticks.length % 2 === 1
    ? `${text}\``
    : null
}

function closeBold(text: string): string {
  const boldPairs = text.match(/\*\*/g)
  return boldPairs && boldPairs.length % 2 === 1 ? `${text}**` : text
}

function closeItalics(text: string): string {
  const remainingAsterisks = text.replace(/\*\*/g, "").match(/\*/g)
  return remainingAsterisks && remainingAsterisks.length % 2 === 1
    ? `${text}*`
    : text
}

function terminateTrailingHeading(text: string): string {
  return /(?:^|\n)#{1,6}\s+[^\n]+$/.test(text) ? `${text}\n` : text
}

export function completeStreamingMarkdown(raw: string): string {
  if (!raw) return ""

  const codeClosed = closeCodeBlocks(raw)
  if (codeClosed) return codeClosed

  const inlineClosed = closeInlineCode(raw)
  if (inlineClosed) return inlineClosed

  const withBold = closeBold(raw)
  const withItalics = closeItalics(withBold)
  return terminateTrailingHeading(withItalics)
}
