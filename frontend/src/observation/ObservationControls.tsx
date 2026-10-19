import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { PromptForm } from "@/components/Chat/PromptForm"
import type { ObservationComposerSlotProps } from "./ObservationComposerSlot"
import { ObservationComposerPreview } from "./ObservationComposerSlot"
import { encodeCurrentView, type ObservationPacket } from "./packet"
import { createObservationSession } from "./session"
import { useObservationComposerState } from "./useObservationComposerState"

const OBSERVING_STATUS =
  "Browser tab is ready. Current view is included when you send."
const WAITING_STATUS =
  "Waiting for the first frame from the shared browser tab."
const RESUMING_STATUS = "Waiting for a current frame from the browser tab."
const MUTED_STATUS =
  "Browser tab sharing is paused. Resume sharing to send a view."
const ATTACHMENT_CONFLICT_STATUS =
  "Remove attached images before including the browser tab."

function encodePreparedObservation({
  video,
  metadata,
  setStatus,
}: {
  video: HTMLVideoElement
  metadata: Parameters<typeof encodeCurrentView>[1]
  setStatus: (status: string) => void
}) {
  try {
    return encodeCurrentView(video, metadata)
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Could not capture the tab.",
    )
    throw error
  }
}

function rememberFramePresentationTime({
  metadata,
  videoTrack,
  presentationRef,
}: {
  metadata: VideoFrameCallbackMetadata
  videoTrack: MediaStreamTrack
  presentationRef: { current: number | null }
}) {
  if (!Number.isFinite(metadata.presentationTime)) return
  if (videoTrack.readyState !== "live") return
  if (videoTrack.muted) return
  presentationRef.current = metadata.presentationTime
}

function currentFrameIsUnavailable({
  video,
  videoTrack,
  currentSessionId,
  frameAvailable,
}: {
  video: HTMLVideoElement | null
  videoTrack: MediaStreamTrack | undefined
  currentSessionId: string | null
  frameAvailable: boolean
}) {
  if (!video) return true
  if (!currentSessionId) return true
  if (!videoTrack) return true
  if (videoTrack.readyState !== "live") return true
  if (videoTrack.muted) return true
  return !frameAvailable
}

function getTypingTarget(element: Element | null): HTMLElement | null {
  if (!(element instanceof HTMLElement)) return null
  if (element.isContentEditable) return element
  if (element.matches("input, textarea")) return element
  return null
}

interface ObservationControlsProps {
  activeThreadId?: string | null
  handoffTargetThreadId?: string | null
  onHandoffConsumed?: () => void
  observationModelName?: string
  prepareTurnRef?: PrepareObservationTurnRef
  renderInComposer?: boolean
  onComposerViewChange?: (view: ObservationComposerSlotProps) => void
}

export interface PrepareObservationTurnRef {
  current:
    | ((hasAttachedImages: boolean) => Readonly<ObservationPacket> | null)
    | null
}

const NOOP = () => {}

