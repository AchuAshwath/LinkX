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

  const activeIndex = isLinkedIn ? 0 : isLinkX ? 1 : 2

  const isSm = size === "sm"
  const buttonSize = isSm ? 22 : 24
  const buttonClass = isSm ? "h-[22px] w-[22px]" : "h-6 w-6"
  const iconSize = isSm ? "h-2.5 w-2.5" : "h-3 w-3"
  const imageSize = isSm ? "h-3 w-3" : "h-3.5 w-3.5"
  const paddingClass = "p-0.5"

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={`relative inline-flex items-center rounded-full border border-border/80 bg-card/60 backdrop-blur-xs select-none ${paddingClass} ${className}`}
      >
        {/* Fluid sliding active background indicator */}
        <div
          className={`absolute rounded-full transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] top-0.5 left-0.5 ${
            isLinkedIn
              ? "bg-[#0077b5]/15 ring-1 ring-[#0077b5]/30 shadow-xs"
              : isLinkX
                ? "bg-primary/20 ring-1 ring-primary/40 shadow-xs"
                : "bg-foreground/15 ring-1 ring-foreground/20 shadow-xs"
          }`}
          style={{
            width: `${buttonSize}px`,
            height: `${buttonSize}px`,
            transform: `translateX(${activeIndex * buttonSize}px)`,
          }}
        />

        {/* LinkedIn Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onChange("linkedin")}
              className={`relative z-10 flex ${buttonClass} items-center justify-center rounded-full transition-colors active:scale-95 cursor-pointer ${
                isLinkedIn
                  ? "text-[#0077b5] font-semibold"
                  : "text-muted-foreground hover:text-[#0077b5]"
              }`}
              aria-label="Post to LinkedIn"
            >
              <FaLinkedinIn className={iconSize} />
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
              className={`relative z-10 flex ${buttonClass} items-center justify-center rounded-full transition-colors active:scale-95 cursor-pointer ${
                isLinkX ? "opacity-100" : "opacity-50 hover:opacity-100"
              }`}
              aria-label="Cross-post to both LinkedIn and X (LinkX)"
            >
              <img src={linkxIconSrc} alt="LinkX" className={imageSize} />
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
              className={`relative z-10 flex ${buttonClass} items-center justify-center rounded-full transition-colors active:scale-95 cursor-pointer ${
                isX
                  ? "text-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-label="Post to X (Twitter)"
            >
              <FaXTwitter className={iconSize} />
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
