import * as React from "react"

export interface UseComposerKeyboardProps {
  isAiMode?: boolean
  scheduledAt?: Date
  isScheduleOpen?: boolean
  onAiDraftSubmit?: () => void
  handleSubmit: (action: "draft" | "schedule" | "post") => void
}

export function useComposerKeyboard({
  isAiMode = false,
  scheduledAt,
  isScheduleOpen = false,
  onAiDraftSubmit,
  handleSubmit,
}: UseComposerKeyboardProps) {
  return React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter") return

      const isModifier = event.metaKey || event.ctrlKey
      if (isModifier) {
        event.preventDefault()
        if (isAiMode && onAiDraftSubmit) {
          onAiDraftSubmit()
          return
        }
        handleSubmit(scheduledAt || isScheduleOpen ? "schedule" : "post")
        return
      }

      if (isAiMode && !event.shiftKey && onAiDraftSubmit) {
        event.preventDefault()
        onAiDraftSubmit()
      }
    },
    [isAiMode, scheduledAt, isScheduleOpen, onAiDraftSubmit, handleSubmit],
  )
}
