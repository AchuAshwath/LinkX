import { FaLinkedinIn } from "react-icons/fa"
import { FaXTwitter } from "react-icons/fa6"
import { useTheme } from "@/components/theme-provider"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export type Platform = "linkedin" | "x" | "linkx"

interface PlatformSelectorProps {
  /** Selected platform - single value only */
  value: Platform
  /** Callback when platform selection changes */
  onChange: (platform: Platform) => void
  /** Size variant - 'sm' for smaller (used in Draft/Scheduled posts), 'md' for medium (used in PostInputBox) */
  size?: "sm" | "md"
  /** Additional className for the container */
  className?: string
}

export function PlatformSelector({
  value,
  onChange,
  size = "md",
  className = "",
}: PlatformSelectorProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const linkxIconSrc = isDark
    ? "/assets/images/LinkX-icon-light.svg"
    : "/assets/images/LinkX-icon.svg"

  const isLinkedIn = value === "linkedin"
  const isLinkX = value === "linkx"
  const isX = value === "x"

  // Size classes
  const containerClasses =
    size === "sm"
      ? "gap-0.5 px-0.5 py-0.5"
      : "gap-0.5 px-0.5 py-0.5 sm:gap-1 sm:px-1 sm:py-0.5"
  const buttonClasses = size === "sm" ? "h-6 w-6" : "h-8 w-8 sm:h-6 sm:w-6"
  const iconClasses = size === "sm" ? "h-3 w-3" : "h-4 w-4 sm:h-3.5 sm:w-3.5"
  const imageClasses =
    size === "sm" ? "h-3.5 w-3.5" : "h-4.5 w-4.5 sm:h-4 sm:w-4"

  return (
    <TooltipProvider>
      <div
        className={`flex items-center rounded-full border bg-card shadow-2xs ${containerClasses} ${className}`}
      >
        {/* LinkedIn Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onChange("linkedin")}
              className={`flex ${buttonClasses} items-center justify-center rounded-full transition-all active:scale-95 cursor-pointer ${
                isLinkedIn
                  ? "bg-[#0077b5]/15 text-[#0077b5] font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-[#0077b5] hover:bg-[#0077b5]/10"
              }`}
              aria-label="Post to LinkedIn"
            >
              <FaLinkedinIn className={iconClasses} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Post to LinkedIn
          </TooltipContent>
        </Tooltip>

        {/* LinkX (Cross-post to both LinkedIn & X) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onChange("linkx")}
              className={`flex ${buttonClasses} items-center justify-center rounded-full transition-all active:scale-95 cursor-pointer ${
                isLinkX
                  ? "bg-primary/20 ring-1 ring-primary/40 shadow-xs"
                  : "opacity-60 hover:opacity-100 hover:bg-muted/80"
              }`}
              aria-label="Cross-post to both LinkedIn and X (LinkX)"
            >
              <img src={linkxIconSrc} alt="LinkX" className={imageClasses} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Cross-post to both (LinkX)
          </TooltipContent>
        </Tooltip>

        {/* X (Twitter) Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onChange("x")}
              className={`flex ${buttonClasses} items-center justify-center rounded-full transition-all active:scale-95 cursor-pointer ${
                isX
                  ? "bg-foreground/15 text-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/10"
              }`}
              aria-label="Post to X (Twitter)"
            >
              <FaXTwitter className={iconClasses} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Post to X (Twitter)
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
