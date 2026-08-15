import type * as React from "react"
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
  value: Platform
  onChange?: (platform: Platform) => void
  size?: "sm" | "md"
  disabled?: boolean
  className?: string
}

interface OptionButtonProps {
  platform: Platform
  isSelected: boolean
  disabled: boolean
  onClick: () => void
  buttonClass: string
  tooltipText: string
  children: React.ReactNode
  className?: string
}

function PlatformOptionButton({
  platform,
  isSelected,
  disabled,
  onClick,
  buttonClass,
  tooltipText,
  children,
  className = "",
}: OptionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          onClick={onClick}
          className={`relative z-10 flex ${buttonClass} items-center justify-center rounded-full transition-colors ${
            disabled
              ? "cursor-default pointer-events-none"
              : "active:scale-95 cursor-pointer"
          } ${className}`}
          aria-label={`Select ${platform}`}
          aria-pressed={isSelected}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  )
}

const INDEX_MAP: Record<Platform, number> = {
  linkedin: 0,
  linkx: 1,
  x: 2,
}

const INDICATOR_MAP: Record<Platform, string> = {
  linkedin: "bg-[#0077b5]/15 ring-1 ring-[#0077b5]/30 shadow-xs",
  linkx: "bg-primary/20 ring-1 ring-primary/40 shadow-xs",
  x: "bg-foreground/15 ring-1 ring-foreground/20 shadow-xs",
}

const PLATFORM_CONFIGS: {
  id: Platform
  label: string
  activeClass: string
  inactiveClass: string
}[] = [
  {
    id: "linkedin",
    label: "LinkedIn",
    activeClass: "text-[#0077b5] font-semibold",
    inactiveClass: "text-muted-foreground hover:text-[#0077b5]",
  },
  {
    id: "linkx",
    label: "LinkX",
    activeClass: "opacity-100",
    inactiveClass: "opacity-50 hover:opacity-100",
  },
  {
    id: "x",
    label: "X (Twitter)",
    activeClass: "text-foreground font-semibold",
    inactiveClass: "text-muted-foreground hover:text-foreground",
  },
]

export function PlatformSelector({
  value,
  onChange,
  size = "sm",
  disabled = false,
  className = "",
}: PlatformSelectorProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const linkxIconSrc = isDark
    ? "/assets/images/LinkX-icon-light.svg"
    : "/assets/images/LinkX-icon.svg"

  const isSm = size === "sm"
  const buttonSize = isSm ? 22 : 24
  const buttonClass = isSm ? "h-[22px] w-[22px]" : "h-6 w-6"
  const iconSize = isSm ? "h-2.5 w-2.5" : "h-3 w-3"
  const imageSize = isSm ? "h-3 w-3" : "h-3.5 w-3.5"

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={`relative inline-flex items-center rounded-full border border-border/80 bg-card/60 backdrop-blur-xs select-none p-0.5 ${
          disabled ? "cursor-default" : ""
        } ${className}`}
      >
        <div
          className={`absolute rounded-full transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] top-0.5 left-0.5 ${
            INDICATOR_MAP[value]
          }`}
          style={{
            width: `${buttonSize}px`,
            height: `${buttonSize}px`,
            transform: `translateX(${INDEX_MAP[value] * buttonSize}px)`,
          }}
        />

        {PLATFORM_CONFIGS.map((cfg) => {
          const isSelected = value === cfg.id
          return (
            <PlatformOptionButton
              key={cfg.id}
              platform={cfg.id}
              isSelected={isSelected}
              disabled={disabled}
              onClick={() => !disabled && onChange?.(cfg.id)}
              buttonClass={buttonClass}
              tooltipText={
                disabled ? `Published to ${cfg.label}` : `Post to ${cfg.label}`
              }
              className={isSelected ? cfg.activeClass : cfg.inactiveClass}
            >
              {cfg.id === "linkedin" ? (
                <FaLinkedinIn className={iconSize} />
              ) : cfg.id === "linkx" ? (
                <img src={linkxIconSrc} alt="LinkX" className={imageSize} />
              ) : (
                <FaXTwitter className={iconSize} />
              )}
            </PlatformOptionButton>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
