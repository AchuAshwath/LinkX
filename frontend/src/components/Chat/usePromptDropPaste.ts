import * as React from "react"

function extractFilesFromItems(
  items: DataTransferItemList | DataTransferItem[],
): File[] {
  const files: File[] = []
  for (const item of Array.from(items)) {
    if (!item?.type?.startsWith("image/")) continue
    try {
      const file = item.getAsFile()
      if (file) files.push(file)
    } catch {
      // ignore file extraction error
    }
  }
  return files
}

function extractFilesFromList(fileList: FileList | File[]): File[] {
  const result: File[] = []
  for (const file of Array.from(fileList)) {
    if (file?.type?.startsWith("image/")) {
      result.push(file)
    }
  }
  return result
}

function extractClipboardImages(e: React.ClipboardEvent): File[] {
  const items = e.clipboardData?.items
  if (items && items.length > 0) {
    const files = extractFilesFromItems(items)
    if (files.length > 0) return files
  }

  const files = e.clipboardData?.files
  if (files && files.length > 0) {
    return extractFilesFromList(files)
  }

  return []
}

function extractDropImages(e: React.DragEvent): File[] {
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return []
  return extractFilesFromList(files)
}

function isChildTarget(
  current: EventTarget | null,
  related: EventTarget | null,
): boolean {
  if (!related || !current) return false
  if (!("contains" in current)) return false
  return (current as HTMLElement).contains(related as Node)
}

export function usePromptDropPaste({
  addFiles,
}: {
  addFiles: (files: FileList | File[] | null | undefined) => void
}) {
  const [isDragging, setIsDragging] = React.useState(false)

  const handlePaste = React.useCallback(
    (e: React.ClipboardEvent) => {
      const images = extractClipboardImages(e)
      if (images.length > 0) {
        e.preventDefault()
        e.stopPropagation()
        addFiles(images)
      }
    },
    [addFiles],
  )

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const current = (e.currentTarget || e.target) as Node | null
    if (isChildTarget(current, e.relatedTarget)) {
      return
    }
    setIsDragging(false)
  }, [])

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      const images = extractDropImages(e)
      if (images.length > 0) {
        addFiles(images)
      }
    },
    [addFiles],
  )

  return {
    isDragging,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}
