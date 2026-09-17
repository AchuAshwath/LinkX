import type {
  ChatUIMessage,
  SourceUrlPart,
  ThoughtPart as ThoughtPartType,
  ToolCallItem,
  ToolCallPart,
  WebSearchToolPart,
} from "@/components/Chat/types"

const VALID_IMAGE_PREFIXES = [
  "data:image/",
  "https://",
  "http://",
  "blob:",
  "/",
]

export function extractTextParts(parts: ChatUIMessage["parts"]): string {
  return parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        p.type === "text" && Boolean(p.text),
    )
    .map((p) => p.text)
    .join("\n\n")
    .trim()
}

export function isValidImageUrl(url: string): boolean {
  if (!url) return false
  const trimmed = url.trim().toLowerCase()
  return VALID_IMAGE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
}

function getRawImageUrl(part: ChatUIMessage["parts"][number]): string {
  if ("url" in part && typeof part.url === "string") {
    return part.url
  }
  const nested = (part as { image_url?: { url?: unknown } }).image_url
  return typeof nested?.url === "string" ? nested.url : ""
}

export function extractImageUrls(parts: ChatUIMessage["parts"]): string[] {
  const urls: string[] = []
  for (const p of parts) {
    const isImage = p.type === "image_url" || p.type === "image"
    if (!isImage) continue
    const rawUrl = getRawImageUrl(p)
    if (rawUrl && isValidImageUrl(rawUrl)) {
      urls.push(rawUrl)
    }
  }
  return urls
}

export function getMessageTimestamp(
  message: ChatUIMessage,
): string | undefined {
  return message.createdAt || (message as { created_at?: string }).created_at
}

export function extractThoughtFromTextParts(parts: ChatUIMessage["parts"]): {
  cleanedParts: ChatUIMessage["parts"]
  extractedThought: string | null
} {
  let extractedThought: string | null = null
  const cleanedParts = parts.map((part) => {
    if (part.type !== "text" || !part.text) return part
    const match =
      /<\s*(?:thought|thinking|think)\s*>([\s\S]*?)<\/\s*(?:thought|thinking|think)\s*>/i.exec(
        part.text,
      )
    if (!match) return part
    extractedThought = match[1].trim()
    const cleanedText = part.text
      .replace(
        /<\s*(?:thought|thinking|think)\s*>[\s\S]*?<\/\s*(?:thought|thinking|think)\s*>/gi,
        "",
      )
      .trim()
    return { ...part, text: cleanedText }
  })
  return { cleanedParts, extractedThought }
}

function extractDraftContents(parts: ChatUIMessage["parts"]): string[] {
  const contents: string[] = []
  for (const part of parts) {
    if (part.type !== "draft_artifact") continue
    const c = (part as any).artifact?.content || (part as any).content
    if (typeof c === "string" && c.trim()) {
      contents.push(c.trim())
    }
  }
  return contents
}

