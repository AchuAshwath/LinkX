import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useCallback, useState } from "react"

import { PostsService } from "@/client"
import type { Platform } from "@/components/Common/PlatformSelector"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

export interface UsePostFormOptions {
  initialContent?: string
  initialImageUrl?: string | null
  initialPlatform?: Platform
}

export function usePostForm(options?: UsePostFormOptions) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [content, setContent] = useState(options?.initialContent || "")
  const [scheduledAt, setScheduledAt] = useState<Date | undefined>()
  const [channel, setChannel] = useState<Platform>(
    options?.initialPlatform || "linkx",
  )
  const [actionType, setActionType] = useState<"draft" | "schedule" | "post">(
    "post",
  )
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(
    options?.initialImageUrl || null,
  )
  const [isUploadingMedia, setIsUploadingMedia] = useState(false)

  const removeMedia = useCallback(() => {
    setMediaFile(null)
    setImageUrl(null)
    setIsUploadingMedia(false)
  }, [])

  const uploadMedia = useCallback(
    async (file: File): Promise<string | null> => {
      const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"]
      if (!validTypes.includes(file.type)) {
        showErrorToast(
          "Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image.",
        )
        return null
      }

      // Max size: 5MB
      if (file.size > 5 * 1024 * 1024) {
        showErrorToast("Image size exceeds the 5 MB limit.")
        return null
      }

      setMediaFile(file)
      setIsUploadingMedia(true)

      const localPreviewUrl = URL.createObjectURL(file)
      setImageUrl(localPreviewUrl)

      try {
        const res = await PostsService.uploadMedia({ formData: { file } })
        const uploadedUrl = res.url || localPreviewUrl
        setImageUrl(uploadedUrl)
        return uploadedUrl
      } catch (err) {
        handleError.bind(showErrorToast)(err as any)
        return localPreviewUrl
      } finally {
        setIsUploadingMedia(false)
      }
    },
    [showErrorToast],
  )

  const createPostMutation = useMutation({
    mutationFn: async (data: {
      content: string
      platform: string
      scheduled_at?: string
      status: string
      image_url?: string | null
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
      removeMedia()
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
        image_url?: string | null
      } = {
        content: content.trim(),
        platform: channel,
        status:
          action === "draft"
            ? "draft"
            : action === "schedule"
              ? "scheduled"
              : "published",
        image_url: imageUrl || undefined,
      }

      if (action === "schedule" && finalScheduledAt) {
        postData.scheduled_at = finalScheduledAt.toISOString()
      }

      createPostMutation.mutate(postData)
    },
    [channel, content, createPostMutation, imageUrl, scheduledAt],
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
    mediaFile,
    imageUrl,
    setImageUrl,
    isUploadingMedia,
    uploadMedia,
    removeMedia,
    handleSubmit,
    handleContentChange,
    createPostMutation,
  }
}
