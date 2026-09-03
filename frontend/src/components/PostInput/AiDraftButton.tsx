import { Loader2 } from "lucide-react"
import type * as React from "react"
import { Button } from "@/components/ui/button"

export function PencilSparklesIcon({
  className = "h-4.5 w-4.5",
  ...props
}: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <title>Draft with AI</title>
      <path d="M17.7 3.3a2.4 2.4 0 0 1 3.4 3.4L9.5 18.3 4 19.5l1.2-5.5z" />
      <path d="m15 6 3 3" />
      <path d="M4 2c0 1.5-1 2.5-2.5 2.5C3 4.5 4 5.5 4 7c0-1.5 1-2.5 2.5-2.5C5 4.5 4 3.5 4 2z" />
      <path d="M20 16c0 1-.7 1.7-1.7 1.7 1 0 1.7.7 1.7 1.7 0-1 .7-1.7 1.7-1.7-1 0-1.7-.7-1.7-1.7z" />
    </svg>
  )
}

export function getAiDraftButtonTitle(
  isAiGenerating: boolean,
  isContentEmpty: boolean,
  isAiMode: boolean,
): string {
  if (isAiGenerating) return "Drafting post in background with AI..."
  if (!isContentEmpty) return "Draft with AI"
  if (isAiMode) return "AI Draft Mode Active (click to toggle off)"
  return "Draft with AI"
}

export function AiDraftButton({
  isAiMode,
  isAiGenerating,
  isSubmitting,
  isContentEmpty,
  onClick,
}: {
  isAiMode: boolean
  isAiGenerating: boolean
  isSubmitting: boolean
  isContentEmpty: boolean
  onClick: () => void
}) {
  const label = isAiGenerating
    ? "Generating AI Draft..."
    : isAiMode
      ? "Disable AI Draft Mode"
      : "Draft with AI"

  const title = getAiDraftButtonTitle(isAiGenerating, isContentEmpty, isAiMode)
  const modeClass = isAiMode
    ? "text-primary bg-primary/20 ring-1 ring-primary/40 shadow-xs"
    : "text-muted-foreground hover:text-primary hover:bg-primary/10"

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`h-8.5 w-8.5 rounded-full transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ${modeClass}`}
      aria-label={label}
      title={title}
      onClick={onClick}
      disabled={isSubmitting || isAiGenerating}
      data-testid="ai-draft-btn"
    >
      {isAiGenerating ? (
        <Loader2 className="h-4.5 w-4.5 animate-spin text-primary" />
      ) : (
        <PencilSparklesIcon className="h-4.5 w-4.5" />
      )}
    </Button>
  )
}
