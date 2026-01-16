import { Link } from "@tanstack/react-router"

import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import icon from "/assets/images/LinkX-icon.svg"
import iconLight from "/assets/images/LinkX-icon-light.svg"
import logo from "/assets/images/LinkX-logo.svg"
import logoLight from "/assets/images/LinkX-logo-light.svg"

interface LogoProps {
  variant?: "full" | "icon" | "responsive"
  className?: string
  asLink?: boolean
  forceTheme?: "light" | "dark"
}

export function Logo({
  variant = "full",
  className,
  asLink = true,
  forceTheme,
}: LogoProps) {
  const { resolvedTheme } = useTheme()
  const isDark = forceTheme ? forceTheme === "dark" : resolvedTheme === "dark"

  const fullLogo = isDark ? logoLight : logo
  const iconLogo = isDark ? iconLight : icon

  const content =
    variant === "responsive" ? (
      <>
        <img
          src={fullLogo}
          alt="LinkX"
          className={cn(
            "h-6 w-auto group-data-[collapsible=icon]:hidden",
            className,
          )}
        />
        <img
          src={iconLogo}
          alt="LinkX"
          className={cn(
            "size-5 hidden group-data-[collapsible=icon]:block",
            className,
          )}
        />
      </>
    ) : (
      <img
        src={variant === "full" ? fullLogo : iconLogo}
        alt="LinkX"
        className={cn(variant === "full" ? "h-6 w-auto" : "size-5", className)}
      />
    )

  if (!asLink) {
    return content
  }

  return <Link to="/">{content}</Link>
}
