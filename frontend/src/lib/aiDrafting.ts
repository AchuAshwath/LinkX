import type { AxiosError } from "axios"

export type DraftRole = "user" | "assistant"

export interface DraftMessage {
  role: DraftRole
  content: string
  createdAt: Date
  metadata?: Record<string, unknown>
}

export interface DraftControls {
  objective: string
  tone: string
  lengthPreference: string
  audience: string
  includeEmojis: boolean
  voice: "first-person" | "company"
}

export interface DraftResult {
  drafts: DraftMessage[]
}

/**
 * Frontend-only AI drafting helper.
 *
 * Today this returns deterministic mock drafts so that the Prompt Studio
 * experience is fully functional without a backend. When a real AI
 * endpoint is available, you can replace the implementation here to
 * call the API while keeping the `/chat` route untouched.
 */
export async function draftWithAi(
  brief: string,
  controls: DraftControls,
): Promise<DraftResult> {
  if (!brief.trim()) {
    return { drafts: [] }
  }

  try {
    // Placeholder mock implementation – replace with real API call.
    const now = new Date()
    const variants = createVariantsFromBrief(brief, controls)

    const drafts: DraftMessage[] = variants.map((content, index) => ({
      role: "assistant",
      content,
      createdAt: new Date(now.getTime() + (index + 1) * 1000),
      metadata: {
        variantIndex: index + 1,
        controls,
      },
    }))

    return { drafts }
  } catch (error) {
    console.error("AI drafting failed", error as AxiosError)
    return { drafts: [] }
  }
}

function createVariantsFromBrief(
  brief: string,
  controls: DraftControls,
): string[] {
  const base =
    brief.trim() ||
    "Share a clear, high-signal update tailored for LinkedIn, focused on impact and a concrete lesson."

  const toneIntro =
    controls.tone === "friendly"
      ? "Here’s something I’ve been reflecting on lately:"
      : controls.tone === "bold"
        ? "Here’s an opinion I don’t see shared enough:"
        : controls.tone === "analytical"
          ? "Let’s break this down into something practical:"
          : "Quick reflection from this week:"

  const emojiSuffix = controls.includeEmojis ? " ✨" : "."

  const lengthSuffix =
    controls.lengthPreference === "short"
      ? "\n\nTL;DR: Focus on one clear lesson and one clear action."
      : controls.lengthPreference === "long"
        ? "\n\nHere’s how this played out in practice, and what I’d do differently next time."
        : "\n\nHere’s what this means for how I’ll operate going forward."

  const voicePrefix =
    controls.voice === "company"
      ? "At our team, we’ve been focused on this:"
      : "Personally, I’ve been learning that:"

  const variant1 = `${toneIntro}\n\n${base}${lengthSuffix}`

  const variant2 = `${voicePrefix}\n\n${base}\n\nIf this resonates, I’d love to hear how you’re approaching this too.${emojiSuffix}`

  const objectiveSuffix =
    controls.objective === "hire"
      ? "\n\nWe’re hiring. If this sounds like the kind of work you’d enjoy, my DMs are open."
      : controls.objective === "launch"
        ? "\n\nWe’ve been quietly building around this, and I’m excited to share more soon."
        : controls.objective === "personal-story"
          ? "\n\nNot sharing this for likes, but in case it helps someone who’s a step behind me."
          : "\n\nIf this sparked a thought, I’d love to learn from your perspective in the comments."

  const variant3 = `${base}${objectiveSuffix}`

  return [variant1, variant2, variant3]
}
