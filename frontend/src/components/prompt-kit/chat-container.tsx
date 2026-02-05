import * as React from "react"

import { cn } from "@/lib/utils"

interface ChatContainerRootProps {
  children: React.ReactNode
  className?: string
}

interface ChatContainerContentProps {
  children: React.ReactNode
  className?: string
}

interface ChatContainerScrollAnchorProps {
  className?: string
}

/**
 * Lightweight, PromptKit-inspired chat container.
 *
 * This mirrors the public API of PromptKit's ChatContainer primitives
 * enough for us to compose a rich chat UI while keeping the implementation
 * local to LinkX. When/if you install official PromptKit components via
 * the shadcn CLI, you can swap these exports with the upstream ones.
 */
export function ChatContainerRoot({
  children,
  className,
}: ChatContainerRootProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  // Simple stick-to-bottom behavior whenever children change
  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64
    if (isAtBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [children])

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex-1 overflow-y-auto px-4 py-4 space-y-4",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function ChatContainerContent({
  children,
  className,
}: ChatContainerContentProps) {
  return <div className={cn("flex flex-col gap-4", className)}>{children}</div>
}

export function ChatContainerScrollAnchor({
  className,
}: ChatContainerScrollAnchorProps) {
  return <div className={cn("h-px w-full", className)} />
}

