import { Mic } from "lucide-react"
import { cn } from "@/lib/utils"

export interface VoiceInputButtonProps {
  isListening: boolean
  isSupported: boolean
  onToggle: () => void
  disabled?: boolean
  error?: string | null
  className?: string
}

export function VoiceInputButton({
  isListening,
  isSupported,
  onToggle,
  disabled = false,
  error,
  className,
}: VoiceInputButtonProps) {
  if (!isSupported) {
    return (
      <button
        type="button"
        disabled
        aria-label="Voice input not supported in this browser"
        title="Voice input is not supported in this browser (available on Chrome/Edge/Safari)"
        className={cn(
          "flex size-7 items-center justify-center rounded-full text-muted-foreground/40 cursor-not-allowed opacity-50",
          className,
        )}
      >
        <Mic className="size-3.5" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={isListening ? "Stop voice input" : "Start voice input"}
      title={
        error
          ? error
          : isListening
            ? "Listening… Click to stop"
            : "Voice input (Click to speak)"
      }
      className={cn(
        "flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors cursor-pointer",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      <Mic
        className={cn(
          "size-3.5 transition-colors duration-200",
          isListening ? "text-red-500" : "text-muted-foreground",
        )}
      />
    </button>
  )
}
