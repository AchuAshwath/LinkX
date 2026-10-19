import type { RefObject } from "react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  type FloatingPreviewPosition,
  measureCurrentSidebarPosition,
  measureSidebarPreview,
  observePreviewLayout,
  observeSidebarLayout,
  samePosition,
} from "./floatingPreviewGeometry"
import {
  type FloatingPreviewDragHandlers,
  useDragState,
  useKeyboardMoveHandler,
  usePointerDragHandlers,
} from "./useFloatingPreviewDrag"

export { measureSidebarPreview }
export type { FloatingPreviewPosition }
export type { FloatingPreviewDragHandlers }

interface FloatingPreviewPositionOptions {
  active: boolean
  previewRef: RefObject<HTMLElement | null>
}

function useMeasuredPreviewPosition(
  active: boolean,
  previewRef: RefObject<HTMLElement | null>,
) {
  const [position, setPosition] = useState<FloatingPreviewPosition | null>(null)
  useLayoutEffect(() => {
    if (!active) {
      setPosition(null)
      return
    }
    const preview = previewRef.current
    if (!preview) return
    const updatePosition = createPositionUpdater(preview, setPosition)
    updatePosition()
    const stopObservingSidebar = observeSidebarLayout(updatePosition)
    const stopObservingPreview = observePreviewLayout(preview, updatePosition)
    return () => {
      stopObservingSidebar()
      stopObservingPreview()
    }
  }, [active, previewRef])
  return position
}

function createPositionUpdater(
  preview: HTMLElement,
  setPosition: React.Dispatch<
    React.SetStateAction<FloatingPreviewPosition | null>
  >,
) {
  return () => {
    const next = measureCurrentSidebarPosition(preview)
    setPosition((current) =>
      next && samePosition(current, next) ? current : next,
    )
  }
}

export function useFloatingPreviewPosition({
  active,
  previewRef,
}: FloatingPreviewPositionOptions) {
  const defaultPosition = useMeasuredPreviewPosition(active, previewRef)
  const { dragPosition, setDragPosition, reclamp } = useDragState(active)
  useLayoutEffect(() => {
    if (!defaultPosition) setDragPosition(null)
  }, [defaultPosition, setDragPosition])
  const position = defaultPosition
    ? { ...defaultPosition, ...dragPosition }
    : null
  const latestPosition = useRef(position)
  latestPosition.current = position
  useEffect(() => {
    const reclampOnResize = () => {
      if (latestPosition.current) reclamp(latestPosition.current)
    }
    window.addEventListener("resize", reclampOnResize)
    return () => window.removeEventListener("resize", reclampOnResize)
  }, [reclamp])
  useLayoutEffect(() => {
    if (defaultPosition) reclamp(defaultPosition)
  }, [defaultPosition, reclamp])
  const pointerHandlers = usePointerDragHandlers(
    active,
    position,
    setDragPosition,
  )
  const onKeyDown = useKeyboardMoveHandler(position, setDragPosition)
  const dragHandlers: FloatingPreviewDragHandlers = {
    ...pointerHandlers,
    onKeyDown,
  }
  return { position, dragHandlers }
}