export function ObservationControls({
  activeThreadId = null,
  handoffTargetThreadId = null,
  onHandoffConsumed = NOOP,
  observationModelName,
  prepareTurnRef,
  renderInComposer = false,
  onComposerViewChange,
}: ObservationControlsProps) {
  const session = useMemo(() => createObservationSession(), [])
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(
    null,
  )
  const currentThreadId = useRef(activeThreadId)
  const captureOwnerThreadId = useRef<string | null | undefined>(undefined)
  const startAttempt = useRef(0)
  const sourceEpoch = useRef(0)
  const revision = useRef(0)
  const sessionId = useRef<string | null>(null)
  const endedFocusTarget = useRef<HTMLElement | null>(null)
  const framePresentedAtMs = useRef<number | null>(null)
  const currentFrameAvailable = useRef(false)
  const [preview, setPreview] = useState<MediaStream | null>(null)
  const [status, setStatus] = useState("Browser tab context is off.")
  const [isPaused, setIsPaused] = useState(false)
  const videoRef = useCallback((element: HTMLVideoElement | null) => {
    setVideoElement(element)
  }, [])
  const { composerView } = useObservationComposerState({
    activeThreadId,
    observationModelName,
    session,
    preview,
    isPaused,
    status,
    currentFrameAvailable,
    startAttempt,
    sourceEpoch,
    revision,
    sessionId,
    framePresentedAtMs,
    captureOwnerThreadId,
    setPreview,
    setIsPaused,
    setStatus,
    videoRef,
  })

  useLayoutEffect(() => {
    onComposerViewChange?.(composerView)
  }, [composerView, onComposerViewChange])

  useLayoutEffect(() => {
    if (preview) return
    const target = endedFocusTarget.current
    if (!target) return
    endedFocusTarget.current = null
    if (!target.isConnected || document.activeElement === target) return
    target.focus({ preventScroll: true })
  }, [preview])

  useLayoutEffect(() => {
    const video = videoElement
    if (!video) return
    video.srcObject = preview
    return () => {
      video.srcObject = null
    }
  }, [preview, videoElement])

  useEffect(() => {
    if (!preview) return
    const video = videoElement
    if (!video) return
    const [videoTrack] = preview.getVideoTracks()
    let frameRequestId: number | null = null
    let fallbackStartTime: number | null = null
    let active = true
    const cancelFrameRequest = () => {
      if (frameRequestId === null) return
      video.cancelVideoFrameCallback?.(frameRequestId)
      frameRequestId = null
    }
    const requestNextVideoFrame = () => {
      if (!video.requestVideoFrameCallback) return
      if (frameRequestId !== null) return
      frameRequestId = video.requestVideoFrameCallback((_now, metadata) => {
        frameRequestId = null
        if (!active) return
        rememberFramePresentationTime({
          metadata,
          videoTrack,
          presentationRef: framePresentedAtMs,
        })
        handleVideoFrame()
        requestNextVideoFrame()
      })
    }
    const handleFallbackTimeUpdate = () => {
      if (!active) return
      if (fallbackStartTime === null) return
      if (video.currentTime <= fallbackStartTime) return
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
      if (videoTrack.readyState !== "live") return
      if (videoTrack.muted) return
      fallbackStartTime = null
      video.removeEventListener("timeupdate", handleFallbackTimeUpdate)
      currentFrameAvailable.current = true
      setIsPaused(false)
      setStatus(OBSERVING_STATUS)
    }
    const stopFallbackObservation = () => {
      fallbackStartTime = null
      video.removeEventListener("timeupdate", handleFallbackTimeUpdate)
    }
    const startFallbackObservation = () => {
      fallbackStartTime = video.currentTime
      video.addEventListener("timeupdate", handleFallbackTimeUpdate)
    }
    const handleCaptureEnded = () => {
      active = false
      endedFocusTarget.current = getTypingTarget(document.activeElement)
      currentFrameAvailable.current = false
      cancelFrameRequest()
      stopFallbackObservation()
      session.stop()
      captureOwnerThreadId.current = undefined
      sessionId.current = null
      setPreview(null)
      setIsPaused(false)
      setStatus("Browser tab sharing ended. Choose a tab to share again.")
    }
    const handleMuted = () => {
      currentFrameAvailable.current = false
      setIsPaused(true)
      cancelFrameRequest()
      stopFallbackObservation()
      setStatus(MUTED_STATUS)
    }
    const handleVideoFrame = () => {
      if (!active) return
      if (videoTrack.readyState !== "live") return
      if (videoTrack.muted) return
      stopFallbackObservation()
      currentFrameAvailable.current = true
      setIsPaused(false)
      setStatus(OBSERVING_STATUS)
    }
    const handleUnmuted = () => {
      currentFrameAvailable.current = false
      setIsPaused(false)
      setStatus(RESUMING_STATUS)
      if (!video.requestVideoFrameCallback) {
        startFallbackObservation()
        return
      }
      startFallbackObservation()
      cancelFrameRequest()
      requestNextVideoFrame()
    }

    videoTrack.addEventListener("ended", handleCaptureEnded)
    videoTrack.addEventListener("mute", handleMuted)
    videoTrack.addEventListener("unmute", handleUnmuted)
    video.addEventListener("loadeddata", handleVideoFrame)

    if (videoTrack.readyState === "ended") {
      handleCaptureEnded()
    } else if (videoTrack.muted) {
      handleMuted()
    } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      handleVideoFrame()
      requestNextVideoFrame()
    } else {
      setStatus(WAITING_STATUS)
      startFallbackObservation()
      requestNextVideoFrame()
    }

    return () => {
      videoTrack.removeEventListener("ended", handleCaptureEnded)
      videoTrack.removeEventListener("mute", handleMuted)
      videoTrack.removeEventListener("unmute", handleUnmuted)
      video.removeEventListener("loadeddata", handleVideoFrame)
      active = false
      cancelFrameRequest()
      stopFallbackObservation()
    }
  }, [preview, session, videoElement])

  useLayoutEffect(() => {
    if (!prepareTurnRef) return
    const prepareTurn = (hasAttachedImages: boolean) => {
      if (!preview) return null
      if (hasAttachedImages) {
        setStatus(ATTACHMENT_CONFLICT_STATUS)
        throw new Error(ATTACHMENT_CONFLICT_STATUS)
      }
      const video = videoElement
      const currentSessionId = sessionId.current
      const [videoTrack] = preview.getVideoTracks()
      if (
        currentFrameIsUnavailable({
          video,
          videoTrack,
          currentSessionId,
          frameAvailable: currentFrameAvailable.current,
        })
      ) {
        const message =
          "The shared browser tab is not providing a current frame."
        setStatus(message)
        throw new Error(message)
      }
      const readyVideo = video as HTMLVideoElement
      const readySessionId = currentSessionId as string
      const nextRevision = revision.current + 1
      const packet = encodePreparedObservation({
        video: readyVideo,
        metadata: {
          session_id: readySessionId,
          source_epoch: sourceEpoch.current,
          revision: nextRevision,
          frame_presented_at_ms: framePresentedAtMs.current,
        },
        setStatus,
      })
      revision.current = nextRevision
      return packet
    }
    prepareTurnRef.current = prepareTurn
    return () => {
      if (prepareTurnRef.current === prepareTurn) prepareTurnRef.current = null
    }
  }, [prepareTurnRef, preview, videoElement])

  useEffect(() => {
    const previousThreadId = currentThreadId.current
    if (previousThreadId === activeThreadId) return
    currentThreadId.current = activeThreadId

    const isPendingNewThreadHandoff =
      previousThreadId === null &&
      activeThreadId !== null &&
      activeThreadId === handoffTargetThreadId &&
      captureOwnerThreadId.current === null
    if (isPendingNewThreadHandoff) {
      captureOwnerThreadId.current = activeThreadId
      onHandoffConsumed()
      return
    }

    startAttempt.current += 1
    session.stop()
    currentFrameAvailable.current = false
    captureOwnerThreadId.current = undefined
    sessionId.current = null
    setPreview(null)
    setIsPaused(false)
    setStatus("Browser tab disconnected because the chat changed.")
  }, [activeThreadId, handoffTargetThreadId, onHandoffConsumed, session])

  useEffect(() => () => session.stop(), [session])

  if (renderInComposer) return null
  return (
    <>
      <PromptForm onSubmit={() => true} observationSlot={composerView} />
      <ObservationComposerPreview {...composerView} />
    </>
  )
}
