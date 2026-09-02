import { ArrowDownIcon } from "lucide-react"
import * as React from "react"
import { cn } from "@/lib/utils"

interface MessageScrollerContextValue {
  viewportRef: React.RefObject<HTMLDivElement | null>
  bottomRef: React.RefObject<HTMLDivElement | null>
  isAtBottom: boolean
  scrollToBottom: (smooth?: boolean) => void
  scrollToTop: (smooth?: boolean) => void
}

const MessageScrollerContext = React.createContext<
  MessageScrollerContextValue | undefined
>(undefined)

export function useMessageScroller() {
  const context = React.useContext(MessageScrollerContext)
  if (!context) {
    throw new Error(
      "useMessageScroller must be used within MessageScrollerProvider",
    )
  }
  return context
}

function useBottomSentinelObserver(
  viewportRef: React.RefObject<HTMLDivElement | null>,
  bottomRef: React.RefObject<HTMLDivElement | null>,
  onIntersectionChange: (isIntersecting: boolean) => void,
) {
  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return
    const bottomEl = bottomRef.current
    const viewportEl = viewportRef.current
    if (!bottomEl || !viewportEl) return

    const observer = new IntersectionObserver(
      ([entry]) => onIntersectionChange(entry.isIntersecting),
      { root: viewportEl, threshold: 0.1 },
    )

    observer.observe(bottomEl)
    return () => observer.disconnect()
  }, [bottomRef, viewportRef, onIntersectionChange])
}

export function MessageScrollerProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const bottomRef = React.useRef<HTMLDivElement | null>(null)
  const [isAtBottom, setIsAtBottom] = React.useState(true)

  const scrollToBottom = React.useCallback((smooth = false) => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({
        behavior: smooth ? "smooth" : "auto",
        block: "end",
      })
    } else if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight
    }
  }, [])

  const scrollToTop = React.useCallback((smooth = false) => {
    if (viewportRef.current) {
      if (smooth && typeof viewportRef.current.scrollTo === "function") {
        viewportRef.current.scrollTo({ top: 0, behavior: "smooth" })
      } else {
        viewportRef.current.scrollTop = 0
      }
    }
  }, [])

  useBottomSentinelObserver(viewportRef, bottomRef, setIsAtBottom)

  return (
    <MessageScrollerContext.Provider
      value={{
        viewportRef,
        bottomRef,
        isAtBottom,
        scrollToBottom,
        scrollToTop,
      }}
    >
      {children}
    </MessageScrollerContext.Provider>
  )
}

export function MessageScroller({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-scroller"
      className={cn(
        "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function MessageScrollerViewport({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { viewportRef } = useMessageScroller()

  return (
    <div
      ref={viewportRef}
      data-slot="message-scroller-viewport"
      className={cn(
        "size-full min-h-0 min-w-0 scrollbar-thin overflow-y-auto",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function MessageScrollerContent({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { bottomRef } = useMessageScroller()

  return (
    <div
      data-slot="message-scroller-content"
      className={cn("flex h-max min-h-full flex-col gap-6 p-4", className)}
      {...props}
    >
      {children}
      <div
        ref={bottomRef}
        data-slot="message-scroller-bottom-anchor"
        className="h-px w-full shrink-0 pointer-events-none"
      />
    </div>
  )
}

export function MessageScrollerItem({
  className,
  messageId: _messageId,
  scrollAnchor: _scrollAnchor,
  ...props
}: React.ComponentProps<"div"> & {
  messageId?: string
  scrollAnchor?: boolean
}) {
  return (
    <div
      data-slot="message-scroller-item"
      className={cn("min-w-0 shrink-0", className)}
      {...props}
    />
  )
}

export function MessageScrollerButton({
  direction = "end",
  className,
  children,
  variant: _variant = "secondary",
  size: _size = "icon-sm",
  ...props
}: React.ComponentProps<"button"> & {
  direction?: "start" | "end"
  variant?: "secondary" | "outline" | "default"
  size?: "icon-sm" | "icon" | "sm"
}) {
  const { scrollToBottom, scrollToTop, isAtBottom } = useMessageScroller()

  if (direction === "end" && isAtBottom) {
    return null
  }

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (direction === "end") {
      scrollToBottom(true)
    } else {
      scrollToTop(true)
    }
  }

  return (
    <button
      type="button"
      data-slot="message-scroller-button"
      data-direction={direction}
      onClick={handleClick}
      aria-label={direction === "end" ? "Scroll to bottom" : "Scroll to top"}
      className={cn(
        "border border-border/80 bg-[#161618]/95 backdrop-blur-md text-foreground shadow-md rounded-full transition-all duration-200 hover:bg-muted cursor-pointer p-1.5 flex items-center justify-center size-8 z-20 animate-in fade-in-0 zoom-in-90",
        className,
      )}
      {...props}
    >
      {children ?? <ArrowDownIcon className="size-3.5 stroke-[2.5]" />}
    </button>
  )
}
