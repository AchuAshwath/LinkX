import * as React from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import {
  ObservationComposerPreview,
  type ObservationComposerSlotProps,
} from "@/observation/ObservationComposerSlot"
import { useFloatingPreviewPosition } from "@/observation/useFloatingPreviewPosition"
import { ownerIdForChat } from "./ownership"
import type { BrowserReadingSession } from "./session"
import { useBrowserReading } from "./useBrowserReading"

interface ComposerViewOptions {
  session: BrowserReadingSession
  activeThreadId: string | null
  model: string
  ownsCurrentChat: boolean
  isActive: boolean
  videoRef: React.RefCallback<HTMLVideoElement>
  addContextButtonRef?: React.RefObject<HTMLButtonElement | null>
}

function createComposerView(
  options: ComposerViewOptions,
): ObservationComposerSlotProps | null {
  if (options.isActive && !options.ownsCurrentChat) return null
  return {
    view: {
      isConnected: options.isActive,
      hasCurrentFrame: true,
      status: options.isActive
        ? "Browser tab is shared with this chat."
        : "Browser tab context is off.",
    },
    videoRef: options.videoRef,
    onStart: () => {
      if (options.isActive) return
      const started = options.session.start(
        options.activeThreadId,
        crypto.randomUUID(),
        options.model,
      )
      if (!started)
        toast.error(
          "Browser processing is still settling. Try again shortly, or reload to start fresh.",
        )
    },
    onStop: () => {
      if (options.ownsCurrentChat) options.session.stop()
    },
    onReset: () => {},
    addContextButtonRef: options.addContextButtonRef,
  }
}

function isTypingTarget(target: HTMLElement): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  )
}

function captureFocusTarget(): HTMLElement | null {
  const target = document.activeElement
  if (!(target instanceof HTMLElement)) return null
  return isTypingTarget(target) ? target : null
}

function restoreFocusTarget(
  target: HTMLElement | null,
  fallback: HTMLButtonElement | null | undefined,
): void {
  if (target?.isConnected) {
    target.focus({ preventScroll: true })
    return
  }
  fallback?.focus({ preventScroll: true })
}

function useSourceEndFocus(
  session: BrowserReadingSession,
  isActive: boolean,
  addContextButtonRef?: React.RefObject<HTMLButtonElement | null>,
): void {
  const wasActive = React.useRef(false)
  const endedFocusTarget = React.useRef<HTMLElement | null>(null)

  React.useEffect(
    () =>
      session.subscribeSourceEnded(() => {
        endedFocusTarget.current = captureFocusTarget()
      }),
    [session],
  )

  React.useLayoutEffect(() => {
    if (wasActive.current && !isActive) {
      restoreFocusTarget(endedFocusTarget.current, addContextButtonRef?.current)
      endedFocusTarget.current = null
    }
    wasActive.current = isActive
  }, [addContextButtonRef, isActive])
}

export function BrowserReadingControls({
  session,
  activeThreadId,
  model,
  onComposerViewChange,
  addContextButtonRef,
}: {
  session: BrowserReadingSession
  activeThreadId: string | null
  model: string
  onComposerViewChange: (view: ObservationComposerSlotProps | null) => void
  addContextButtonRef?: React.RefObject<HTMLButtonElement | null>
}) {
  const snapshot = useBrowserReading(session)
  useCapacityNotice(snapshot.capacityReached)
  const previewRef = React.useRef<HTMLElement | null>(null)
  const isActive = snapshot.state !== "stopped"
  useSourceEndFocus(session, isActive, addContextButtonRef)
  const videoRef = React.useCallback(
    (element: HTMLVideoElement | null) => session.attachPreview(element),
    [session],
  )
  const ownsCurrentChat = Boolean(ownerIdForChat(snapshot, activeThreadId))
  const view = React.useMemo(
    () =>
      createComposerView({
        session,
        activeThreadId,
        model,
        ownsCurrentChat,
        isActive,
        videoRef,
        addContextButtonRef,
      }),
    [
      activeThreadId,
      addContextButtonRef,
      isActive,
      model,
      ownsCurrentChat,
      session,
      videoRef,
    ],
  )
  const isPreviewVisible = isActive && ownsCurrentChat
  const { position, dragHandlers } = useFloatingPreviewPosition({
    active: isPreviewVisible,
    previewRef,
  })

  React.useEffect(() => {
    onComposerViewChange(view)
  }, [onComposerViewChange, view])

  if (!isPreviewVisible || !view) return null
  return createPortal(
    <ObservationComposerPreview
      {...view}
      previewRef={previewRef}
      dragHandlers={dragHandlers}
      style={floatingStyle(position)}
    />,
    document.body,
  )
}

function floatingStyle(
  position: { left: number; top: number; width: number; height: number } | null,
): React.CSSProperties {
  const measured = position ?? { left: 0, top: 0, width: 0, height: 0 }
  return {
    ...measured,
    position: "fixed",
    zIndex: 50,
    visibility: position ? "visible" : "hidden",
  }
}

function useCapacityNotice(paused: boolean): void {
  React.useEffect(() => {
    if (!paused) return
    toast.info(
      "Browser reading paused at its research limit. Ask about captured views, or stop sharing to start fresh.",
    )
  }, [paused])
}
