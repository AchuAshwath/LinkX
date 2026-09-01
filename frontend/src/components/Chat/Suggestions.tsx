import { Button } from "@/components/ui/button"

const SUGGESTIONS = [
  {
    label: "Viral Launch Post",
    prompt:
      "Draft a high-engagement launch post for our new product feature with an irresistible hook and 3 concise bullet points.",
  },
  {
    label: "Analyze Trends",
    prompt:
      "Analyze trending tech and developer discussions on X and recommend 3 viral post angles.",
  },
  {
    label: "Refine Recent Draft",
    prompt:
      "Help me polish my recent draft into a punchy LinkedIn thought-leadership post.",
  },
  {
    label: "Multi-Channel Strategy",
    prompt:
      "Create a synchronized multi-channel social plan comparing X and LinkedIn tones.",
  },
]

export function Suggestions({
  onSelect,
}: {
  onSelect: (prompt: string) => void
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2 max-w-lg mx-auto">
      {SUGGESTIONS.map((suggestion) => (
        <Button
          key={suggestion.label}
          variant="outline"
          size="sm"
          onClick={() => onSelect(suggestion.prompt)}
          className="rounded-full text-xs font-medium px-3 py-1.5 h-auto border-border/80 hover:border-primary/50 hover:bg-primary/5 cursor-pointer transition-all"
        >
          {suggestion.label}
        </Button>
      ))}
    </div>
  )
}
