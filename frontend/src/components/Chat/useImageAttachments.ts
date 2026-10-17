import * as React from "react"
import type { AttachmentImage } from "@/components/Chat/AttachmentPreviewStrip"

export const MAX_IMAGE_COUNT = 5
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

function isValidImageFile(file: File): boolean {
  if (!file?.type) return false
  if (!file.type.startsWith("image/")) return false
  return file.size <= MAX_IMAGE_SIZE_BYTES
}

function toFileList(files: FileList | File[] | null | undefined): File[] {
  if (!files) return []
  return Array.isArray(files) ? files : Array.from(files)
}

function filterValidImageFiles(
  files: FileList | File[] | null | undefined,
): File[] {
  return toFileList(files).filter(isValidImageFile)
}

function revokePreviews(images: AttachmentImage[]): void {
  for (const img of images) {
    if (img.preview) {
      URL.revokeObjectURL(img.preview)
    }
  }
}

function appendValidFiles(
  prev: AttachmentImage[],
  validFiles: File[],
): AttachmentImage[] {
  const availableSlots = Math.max(0, MAX_IMAGE_COUNT - prev.length)
  if (availableSlots <= 0) return prev
  const allowedFiles = validFiles.slice(0, availableSlots)
  if (allowedFiles.length === 0) return prev
  const newImages = allowedFiles.map((file) => ({
    file,
    preview: URL.createObjectURL(file),
  }))
  return [...prev, ...newImages]
}

function removeImageAtIndex(
  prev: AttachmentImage[],
  index: number,
): AttachmentImage[] {
  const target = prev[index]
  if (target?.preview) {
    URL.revokeObjectURL(target.preview)
  }
  return prev.filter((_, i) => i !== index)
}

export function useImageAttachments() {
  const [selectedImages, setSelectedImages] = React.useState<AttachmentImage[]>(
    [],
  )
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const addFiles = React.useCallback(
    (files: FileList | File[] | null | undefined) => {
      const validFiles = filterValidImageFiles(files)
      if (validFiles.length === 0) return
      setSelectedImages((prev) => appendValidFiles(prev, validFiles))
    },
    [],
  )

  const handleImageSelect = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      addFiles(e.target.files)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    },
    [addFiles],
  )

  const handleRemoveImage = React.useCallback((index: number) => {
    setSelectedImages((prev) => removeImageAtIndex(prev, index))
  }, [])

  const clearImages = React.useCallback(() => {
    setSelectedImages((prev) => {
      revokePreviews(prev)
      return []
    })
  }, [])

  React.useEffect(() => {
    return () => {
      setSelectedImages((prev) => {
        revokePreviews(prev)
        return []
      })
    }
  }, [])

  return {
    selectedImages,
    fileInputRef,
    handleImageSelect,
    handleRemoveImage,
    clearImages,
    addFiles,
  }
}
