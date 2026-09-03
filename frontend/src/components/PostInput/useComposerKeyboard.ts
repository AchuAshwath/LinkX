import * as React from "react"

export interface UseComposerKeyboardProps {
  isAiMode?: boolean
  scheduledAt?: Date
  isScheduleOpen?: boolean
  onAiDraftSubmit?: () => void
  handleSubmit: (action: "draft" | "schedule" | "post") => void
}

function handleModifierEnter(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  isAiMode: boolean,
  onAiDraftSubmit?: () => void,
  onSubmitAction?: () => void,
): void {
  event.preventDefault()
  if (isAiMode && onAiDraftSubmit) {
    onAiDraftSubmit()
    return
  }
  onSubmitAction?.()
}

function handlePlainEnterInAi(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  onAiDraftSubmit?: () => void,
): void {
  if (event.shiftKey) return
  if (!onAiDraftSubmit) return
  event.preventDefault()
  onAiDraftSubmit()
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

      if (event.metaKey || event.ctrlKey) {
        const action = scheduledAt || isScheduleOpen ? "schedule" : "post"
        handleModifierEnter(event, isAiMode, onAiDraftSubmit, () =>
          handleSubmit(action),
        )
        return
      }

      if (isAiMode) {
        handlePlainEnterInAi(event, onAiDraftSubmit)
      }
    },
    [isAiMode, scheduledAt, isScheduleOpen, onAiDraftSubmit, handleSubmit],
  )
}
