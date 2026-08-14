import { X } from "lucide-react"
import type { Platform } from "@/components/Common/PlatformSelector"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import {
  LinkedInPostPreview,
  type PreviewPostData,
} from "./LinkedInPostPreview"
import { XPostPreview } from "./XPostPreview"

interface PostPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  post: PreviewPostData | null
  platform: Platform
}

export function PostPreviewDialog({
  open,
  onOpenChange,
  post,
  platform,
}: PostPreviewDialogProps) {
  if (!post) return null

  const showLinkedIn = platform === "linkedin" || platform === "linkx"
  const showX = platform === "x" || platform === "linkx"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/40 backdrop-blur-md"
        className="sm:max-w-3xl max-h-[85vh] overflow-y-auto scrollbar-thin p-0 gap-0 border-0 bg-transparent shadow-none"
      >
        {/* Floating close button */}
        <DialogClose asChild>
          <button
            type="button"
            aria-label="Close preview"
            className="fixed top-4 right-4 z-[60] inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white shadow-lg ring-1 ring-white/15 backdrop-blur-md transition hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <X className="h-5 w-5" />
          </button>
        </DialogClose>

        <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
          {showLinkedIn && (
            <div className="w-full">
              <LinkedInPostPreview post={post} />
            </div>
          )}
          {showX && (
            <div className="w-full">
              <XPostPreview post={post} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
