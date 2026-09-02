import { Check, ChevronDown } from "lucide-react"
import * as React from "react"

export interface AIModelOption {
  id: string
  name: string
  provider?: string | null
  is_default?: boolean
}

export function ModelSelectorPill({
  selectedModelId,
  models,
  onSelectModel,
}: {
  selectedModelId: string
  models: AIModelOption[]
  onSelectModel: (m: string) => void
}) {
  const [open, setOpen] = React.useState(false)

  const activeModel = models.find((m) => m.id === selectedModelId)
  const displayLabel = activeModel ? activeModel.name : selectedModelId

  React.useEffect(() => {
    const handleOutside = () => setOpen(false)
    if (open) {
      document.addEventListener("click", handleOutside)
    }
    return () => document.removeEventListener("click", handleOutside)
  }, [open])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((prev) => !prev)
        }}
        className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors cursor-pointer select-none"
      >
        <span className="truncate max-w-[140px]">{displayLabel}</span>
        <ChevronDown className="size-3 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div
          role="menu"
          tabIndex={-1}
          className="absolute bottom-9 right-0 z-50 min-w-44 max-h-60 overflow-y-auto rounded-2xl border border-border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
        >
          {models.map((m) => (
            <button
              type="button"
              key={m.id}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation()
                onSelectModel(m.id)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer font-medium text-left"
            >
              <div className="flex flex-col min-w-0">
                <span className="truncate">{m.name}</span>
                {m.provider && (
                  <span className="text-[10px] text-muted-foreground">
                    {m.provider}
                  </span>
                )}
              </div>
              {selectedModelId === m.id && (
                <Check className="size-3.5 text-primary shrink-0 stroke-[2.5]" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
