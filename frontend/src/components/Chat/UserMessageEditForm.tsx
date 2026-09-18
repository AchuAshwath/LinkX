import * as React from "react"

export interface UserMessageEditFormProps {
  initialText: string
  onSave: (text: string) => void
  onCancel: () => void
}

function handleEditFormKeyDown({
  event,
  editText,
  onSave,
  onCancel,
}: {
  event: React.KeyboardEvent<HTMLTextAreaElement>
  editText: string
  onSave: (text: string) => void
  onCancel: () => void
}) {
  if (event.key === "Escape") {
    event.preventDefault()
    onCancel()
    return
  }
  const isPlainEnter = event.key === "Enter" && !event.shiftKey
  if (isPlainEnter) {
    event.preventDefault()
    const trimmed = editText.trim()
    if (trimmed) {
      onSave(trimmed)
    }
  }
}

export function UserMessageEditForm({
  initialText,
  onSave,
  onCancel,
}: UserMessageEditFormProps) {
  const [editText, setEditText] = React.useState(initialText)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    textareaRef.current?.focus()
    const len = textareaRef.current?.value.length || 0
    textareaRef.current?.setSelectionRange(len, len)
  }, [])

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    handleEditFormKeyDown({ event, editText, onSave, onCancel })
  }

  const trimmedText = editText.trim()
  const canSave = trimmedText.length > 0
  const rowCount = Math.min(5, Math.max(2, editText.split("\n").length))

  return (
    <div className="flex flex-col items-end w-full max-w-xl gap-2">
      <div className="w-full rounded-2xl border border-primary/40 bg-muted/30 p-3 shadow-sm focus-within:border-primary">
        <textarea
          ref={textareaRef}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full min-h-[60px] max-h-[200px] resize-none bg-transparent text-sm text-foreground focus:outline-none placeholder:text-muted-foreground leading-relaxed"
          rows={rowCount}
        />
        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <span className="text-[11px] text-muted-foreground/60">
            Esc to cancel &bull; Enter to save
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onCancel}
              className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSave}
              onClick={() => canSave && onSave(trimmedText)}
              className="px-3 py-1 text-xs rounded-md font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors cursor-pointer shadow-sm"
            >
              Save & Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
