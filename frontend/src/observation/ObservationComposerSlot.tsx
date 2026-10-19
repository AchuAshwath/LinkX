// biome-ignore-all lint/a11y/noNoninteractiveTabindex: This region receives focus so arrow keys can move the preview.
import { X } from "lucide-react"
import type { CSSProperties, RefCallback, RefObject } from "react"
import { cn } from "@/lib/utils"
import type { FloatingPreviewDragHandlers } from "./useFloatingPreviewPosition"

export interface ObservationComposerView {
  isConnected: boolean
  hasCurrentFrame: boolean
  isPaused?: boolean
  status: string
  modelName?: string
}

export interface ObservationComposerSlotProps {
  view: ObservationComposerView
  videoRef: RefCallback<HTMLVideoElement>
  onStart: () => void
  onStop: () => void
  onReset: () => void
  addContextButtonRef?: RefObject<HTMLButtonElement | null>
}

export function ObservationComposerSlot({
  view,
}: ObservationComposerSlotProps) {
  return <StatusAnnouncement status={view.status} />
}

function StatusAnnouncement({ status }: { status: string }) {
  return (
    <output aria-live="polite" className="sr-only">
      {status}
    </output>
  )
}

export function ObservationComposerPreview({
  view,
  videoRef,
  onStop,
  addContextButtonRef,
  previewRef,
  style,
  className,
  dragHandlers,
}: ObservationComposerSlotProps & {
  className?: string
  dragHandlers?: FloatingPreviewDragHandlers
  previewRef?: RefObject<HTMLElement | null>
  style?: CSSProperties
}) {
  if (!view.isConnected) return null

  return (
    <section
      id="browser-observation-preview"
      aria-label="Shared browser tab preview"
      tabIndex={0}
      ref={previewRef}
      style={style}
      aria-describedby="browser-preview-move-help"
      {...dragHandlers}
      className={cn(
        "group relative aspect-video overflow-hidden rounded-2xl bg-[#090d14] shadow-2xl ring-1 ring-inset ring-slate-700/80 cursor-grab active:cursor-grabbing touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
        className,
      )}
    >
      <span id="browser-preview-move-help" className="sr-only">
        Drag to move. Focus this preview and use the arrow keys to reposition.
      </span>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-label="Preview of shared browser tab"
        className="absolute inset-0 size-full rounded-2xl object-contain object-center"
      />
      <button
        type="button"
        aria-label="Stop sharing browser tab"
        onClick={() => handleDisconnect({ onStop, addContextButtonRef })}
        className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full bg-black/70 text-white opacity-0 shadow-md backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-black/90 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
      >
        <X className="size-3.5" />
      </button>
    </section>
  )
}

function handleDisconnect({
  onStop,
  addContextButtonRef,
}: {
  onStop: () => void
  addContextButtonRef?: RefObject<HTMLButtonElement | null>
}) {
  addContextButtonRef?.current?.focus()
  onStop()
}
