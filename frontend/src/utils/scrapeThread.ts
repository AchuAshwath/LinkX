import type { ChatThreadPublic } from "@/client"

export const SCRAPE_PROMPT = "Refresh trending topics from X"

const SCRAPE_COMMAND_REGEX =
  /^(refresh|scrape|extract)\s+(x\s+)?(trending|trends|live\s+trends)/i

const SCRAPE_THREAD_TITLE_REGEX =
  /trending\s*topics|refresh.*(trend|topic)|scrape.*trend|extract.*trend|live.*trend/i

export function isScrapePrompt(prompt?: string | null): boolean {
  if (!prompt) return false
  const trimmed = prompt.trim()
  return (
    trimmed.toLowerCase() === SCRAPE_PROMPT.toLowerCase() ||
    SCRAPE_COMMAND_REGEX.test(trimmed)
  )
}

export function isScrapeThread(thread: ChatThreadPublic): boolean {
  if (thread.is_archived) return false
  if (
    thread.origin === "trending" ||
    thread.topic_keyword === "trending_scrape"
  ) {
    return true
  }
  return SCRAPE_THREAD_TITLE_REGEX.test(thread.title || "")
}

export function findScrapeThread(
  threads: ChatThreadPublic[],
): ChatThreadPublic | undefined {
  return threads.find(isScrapeThread)
}
