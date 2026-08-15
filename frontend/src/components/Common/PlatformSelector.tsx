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
          tabIndex={-1}
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

const SIZE_CONFIGS = {
  sm: {
    buttonSize: 22,
    buttonClass: "h-[22px] w-[22px]",
    iconSize: "h-2.5 w-2.5",
    imageSize: "h-3 w-3",
  },
  md: {
    buttonSize: 24,
    buttonClass: "h-6 w-6",
    iconSize: "h-3 w-3",
    imageSize: "h-3.5 w-3.5",
  },
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

function PlatformSliderIndicator({
  value,
  buttonSize,
}: {
  value: Platform
  buttonSize: number
}) {
  return (
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
  )
}

function PlatformIconContent({
  id,
  resolvedTheme,
  iconSize,
  imageSize,
}: {
  id: Platform
  resolvedTheme: string | undefined
  iconSize: string
  imageSize: string
}) {
  if (id === "linkedin") {
    return <FaLinkedinIn className={iconSize} />
  }

  if (id === "x") {
    return <FaXTwitter className={iconSize} />
  }

  const logoSrc =
    resolvedTheme === "light"
      ? "/assets/images/logo_light.svg"
      : "/assets/images/logo_dark.svg"

  return (
    <img
      src={logoSrc}
      alt="LinkX"
      className={`${imageSize} object-contain transition-all`}
    />
  )
}

export function PlatformSelector({
  value,
  onChange,
  size = "md",
  disabled = false,
  className = "",
}: PlatformSelectorProps) {
  const { resolvedTheme } = useTheme()
  const currentConfig = SIZE_CONFIGS[size]

  return (
    <TooltipProvider delayDuration={300}>
      <fieldset
        className={`relative inline-flex items-center rounded-full bg-muted/40 p-0.5 border border-border/40 select-none ${className}`}
        aria-label="Target Platform Selector"
      >
        <PlatformSliderIndicator
          value={value}
          buttonSize={currentConfig.buttonSize}
        />

        {PLATFORM_CONFIGS.map((cfg) => {
          const isSelected = value === cfg.id
          const colorClass = isSelected ? cfg.activeClass : cfg.inactiveClass

          return (
            <PlatformOptionButton
              key={cfg.id}
              platform={cfg.id}
              isSelected={isSelected}
              disabled={disabled}
              onClick={() => onChange?.(cfg.id)}
              buttonClass={currentConfig.buttonClass}
              tooltipText={`Post to ${cfg.label}`}
              className={colorClass}
            >
              <PlatformIconContent
                id={cfg.id}
                resolvedTheme={resolvedTheme}
                iconSize={currentConfig.iconSize}
                imageSize={currentConfig.imageSize}
              />
            </PlatformOptionButton>
          )
        })}
      </fieldset>
    </TooltipProvider>
  )
}
