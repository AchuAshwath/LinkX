import * as React from "react"
import type { AttachmentImage } from "@/components/Chat/AttachmentPreviewStrip"

export const MAX_IMAGE_COUNT = 5
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

function filterValidImageFiles(files: FileList | null): File[] {
  if (!files || files.length === 0) return []
  const valid: File[] = []
  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/")) continue
    if (file.size > MAX_IMAGE_SIZE_BYTES) continue
    valid.push(file)
  }
  return valid
}

function revokePreviews(images: AttachmentImage[]): void {
  for (const img of images) {
    if (img.preview) {
      URL.revokeObjectURL(img.preview)
    }
  }
}

export function useImageAttachments() {
  const [selectedImages, setSelectedImages] = React.useState<AttachmentImage[]>(
    [],
  )
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const handleImageSelect = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const validFiles = filterValidImageFiles(e.target.files)
      if (validFiles.length === 0) return

      setSelectedImages((prev) => {
        const availableSlots = Math.max(0, MAX_IMAGE_COUNT - prev.length)
        const allowedFiles = validFiles.slice(0, availableSlots)
        const newImages = allowedFiles.map((file) => ({
          file,
          preview: URL.createObjectURL(file),
        }))
        return [...prev, ...newImages]
      })

      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    },
    [],
  )

  const handleRemoveImage = React.useCallback((index: number) => {
    setSelectedImages((prev) => {
      const target = prev[index]
      if (target?.preview) {
        URL.revokeObjectURL(target.preview)
      }
      return prev.filter((_, i) => i !== index)
    })
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
  }
}
