import { X } from "lucide-react"

export interface AttachmentImage {
  file: File
  preview: string
}

export function AttachmentPreviewStrip({
  images,
  onRemove,
}: {
  images: AttachmentImage[]
  onRemove: (index: number) => void
}) {
  if (images.length === 0) return null

  return (
    <div className="flex items-center gap-2 px-3 pt-2.5 overflow-x-auto scrollbar-none">
      {images.map((img, idx) => (
        <div
          key={idx}
          className="group relative size-14 shrink-0 rounded-xl overflow-hidden border border-border bg-muted/40"
        >
          <img
            src={img.preview}
            alt="Attachment preview"
            className="size-full object-cover"
          />
          <button
            type="button"
            onClick={() => onRemove(idx)}
            aria-label="Remove image"
            className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-background/80 text-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors cursor-pointer"
          >
            <X className="size-2.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
