import { Loader2, X } from "lucide-react"
import { resolveMediaUrl } from "@/utils"

export interface MediaThumbnailProps {
  imageUrl: string
  isUploading: boolean
  onRemove: () => void
}

export function MediaThumbnail({
  imageUrl,
  isUploading,
  onRemove,
}: MediaThumbnailProps) {
  return (
    <div
      className="relative mt-3 group overflow-hidden rounded-xl border border-border/60 bg-muted/20 max-w-md"
      data-testid="post-media-preview"
    >
      <img
        src={resolveMediaUrl(imageUrl) ?? imageUrl}
        alt="Post attachment"
        className="w-full max-h-52 object-cover rounded-xl"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove image"
        className="absolute top-2.5 right-2.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white shadow-md backdrop-blur-xs transition-all hover:bg-black hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-white/50 cursor-pointer"
        data-testid="remove-media-btn"
      >
        <X className="h-4 w-4" />
      </button>
      {isUploading && (
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-[1px] rounded-xl flex items-center justify-center text-white"
          data-testid="media-uploading-spinner"
        >
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        </div>
      )}
    </div>
  )
}
