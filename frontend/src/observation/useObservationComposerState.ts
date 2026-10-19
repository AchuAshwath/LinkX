import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import { useCallback, useMemo, useRef } from "react"
import type { ObservationComposerSlotProps } from "./ObservationComposerSlot"

interface ObservationSession {
  start: () => Promise<MediaStream>
  stop: () => void
}

interface ObservationComposerStateOptions {
  activeThreadId: string | null
  observationModelName?: string
  session: ObservationSession
  preview: MediaStream | null
  isPaused: boolean
  status: string
  currentFrameAvailable: MutableRefObject<boolean>
  startAttempt: MutableRefObject<number>
  sourceEpoch: MutableRefObject<number>
  revision: MutableRefObject<number>
  sessionId: MutableRefObject<string | null>
  framePresentedAtMs: MutableRefObject<number | null>
  captureOwnerThreadId: MutableRefObject<string | null | undefined>
  setPreview: Dispatch<SetStateAction<MediaStream | null>>
  setIsPaused: Dispatch<SetStateAction<boolean>>
  setStatus: Dispatch<SetStateAction<string>>
  videoRef: (element: HTMLVideoElement | null) => void
}

interface ComposerActions {
  startObservation: () => Promise<void>
  stopObservation: () => void
  resetContext: () => void
}

async function startBrowserTab(options: ObservationComposerStateOptions) {
  const {
    activeThreadId,
    session,
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
  } = options
  const attempt = ++startAttempt.current
  sourceEpoch.current += 1
  revision.current = 0
  sessionId.current = crypto.randomUUID()
  framePresentedAtMs.current = null
  currentFrameAvailable.current = false
  setIsPaused(false)
  captureOwnerThreadId.current = activeThreadId
  setStatus("Opening browser tab picker.")
  try {
    const activeStream = await session.start()
    if (attempt !== startAttempt.current) return
    setPreview(activeStream)
    setStatus("Waiting for the first frame from the shared browser tab.")
  } catch (error) {
    if (attempt !== startAttempt.current) return
    setStatus(
      error instanceof Error ? error.message : "Could not share that tab.",
    )
  }
}

function clearBrowserTab(
  options: ObservationComposerStateOptions,
  status: string,
) {
  const {
    session,
    currentFrameAvailable,
    startAttempt,
    sessionId,
    captureOwnerThreadId,
    setPreview,
    setIsPaused,
    setStatus,
  } = options
  startAttempt.current += 1
  session.stop()
  currentFrameAvailable.current = false
  setIsPaused(false)
  captureOwnerThreadId.current = undefined
  sessionId.current = null
  setPreview(null)
  setStatus(status)
}

function useComposerActions(
  options: ObservationComposerStateOptions,
): ComposerActions {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const startObservation = useCallback(
    () => startBrowserTab(optionsRef.current),
    [],
  )
  const stopObservation = useCallback(
    () => clearBrowserTab(optionsRef.current, "Browser tab disconnected."),
    [],
  )
  const resetContext = useCallback(
    () => clearBrowserTab(optionsRef.current, "Browser tab context reset."),
    [],
  )
  return useMemo(
    () => ({ startObservation, stopObservation, resetContext }),
    [startObservation, stopObservation, resetContext],
  )
}

type ComposerViewOptions = Pick<
  ObservationComposerStateOptions,
  | "preview"
  | "isPaused"
  | "status"
  | "currentFrameAvailable"
  | "observationModelName"
  | "videoRef"
>

function createComposerView(
  options: ComposerViewOptions,
  actions: ComposerActions,
): ObservationComposerSlotProps {
  const { preview, isPaused, status, currentFrameAvailable } = options
  return {
    view: {
      isConnected: Boolean(preview),
      hasCurrentFrame: Boolean(preview) && currentFrameAvailable.current,
      isPaused,
      status,
      modelName: options.observationModelName,
    },
    videoRef: options.videoRef,
    onStart: actions.startObservation,
    onStop: actions.stopObservation,
    onReset: actions.resetContext,
  }
}

export function useObservationComposerState(
  options: ObservationComposerStateOptions,
) {
  const actions = useComposerActions(options)
  const {
    preview,
    isPaused,
    status,
    currentFrameAvailable,
    observationModelName,
    videoRef,
  } = options
  const composerView = useMemo(
    () =>
      createComposerView(
        {
          preview,
          isPaused,
          status,
          currentFrameAvailable,
          observationModelName,
          videoRef,
        },
        actions,
      ),
    [
      preview,
      isPaused,
      status,
      observationModelName,
      videoRef,
      currentFrameAvailable,
      actions,
    ],
  )
  return { composerView }
}