function stripDraftContent(text: string, draftContents: string[]): string {
  let cleaned = text
  for (const draftContent of draftContents) {
    if (!draftContent) continue
    if (cleaned.includes(draftContent)) {
      cleaned = cleaned.split(draftContent).join("").trim()
      continue
    }
    const unquoted = draftContent.replace(/^["']|["']$/g, "").trim()
    if (unquoted && cleaned.includes(unquoted)) {
      cleaned = cleaned.split(unquoted).join("").trim()
    }
  }
  return cleaned
}

function cleanPostambleText(text: string): string {
  return text
    .replace(
      /^(?:Here(?:'s| is) (?:a|the) (?:polished )?(?:X|LinkedIn|draft|post)[\w\s]*:?)/i,
      "",
    )
    .replace(/^(?:Saved as (?:a )?draft\.?)/i, "")
    .replace(/(?:Saved as (?:a )?draft\.?)$/i, "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim()
}

export function deduplicateDraftContentFromTextParts(
  parts: ChatUIMessage["parts"],
): ChatUIMessage["parts"] {
  const draftContents = extractDraftContents(parts)
  if (draftContents.length === 0) return parts

  return parts
    .map((part) => {
      if (part.type !== "text" || !part.text) return part
      const stripped = stripDraftContent(part.text, draftContents)
      const cleaned = cleanPostambleText(stripped)
      return { ...part, text: cleaned }
    })
    .filter((part) => {
      if (part.type === "text") {
        return Boolean(part.text?.trim())
      }
      return true
    })
}

const EXCLUDED_PART_TYPES = new Set([
  "thought",
  "tool-call",
  "tool_call",
  "source-url",
])

export function isOtherPart(
  p: ChatUIMessage["parts"][number],
  hasThoughtOrTools: boolean,
): boolean {
  if (EXCLUDED_PART_TYPES.has(p.type)) return false
  if (p.type === "tool-web_search" && hasThoughtOrTools) return false
  return true
}

export function collectTools(parts: ChatUIMessage["parts"]): ToolCallItem[] {
  const toolCallParts = parts.filter(
    (p) => p.type === "tool-call" || p.type === "tool_call",
  ) as ToolCallPart[]

  return toolCallParts.map((tp, idx) => {
    return (
      tp.tool ?? {
        id: tp.toolCallId || `tool-${idx}`,
        name: tp.name || "tool",
        state: tp.state || "completed",
        input: tp.input,
        output: tp.output,
      }
    )
  })
}

function buildCombinedThought(
  dedupedParts: ChatUIMessage["parts"],
  extractedThought: string | null,
): string {
  const thoughtParts = dedupedParts.filter(
    (p): p is ThoughtPartType => p.type === "thought",
  )
  const thoughtText = thoughtParts
    .map((p) => p.content)
    .filter(Boolean)
    .join("\n\n")
  return thoughtText || extractedThought || ""
}

function checkHasResponseStarted(parts: ChatUIMessage["parts"]): boolean {
  return parts.some((p) => p.type === "text" && Boolean(p.text?.trim()))
}

function checkHasThoughtOrTools(
  combinedThought: string,
  hasTools: boolean,
  isStreaming: boolean,
  hasResponseStarted: boolean,
): boolean {
  if (combinedThought) return true
  if (hasTools) return true
  return isStreaming && !hasResponseStarted
}

export interface AssistantRenderState {
  combinedThought: string
  sources: SourceUrlPart[]
  collectedTools: ToolCallItem[]
  webSearchPart?: WebSearchToolPart
  hasResponseStarted: boolean
  hasThoughtOrTools: boolean
  otherParts: ChatUIMessage["parts"]
  assistantText: string
  createdAt?: string
}

function extractDraftArtifactPostId(
  part: ChatUIMessage["parts"][number],
): string | null {
  if (part.type !== "draft_artifact") return null
  const art = (part as any).artifact || part
  return (art.id || art.postId || (part as any).post_id || null) as
    | string
    | null
}

export function deduplicateDraftArtifactParts(
  parts: ChatUIMessage["parts"],
): ChatUIMessage["parts"] {
  const lastIndexByPostId = new Map<string, number>()
  let lastGenericIndex = -1

  parts.forEach((p, idx) => {
    if (p.type !== "draft_artifact") return
    const id = extractDraftArtifactPostId(p)
    if (id) {
      lastIndexByPostId.set(id, idx)
    } else {
      lastGenericIndex = idx
    }
  })

  return parts.filter((p, idx) => {
    if (p.type !== "draft_artifact") return true
    const id = extractDraftArtifactPostId(p)
    if (id) {
      return lastIndexByPostId.get(id) === idx
    }
    return lastGenericIndex === idx
  })
}

export function prepareAssistantRenderState(
  message: ChatUIMessage,
  isStreaming: boolean,
): AssistantRenderState {
  const { cleanedParts, extractedThought } = extractThoughtFromTextParts(
    message.parts,
  )
  const dedupedParts = deduplicateDraftContentFromTextParts(cleanedParts)
  const sources = dedupedParts.filter(
    (part): part is SourceUrlPart => part.type === "source-url",
  )
  const combinedThought = buildCombinedThought(dedupedParts, extractedThought)
  const collectedTools = collectTools(cleanedParts)
  const webSearchPart = dedupedParts.find(
    (p): p is WebSearchToolPart => p.type === "tool-web_search",
  )
  const hasResponseStarted = checkHasResponseStarted(dedupedParts)
  const hasThoughtOrTools = checkHasThoughtOrTools(
    combinedThought,
    collectedTools.length > 0,
    isStreaming,
    hasResponseStarted,
  )
  const rawOtherParts = dedupedParts.filter((p) =>
    isOtherPart(p, hasThoughtOrTools),
  )
  const otherParts = deduplicateDraftArtifactParts(rawOtherParts)

  return {
    combinedThought,
    sources,
    collectedTools,
    webSearchPart,
    hasResponseStarted,
    hasThoughtOrTools,
    otherParts,
    assistantText: extractTextParts(dedupedParts),
    createdAt: getMessageTimestamp(message),
  }
}
