import { useMutation, useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import { PostsService } from "@/client"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import type { EditMode } from "./PostInputBox"
import type { usePostForm } from "./usePostForm"

export function useEditPostMutation(editMode: EditMode, onDone: () => void) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  return useMutation({
    mutationFn: async (data: {
      content: string
      platform: string
      scheduled_at?: string
      image_url?: string | null
    }) =>
      PostsService.updateExistingPost({
        postId: editMode.postId,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Post updated successfully")
      queryClient.invalidateQueries({ queryKey: ["posts"] })
      onDone()
    },
    onError: handleError.bind(showErrorToast),
  })
}

function useEditScheduledSync(
  editMode: EditMode | undefined,
  setScheduledAt: (date?: Date) => void,
) {
  React.useEffect(() => {
    if (editMode?.initialScheduledAt) {
      setScheduledAt(editMode.initialScheduledAt ?? undefined)
    }
  }, [editMode, setScheduledAt])
}

function useEditSubmissionCallback(
  editMutation: ReturnType<typeof useEditPostMutation>,
  form: ReturnType<typeof usePostForm>,
) {
  return React.useCallback(() => {
    editMutation.mutate({
      content: form.content.trim(),
      platform: form.channel,
      image_url: form.imageUrl,
      scheduled_at: form.scheduledAt?.toISOString(),
    })
  }, [
    editMutation,
    form.content,
    form.channel,
    form.imageUrl,
    form.scheduledAt,
  ])
}

export interface UseComposerSubmissionOptions {
  editMode?: EditMode
  form: ReturnType<typeof usePostForm>
}

export function useComposerSubmission({
  editMode,
  form,
}: UseComposerSubmissionOptions) {
  const onSaved = editMode?.onSaved
  const editMutation = useEditPostMutation(
    editMode ?? { postId: "" },
    onSaved ?? (() => {}),
  )

  useEditScheduledSync(editMode, form.setScheduledAt)
  const handleEditSubmit = useEditSubmissionCallback(editMutation, form)

  if (editMode) {
    return {
      isSuccess: editMutation.isSuccess,
      isSubmitting: editMutation.isPending || form.isUploadingMedia,
      onSubmitHandler: handleEditSubmit,
      onAiDraftHandler: undefined,
    }
  }

  return {
    isSuccess:
      form.createPostMutation.isSuccess || form.aiDraftMutation.isSuccess,
    isSubmitting:
      form.createPostMutation.isPending ||
      form.isUploadingMedia ||
      form.aiDraftMutation.isPending,
    onSubmitHandler: form.handleSubmit,
    onAiDraftHandler: form.handleAiDraft,
  }
}
