import { Sparkles } from "lucide-react"
import * as React from "react"

import { ChatContainerContent, ChatContainerRoot } from "@/components/prompt-kit/chat-container"
import {
  PromptInput,
  PromptInputFooter,
  PromptInputRoot,
  PromptSubmitButton,
} from "@/components/prompt-kit/prompt-input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { formatRelativeTime } from "@/utils"

type Role = "user" | "assistant"

interface DraftMessage {
  id: string
  role: Role
  content: string
  createdAt: Date
  variantIndex?: number
}

type Objective =
  | "grow-audience"
  | "share-update"
  | "hire"
  | "launch"
  | "personal-story"

type Tone = "professional" | "friendly" | "bold" | "analytical"

type LengthPreference = "short" | "medium" | "long"

interface PromptTemplate {
  id: string
  label: string
  description: string
  prompt: string
  recommendedObjective: Objective
  recommendedTone: Tone
}

const OBJECTIVES: { id: Objective; label: string }[] = [
  { id: "grow-audience", label: "Grow audience" },
  { id: "share-update", label: "Share update" },
  { id: "hire", label: "Hiring" },
  { id: "launch", label: "Launch / announcement" },
  { id: "personal-story", label: "Personal story" },
]

const TONES: { id: Tone; label: string }[] = [
  { id: "professional", label: "Professional" },
  { id: "friendly", label: "Friendly" },
  { id: "bold", label: "Bold" },
  { id: "analytical", label: "Analytical" },
]

const LENGTHS: { id: LengthPreference; label: string }[] = [
  { id: "short", label: "Short" },
  { id: "medium", label: "Medium" },
  { id: "long", label: "Long" },
]

const TEMPLATES: PromptTemplate[] = [
  {
    id: "weekly-insight",
    label: "Weekly insight",
    description: "Turn a learning from this week into a concise, valuable post.",
    prompt:
      "Turn this into a LinkedIn post that shares a clear takeaway and invites discussion.",
    recommendedObjective: "grow-audience",
    recommendedTone: "analytical",
  },
  {
    id: "launch-update",
    label: "Launch update",
    description:
      "Announce a new feature or product with a strong hook and clear CTA.",
    prompt:
      "Craft a launch post that focuses on the problem, our solution, and a clear call to action.",
    recommendedObjective: "launch",
    recommendedTone: "bold",
  },
  {
    id: "hiring",
    label: "Hiring announcement",
    description:
      "Share an authentic hiring post that highlights team, role, and impact.",
    prompt:
      "Write a hiring announcement that feels human, highlights the impact of the role, and encourages referrals.",
    recommendedObjective: "hire",
    recommendedTone: "friendly",
  },
  {
    id: "personal-story",
    label: "Personal story",
    description:
      "Turn a career moment into a relatable story with a lesson learned.",
    prompt:
      "Turn this into a brief, reflective LinkedIn post with a concrete lesson for others.",
    recommendedObjective: "personal-story",
    recommendedTone: "professional",
  },
]

interface PromptDraftStudioProps {
  className?: string
}

