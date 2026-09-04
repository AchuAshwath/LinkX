export interface TextMessagePart {
  type: "text"
  text: string
}

export interface SourceUrlPart {
  type: "source-url"
  sourceId: string
  url: string
  title?: string
}

export interface AskUserQuestion {
  question: string
  choices: string[]
}

export interface AskUserAnswer {
  question: string
  answer: string
}

export interface AskUserToolPart {
  type: "tool-ask_user"
  toolCallId: string
  state:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error"
  input: {
    questions: AskUserQuestion[]
  }
  output?: AskUserAnswer[]
  errorText?: string
}

export interface WebSearchToolPart {
  type: "tool-web_search"
  toolCallId: string
  state:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error"
  input?: {
    query?: string
  }
  output?: unknown
  errorText?: string
}

export interface ToolCallItem {
  id: string
  name: string
  state: "running" | "completed" | "failed"
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  durationMs?: number
  timestamp?: string
}

export interface ToolCallPart {
  type: "tool-call" | "tool_call"
  toolCallId?: string
  name?: string
  state?: "running" | "completed" | "failed"
  tool?: ToolCallItem
  input?: Record<string, unknown>
  output?: Record<string, unknown>
}

export interface TrendingTopicItem {
  id?: string
  topic_title: string
  category?: string | null
  post_count?: number | null
  summary?: string | null
  topic_url?: string
}

export interface TrendingArtifact {
  topics: TrendingTopicItem[]
  count?: number
}

export interface TrendingArtifactPart {
  type: "trending_artifact"
  artifact: TrendingArtifact
}

export interface DraftArtifact {
  id?: string
  postId?: string
  content: string
  platform: "x" | "linkedin" | "linkx" | "all"
  imageUrl?: string | null
  scheduledAt?: string | null
  status?: "draft" | "scheduled" | "published"
  characterCount?: number
  updatedAt?: string
}

export interface DraftArtifactPart {
  type: "draft_artifact"
  artifact: DraftArtifact
}

export interface ThoughtPart {
  type: "thought"
  content: string
}

export interface ImageUrlPart {
  type: "image_url" | "image"
  url?: string
  image_url?: { url: string }
}

export type ChatMessagePart =
  | TextMessagePart
  | ImageUrlPart
  | SourceUrlPart
  | AskUserToolPart
  | WebSearchToolPart
  | ToolCallPart
  | DraftArtifactPart
  | TrendingArtifactPart
  | ThoughtPart

export interface ChatUIMessage {
  id: string
  role: "user" | "assistant" | "system"
  parts: ChatMessagePart[]
  createdAt?: string
  status?: "queued" | "streaming" | "done" | "error"
}

export interface QueuedTurn {
  id: string
  threadId: string
  promptText: string
  base64Images?: string[]
  selectedModelId: string
  assistantMsgId: string
}
