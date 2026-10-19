import type {
  Dispatch,
  KeyboardEventHandler,
  PointerEventHandler,
  SetStateAction,
} from "react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { clamp, type FloatingPreviewPosition } from "./floatingPreviewGeometry"

interface DragPosition {
  left: number
  top: number
}

interface PointerOrigin extends DragPosition {
  pointerId: number
  clientX: number
  clientY: number
}

interface DragState {
  dragPosition: DragPosition | null
  setDragPosition: Dispatch<SetStateAction<DragPosition | null>>
  reclamp: (position: FloatingPreviewPosition) => void
}

export interface FloatingPreviewDragHandlers {
  onPointerDown: PointerEventHandler<HTMLElement>
  onPointerMove: PointerEventHandler<HTMLElement>
  onPointerUp: PointerEventHandler<HTMLElement>
  onPointerCancel: PointerEventHandler<HTMLElement>
  onKeyDown: KeyboardEventHandler<HTMLElement>
}

function clampDragPosition(
  next: DragPosition,
  position: FloatingPreviewPosition,
): DragPosition {
  return {
    left: clamp(next.left, 16, window.innerWidth - position.width - 16),
    top: clamp(next.top, 16, window.innerHeight - position.height - 16),
  }
}

function isStopControl(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("button"))
}

export function useDragState(active: boolean): DragState {
  const [dragPosition, setDragPosition] = useState<DragPosition | null>(null)
  const wasActive = useRef(false)
  useLayoutEffect(() => {
    if (!active || !wasActive.current) setDragPosition(null)
    wasActive.current = active
  }, [active])
  const reclamp = useCallback((position: FloatingPreviewPosition) => {
    setDragPosition((current) =>
      current ? clampDragPosition(current, position) : current,
    )
  }, [])
  return { dragPosition, setDragPosition, reclamp }
}

export function usePointerDragHandlers(
  active: boolean,
  position: FloatingPreviewPosition | null,
  setDragPosition: DragState["setDragPosition"],
) {
  const pointerOrigin = useRef<PointerOrigin | null>(null)
  useEffect(() => {
    if (!active) pointerOrigin.current = null
  }, [active])
  const onPointerDown = useCallback<PointerEventHandler<HTMLElement>>(
    (event) => {
      if (
        !active ||
        !position ||
        event.button !== 0 ||
        isStopControl(event.target)
      ) {
        return
      }
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      pointerOrigin.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        left: position.left,
        top: position.top,
      }
    },
    [active, position],
  )
  const onPointerMove = useCallback<PointerEventHandler<HTMLElement>>(
    (event) => {
      const origin = pointerOrigin.current
      if (!origin || origin.pointerId !== event.pointerId || !position) return
      setDragPosition(
        clampDragPosition(
          {
            left: origin.left + event.clientX - origin.clientX,
            top: origin.top + event.clientY - origin.clientY,
          },
          position,
        ),
      )
    },
    [position, setDragPosition],
  )
  const finishDrag = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    if (pointerOrigin.current?.pointerId !== event.pointerId) return
    pointerOrigin.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])
  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
  }
}

function getKeyboardDelta(key: string, shifted: boolean): DragPosition | null {
  const amount = shifted ? 40 : 10
  if (key === "ArrowLeft") return { left: -amount, top: 0 }
  if (key === "ArrowRight") return { left: amount, top: 0 }
  if (key === "ArrowUp") return { left: 0, top: -amount }
  if (key === "ArrowDown") return { left: 0, top: amount }
  return null
}

export function useKeyboardMoveHandler(
  position: FloatingPreviewPosition | null,
  setDragPosition: DragState["setDragPosition"],
) {
  return useCallback<KeyboardEventHandler<HTMLElement>>(
    (event) => {
      if (!position || isStopControl(event.target)) return
      const delta = getKeyboardDelta(event.key, event.shiftKey)
      if (!delta) return
      event.preventDefault()
      setDragPosition(
        clampDragPosition(
          { left: position.left + delta.left, top: position.top + delta.top },
          position,
        ),
      )
    },
    [position, setDragPosition],
  )
}