export function PromptDraftStudio({ className }: PromptDraftStudioProps) {
  const [prompt, setPrompt] = React.useState("")
  const [objective, setObjective] = React.useState<Objective>("grow-audience")
  const [tone, setTone] = React.useState<Tone>("professional")
  const [lengthPreference, setLengthPreference] =
    React.useState<LengthPreference>("medium")
  const [audience, setAudience] = React.useState("LinkedIn connections in tech")
  const [includeEmojis, setIncludeEmojis] = React.useState(true)
  const [voice, setVoice] = React.useState<"first-person" | "company">(
    "first-person",
  )

  const [messages, setMessages] = React.useState<DraftMessage[]>([])
  const [selectedDraftId, setSelectedDraftId] = React.useState<string | null>(
    null,
  )
  const [isGenerating, setIsGenerating] = React.useState(false)

  const handleUseTemplate = (template: PromptTemplate) => {
    setPrompt(template.prompt)
    setObjective(template.recommendedObjective)
    setTone(template.recommendedTone)
  }

  const handleDraft = async () => {
    if (!prompt.trim()) return

    setIsGenerating(true)

    const now = new Date()
    const userMessage: DraftMessage = {
      id: `u-${now.getTime()}`,
      role: "user",
      content: buildUserPromptSummary({
        prompt,
        objective,
        tone,
        lengthPreference,
        audience,
        includeEmojis,
        voice,
      }),
      createdAt: now,
    }

    // Simple, deterministic mock drafts for now.
    const drafts = createMockDrafts({
      basePrompt: prompt,
      objective,
      tone,
      lengthPreference,
    })

    const assistantMessages: DraftMessage[] = drafts.map((draft, index) => ({
      id: `a-${now.getTime()}-${index}`,
      role: "assistant",
      content: draft,
      createdAt: new Date(now.getTime() + (index + 1) * 1000),
      variantIndex: index + 1,
    }))

    setMessages((prev) => [...prev, userMessage, ...assistantMessages])
    setSelectedDraftId(assistantMessages[0]?.id ?? null)
    setIsGenerating(false)
  }

  const selectedDraft = messages.find(
    (message) => message.id === selectedDraftId,
  )

  return (
    <div
      className={cn(
        "flex w-full max-w-7xl min-h-[calc(100vh-3.5rem)]",
        className,
      )}
    >
      {/* Main column */}
      <div className="border-border min-w-0 flex-1 border-r md:max-w-2xl flex flex-col">
        <div className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-primary/10 p-2">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-semibold sm:text-lg">
                Prompt Studio
              </h1>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Draft and refine LinkedIn posts with an AI co-writer tuned for
                your audience.
              </p>
            </div>
          </div>
        </div>

        {/* Prompt builder */}
        <div className="border-b bg-background px-4 py-4">
          <PromptInputRoot>
            <PromptInput
              value={prompt}
              onChange={setPrompt}
              onSubmit={handleDraft}
              placeholder="Describe the idea, update, or story you want to share on LinkedIn. You can paste raw notes, bullets, or an existing draft."
              disabled={isGenerating}
            />
            <PromptInputFooter>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                  Objective
                </span>
                <div className="flex flex-wrap gap-1">
                  {OBJECTIVES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setObjective(item.id)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[0.7rem] font-medium transition-colors",
                        objective === item.id
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background hover:bg-accent",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                    Tone
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {TONES.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setTone(item.id)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[0.7rem] font-medium transition-colors",
                          tone === item.id
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-background hover:bg-accent",
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                    Length
                  </span>
                  <div className="flex gap-1">
                    {LENGTHS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setLengthPreference(item.id)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[0.7rem] font-medium transition-colors",
                          lengthPreference === item.id
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-background hover:bg-accent",
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-1 items-center justify-end gap-2">
                <label className="hidden text-[0.7rem] text-muted-foreground sm:inline">
                  Audience
                </label>
                <input
                  value={audience}
                  onChange={(event) => setAudience(event.target.value)}
                  className="hidden h-8 w-40 rounded-full border border-input bg-background px-3 text-[0.7rem] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 sm:inline-block"
                  placeholder="e.g. Eng leaders, founders"
                />
                <Button
                  type="button"
                  variant={includeEmojis ? "default" : "outline"}
                  onClick={() => setIncludeEmojis((prev) => !prev)}
                  size="sm"
                  className="hidden h-8 rounded-full px-3 text-[0.7rem] sm:inline-flex"
                >
                  {includeEmojis ? "Emojis on" : "Emojis off"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setVoice((prev) =>
                      prev === "first-person" ? "company" : "first-person",
                    )
                  }
                  className="hidden h-8 rounded-full px-3 text-[0.7rem] sm:inline-flex"
                >
                  {voice === "first-person" ? "First-person" : "Company voice"}
                </Button>
                <PromptSubmitButton disabled={!prompt.trim() || isGenerating}>
                  {isGenerating ? "Drafting..." : "Draft LinkedIn post"}
                </PromptSubmitButton>
              </div>
            </PromptInputFooter>
          </PromptInputRoot>
        </div>

        {/* Conversation */}
        <ChatContainerRoot className="bg-background">
          <ChatContainerContent>
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-muted-foreground">
                <div className="mb-4 rounded-full bg-muted/50 p-4">
                  <Sparkles className="h-6 w-6" />
                </div>
                <p className="mb-1 font-medium">
                  Start with an idea, get a crafted LinkedIn post.
                </p>
                <p className="max-w-md text-xs text-muted-foreground">
                  Share notes, bullets, or an existing draft. We&apos;ll turn it
                  into polished LinkedIn content with multiple variants you can
                  refine.
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex items-start gap-3",
                    message.role === "user"
                      ? "justify-end text-right"
                      : "justify-start text-left",
                  )}
                >
                  {message.role === "assistant" ? (
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                        AI
                      </AvatarFallback>
                    </Avatar>
                  ) : null}

                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg px-4 py-2 text-sm leading-relaxed shadow-[0_1px_1px_rgba(15,23,42,0.12)]",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-card text-foreground border border-border",
                    )}
                  >
                    {message.variantIndex ? (
                      <div className="mb-1 flex items-center justify-between gap-2 text-[0.7rem] font-medium uppercase tracking-wide">
                        <span className="text-muted-foreground">
                          Draft {message.variantIndex}
                        </span>
                        <Badge
                          variant={
                            selectedDraftId === message.id ? "default" : "outline"
                          }
                          className="cursor-pointer rounded-full px-2 py-0 text-[0.65rem]"
                          onClick={() => setSelectedDraftId(message.id)}
                        >
                          {selectedDraftId === message.id
                            ? "In preview"
                            : "Use in preview"}
                        </Badge>
                      </div>
                    ) : null}
                    <p className="whitespace-pre-wrap">{message.content}</p>
                    <p className="mt-1 text-[0.65rem] text-muted-foreground/80">
                      {formatRelativeTime(message.createdAt)}
                    </p>
                    {message.role === "assistant" ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.7rem]">
                        <Button
                          variant="outline"
                          size="xs"
                          className="h-6 rounded-full px-2"
                          type="button"
                          onClick={() => setSelectedDraftId(message.id)}
                        >
                          Use as base
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="h-6 rounded-full px-2"
                          type="button"
                          onClick={() =>
                            navigator.clipboard
                              ?.writeText(message.content)
                              .catch(() => undefined)
                          }
                        >
                          Copy
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="h-6 rounded-full px-2"
                          type="button"
                        >
                          More concise
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="h-6 rounded-full px-2"
                          type="button"
                        >
                          More engaging
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {message.role === "user" ? (
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="bg-secondary text-xs font-semibold">
                        You
                      </AvatarFallback>
                    </Avatar>
                  ) : null}
                </div>
              ))
            )}
          </ChatContainerContent>
        </ChatContainerRoot>
      </div>

      {/* Sidebar */}
      <div className="hidden w-80 md:block">
        <div className="sticky top-0 self-start space-y-4 p-4">
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Prompt templates
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handleUseTemplate(template)}
                  className="w-full rounded-lg border border-transparent bg-muted/60 p-3 text-left text-xs transition-colors hover:border-border hover:bg-muted"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {template.label}
                    </span>
                    <Badge variant="outline" className="rounded-full px-2 py-0">
                      {TONES.find((t) => t.id === template.recommendedTone)?.label ??
                        "Balanced"}
                    </Badge>
                  </div>
                  <p className="line-clamp-2 text-[0.7rem] text-muted-foreground">
                    {template.description}
                  </p>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Style presets
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge
                variant={tone === "professional" ? "default" : "outline"}
                className="cursor-pointer rounded-full px-3 py-1 text-[0.7rem]"
                onClick={() => setTone("professional")}
              >
                Thoughtful professional
              </Badge>
              <Badge
                variant={tone === "friendly" ? "default" : "outline"}
                className="cursor-pointer rounded-full px-3 py-1 text-[0.7rem]"
                onClick={() => setTone("friendly")}
              >
                Warm & friendly
              </Badge>
              <Badge
                variant={tone === "bold" ? "default" : "outline"}
                className="cursor-pointer rounded-full px-3 py-1 text-[0.7rem]"
                onClick={() => setTone("bold")}
              >
                Bold & punchy
              </Badge>
              <Badge
                variant={tone === "analytical" ? "default" : "outline"}
                className="cursor-pointer rounded-full px-3 py-1 text-[0.7rem]"
                onClick={() => setTone("analytical")}
              >
                Analytical & structured
              </Badge>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Live LinkedIn preview
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selectedDraft ? (
                <p className="text-xs text-muted-foreground">
                  Choose a draft variant from the conversation to see how it
                  will read in a LinkedIn-style card.
                </p>
              ) : (
                <div className="rounded-xl border bg-background p-3 text-xs shadow-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-[0.7rem] font-semibold">
                        LX
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-[0.8rem] font-semibold">
                        You on LinkedIn
                      </p>
                      <p className="text-[0.65rem] text-muted-foreground">
                        {new Date().toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                        {" · Draft"}
                      </p>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-[0.8rem] leading-relaxed">
                    {selectedDraft.content}
                  </p>
                  <div className="mt-3 flex items-center gap-3 text-[0.65rem] text-muted-foreground">
                    <span>👍 Like</span>
                    <span>💬 Comment</span>
                    <span>🔁 Repost</span>
                    <span>↗️ Send</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function buildUserPromptSummary(options: {
  prompt: string
  objective: Objective
  tone: Tone
  lengthPreference: LengthPreference
  audience: string
  includeEmojis: boolean
  voice: "first-person" | "company"
}) {
  const objectiveLabel =
    OBJECTIVES.find((item) => item.id === options.objective)?.label ??
    "General update"
  const toneLabel =
    TONES.find((item) => item.id === options.tone)?.label ?? "Balanced"
  const lengthLabel =
    LENGTHS.find((item) => item.id === options.lengthPreference)?.label ??
    "Medium"

  return [
    `Draft a LinkedIn post with this brief:`,
    "",
    options.prompt.trim(),
    "",
    `Objective: ${objectiveLabel}`,
    `Tone: ${toneLabel}`,
    `Length: ${lengthLabel}`,
    `Audience: ${options.audience || "My LinkedIn connections"}`,
    `Voice: ${
      options.voice === "first-person" ? "First-person (I)" : "Company (we)"
    }`,
    `Emojis: ${options.includeEmojis ? "Allowed where natural" : "Avoided"}`,
  ].join("\n")
}

function createMockDrafts(options: {
  basePrompt: string
  objective: Objective
  tone: Tone
  lengthPreference: LengthPreference
}): string[] {
  const trimmed = options.basePrompt.trim()
  const snippet =
    trimmed.length > 220 ? `${trimmed.slice(0, 220).trimEnd()}…` : trimmed

  const base =
    snippet ||
    "Share a concise, high-signal update tailored for LinkedIn, focused on impact and a clear lesson."

  const ending =
    options.lengthPreference === "short"
      ? "\n\nWhat’s one takeaway you’d add?"
      : options.lengthPreference === "long"
        ? "\n\nIf this resonates, I’d love to hear how you’re approaching this too."
        : "\n\nCurious to hear how others are thinking about this."

  const tonePrefix =
    options.tone === "friendly"
      ? "I’ve been thinking about this a lot lately:"
      : options.tone === "bold"
        ? "Hot take:"
        : options.tone === "analytical"
          ? "Here’s a structured way I’ve been thinking about this:"
          : "Quick reflection:"

  const draft1 = `${tonePrefix}\n\n${base}${ending}`

  const draft2 = `Here’s the short version:\n\n${base}\n\nIf this is helpful, feel free to share it with someone who needs to read it today.`

  const objectiveSuffix =
    options.objective === "hire"
      ? "\n\nWe’re hiring. If this sounds exciting, my DMs are open."
      : options.objective === "launch"
        ? "\n\nWe’ve been heads down building — excited to finally share more soon."
        : options.objective === "personal-story"
          ? "\n\nNot sharing this for likes, but in case it helps someone who’s a step behind me."
          : "\n\nIf this sparked a thought, I’d love to hear it in the comments."

  const draft3 = `${base}${objectiveSuffix}`

  return [draft1, draft2, draft3]
}

