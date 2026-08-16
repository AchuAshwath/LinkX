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

export interface UseComposerSubmissionOptions {
  editMode?: EditMode
  form: ReturnType<typeof usePostForm>
}

export function useComposerSubmission({
  editMode,
  form,
}: UseComposerSubmissionOptions) {
  const editMutation = useEditPostMutation(editMode ?? { postId: "" }, () => {
    editMode?.onSaved?.()
  })

  React.useEffect(() => {
    if (editMode?.initialScheduledAt) {
      form.setScheduledAt(editMode.initialScheduledAt ?? undefined)
    }
  }, [editMode, form.setScheduledAt])

  const handleEditSubmit = React.useCallback(() => {
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

  const isSuccess = Boolean(
    editMode ? editMutation.isSuccess : form.createPostMutation.isSuccess,
  )
  const isPending = Boolean(
    editMode ? editMutation.isPending : form.createPostMutation.isPending,
  )
  const isSubmitting = isPending || form.isUploadingMedia

  return {
    isSuccess,
    isSubmitting,
    onSubmitHandler: editMode ? handleEditSubmit : form.handleSubmit,
    onAiDraftHandler: editMode ? undefined : form.handleAiDraft,
  }
}
