export interface FloatingPreviewPosition {
  left: number
  top: number
  width: number
  height: number
}

export interface RailPreviewGeometry {
  rail: DOMRect
  start: DOMRect
  profile: DOMRect
  viewportWidth: number
  viewportHeight: number
  aspectRatio?: number
}

const MIN_PREVIEW_HEIGHT = 48
const MIN_PREVIEW_WIDTH = 48
const DEFAULT_PREVIEW_ASPECT_RATIO = 16 / 9

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(value, maximum))
}

export function measureSidebarPreview({
  rail,
  start,
  profile,
  viewportWidth,
  viewportHeight,
  aspectRatio = DEFAULT_PREVIEW_ASPECT_RATIO,
}: RailPreviewGeometry): FloatingPreviewPosition | null {
  const maxWidth = Math.max(
    0,
    Math.min(250, rail.width - 32, viewportWidth - 32),
  )
  const availableHeight = Math.max(
    0,
    Math.min(profile.top - start.bottom - 32, viewportHeight - 32),
  )
  if (availableHeight === 0 || maxWidth === 0) return null

  const safeAspectRatio = resolveAspectRatio(aspectRatio)
  const width = Math.min(maxWidth, availableHeight * safeAspectRatio)
  const height = width / safeAspectRatio
  if (height < MIN_PREVIEW_HEIGHT || width < MIN_PREVIEW_WIDTH) return null

  const topMin = start.bottom + 16
  const topMax = profile.top - height - 16
  const centeredTop = topMin + Math.max(0, topMax - topMin) / 2
  return {
    left: clamp(
      rail.left + (rail.width - width) / 2,
      16,
      viewportWidth - width - 16,
    ),
    top: clamp(centeredTop, 16, Math.max(16, viewportHeight - height - 16)),
    width,
    height,
  }
}

function resolveAspectRatio(aspectRatio: number) {
  if (Number.isFinite(aspectRatio) && aspectRatio > 0) return aspectRatio
  return DEFAULT_PREVIEW_ASPECT_RATIO
}

function getRailElements() {
  return {
    rail: document.querySelector<HTMLElement>("[data-browser-preview-rail]"),
    start: document.querySelector<HTMLElement>("[data-browser-preview-start]"),
    profile: document.querySelector<HTMLElement>("[data-browser-preview-end]"),
  }
}

function getPreviewAspectRatio(preview: HTMLElement) {
  const video = preview.querySelector("video")
  if (!video) return DEFAULT_PREVIEW_ASPECT_RATIO
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    return DEFAULT_PREVIEW_ASPECT_RATIO
  }
  return video.videoWidth / video.videoHeight
}

export function measureCurrentSidebarPosition(
  preview: HTMLElement,
): FloatingPreviewPosition | null {
  const { rail, start, profile } = getRailElements()
  if (!rail || !start || !profile) return null
  return measureSidebarPreview({
    rail: rail.getBoundingClientRect(),
    start: start.getBoundingClientRect(),
    profile: profile.getBoundingClientRect(),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    aspectRatio: getPreviewAspectRatio(preview),
  })
}

export function samePosition(
  current: FloatingPreviewPosition | null,
  next: FloatingPreviewPosition,
) {
  return Boolean(
    current &&
      current.left === next.left &&
      current.top === next.top &&
      current.width === next.width &&
      current.height === next.height,
  )
}

export function observeSidebarLayout(updatePosition: () => void) {
  const { rail, start, profile } = getRailElements()
  if (!rail || !start || !profile) return () => {}
  const observer = createResizeObserver(updatePosition)
  for (const element of [rail, start, profile]) observer?.observe(element)
  window.addEventListener("resize", updatePosition)
  window.addEventListener("scroll", updatePosition, true)
  return () => {
    observer?.disconnect()
    window.removeEventListener("resize", updatePosition)
    window.removeEventListener("scroll", updatePosition, true)
  }
}

export function observePreviewLayout(
  preview: HTMLElement,
  updatePosition: () => void,
) {
  const video = preview.querySelector("video")
  const observer = createResizeObserver(updatePosition)
  observer?.observe(preview)
  video?.addEventListener("loadedmetadata", updatePosition)
  video?.addEventListener("resize", updatePosition)
  return () => {
    observer?.disconnect()
    video?.removeEventListener("loadedmetadata", updatePosition)
    video?.removeEventListener("resize", updatePosition)
  }
}

function createResizeObserver(callback: () => void) {
  return typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver(callback)
}
