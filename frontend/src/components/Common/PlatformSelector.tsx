import { FaLinkedinIn } from "react-icons/fa"
import { FaXTwitter } from "react-icons/fa6"
import { useTheme } from "@/components/theme-provider"

export type Platform = "linkedin" | "x" | "all"

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
  const faviconSrc = isDark
    ? "/assets/images/favicon-32x32-light.png"
    : "/assets/images/favicon-32x32.png"

  const handlePlatformClick = (platform: Platform) => {
    onChange(platform)
  }

  // Size classes
  const containerClasses =
    size === "sm"
      ? "gap-0.5 px-0.5 py-0.5"
      : "gap-0.5 px-0.5 py-0.5 sm:gap-1 sm:px-1 sm:py-0.5"
  const buttonClasses =
    size === "sm"
      ? "h-6 w-6"
      : "h-8 w-8 sm:h-6 sm:w-6"
  const iconClasses = size === "sm" ? "h-3 w-3" : "h-4 w-4 sm:h-3.5 sm:w-3.5"
  const imageClasses = size === "sm" ? "h-3 w-3" : "h-4 w-4 sm:h-3.5 sm:w-3.5"

  return (
    <div
      className={`flex items-center rounded-full border bg-card ${containerClasses} ${className}`}
    >
      <button
        type="button"
        onClick={() => handlePlatformClick("linkedin")}
        className={`flex ${buttonClasses} items-center justify-center rounded-full transition-colors active:scale-95 ${
          value === "linkedin"
            ? "bg-muted text-[#0A66C2]"
            : "text-[#0A66C2] active:bg-muted"
        }`}
        aria-label="Post to LinkedIn"
      >
        <FaLinkedinIn className={iconClasses} />
      </button>
      <button
        type="button"
        onClick={() => handlePlatformClick("all")}
        className={`flex ${buttonClasses} items-center justify-center rounded-full transition-colors active:scale-95 ${
          value === "all" ? "bg-muted" : "active:bg-muted"
        }`}
        aria-label="Post to all channels"
      >
        <img src={faviconSrc} alt="LinkX" className={imageClasses} />
      </button>
      <button
        type="button"
        onClick={() => handlePlatformClick("x")}
        className={`flex ${buttonClasses} items-center justify-center rounded-full transition-colors active:scale-95 ${
          value === "x"
            ? "bg-muted text-foreground"
            : "text-muted-foreground active:bg-muted"
        }`}
        aria-label="Post to X"
      >
        <FaXTwitter className={iconClasses} />
      </button>
    </div>
  )
}
