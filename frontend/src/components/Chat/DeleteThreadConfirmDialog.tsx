import type { ChatThreadPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function DeleteThreadConfirmDialog({
  thread,
  isOpen,
  isPending,
  onClose,
  onConfirm,
}: {
  thread: ChatThreadPublic | null
  isOpen: boolean
  isPending: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Chat?</DialogTitle>
          <DialogDescription>
            This will permanently delete{" "}
            <span className="font-semibold text-foreground">
              &quot;{thread?.title}&quot;
            </span>{" "}
            and its entire conversation history from your workspace. This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4 gap-2.5 sm:gap-2.5">
          <DialogClose asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={onClose}
              className="cursor-pointer"
            >
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={isPending}
            onClick={onConfirm}
            className="font-semibold cursor-pointer"
          >
            {isPending ? "Deleting…" : "Delete Chat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
