import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useCallback, useState } from "react"

import { PostsService } from "@/client"
import type { Platform } from "@/components/Common/PlatformSelector"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

export function usePostForm() {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [content, setContent] = useState("")
  const [scheduledAt, setScheduledAt] = useState<Date | undefined>()
  const [channel, setChannel] = useState<Platform>("linkx")
  const [actionType, setActionType] = useState<"draft" | "schedule" | "post">(
    "post",
  )

  const createPostMutation = useMutation({
    mutationFn: async (data: {
      content: string
      platform: string
      scheduled_at?: string
      status: string
    }) => {
      return await PostsService.createNewPost({ requestBody: data })
    },
    onSuccess: (_, variables) => {
      const statusMessages = {
        draft: "Draft saved successfully",
        scheduled: "Post scheduled successfully",
        published: "Post published successfully",
      }
      showSuccessToast(
        statusMessages[variables.status as keyof typeof statusMessages] ||
          "Post created successfully",
      )
      // Reset form
      setContent("")
      setScheduledAt(undefined)
      setChannel("linkx")
      setActionType("post")
      // Invalidate queries to refetch posts
      queryClient.invalidateQueries({ queryKey: ["posts"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  const handleSubmit = useCallback(
    (action: "draft" | "schedule" | "post") => {
      if (content.trim().length === 0) return

      const finalScheduledAt =
        action === "schedule"
          ? scheduledAt || new Date(Date.now() + 4 * 3600 * 1000)
          : undefined

      const postData: {
        content: string
        platform: string
        scheduled_at?: string
        status: string
      } = {
        content: content.trim(),
        platform: channel,
        status:
          action === "draft"
            ? "draft"
            : action === "schedule"
              ? "scheduled"
              : "published",
      }

      if (action === "schedule" && finalScheduledAt) {
        postData.scheduled_at = finalScheduledAt.toISOString()
      }

      createPostMutation.mutate(postData)
    },
    [channel, content, createPostMutation, scheduledAt],
  )

  const handleContentChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(event.target.value)
    },
    [],
  )

  return {
    content,
    setContent,
    scheduledAt,
    setScheduledAt,
    channel,
    setChannel,
    actionType,
    setActionType,
    handleSubmit,
    handleContentChange,
    createPostMutation,
  }
}
