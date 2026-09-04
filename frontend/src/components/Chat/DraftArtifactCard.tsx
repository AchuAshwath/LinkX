import { useMutation, useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import { PostsService } from "@/client"
import type { DraftArtifact } from "@/components/Chat/types"
import type { Platform } from "@/components/Common/PlatformSelector"
import { DraftPost, type DraftPostData } from "@/components/Post/DraftPost"
import { PostPreviewDialog } from "@/components/Post/Previews"
import type { PreviewPostData } from "@/components/Post/Previews/LinkedInPostPreview"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"

export interface DraftArtifactCardProps {
  artifact: DraftArtifact
  author?: { name: string; username: string; avatarUrl?: string | null }
  onSchedule?: (artifact: DraftArtifact) => void
  onSendToComposer?: (artifact: DraftArtifact) => void
  onPublish?: (artifact: DraftArtifact) => void
  onDelete?: (artifact: DraftArtifact) => void
  onPreview?: (artifact: DraftArtifact) => void
  className?: string
}

export function DraftArtifactCard({
  artifact,
  author,
  onSchedule: _onSchedule,
  onSendToComposer,
  onPublish,
  onDelete,
  onPreview,
  className,
}: DraftArtifactCardProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [previewOpen, setPreviewOpen] = React.useState(false)

  const [currentPlatform, setCurrentPlatform] = React.useState<Platform>(
    (artifact.platform === "all"
      ? "linkx"
      : artifact.platform || "linkx") as Platform,
  )

  React.useEffect(() => {
    if (artifact.platform) {
      setCurrentPlatform(
        (artifact.platform === "all" ? "linkx" : artifact.platform) as Platform,
      )
    }
  }, [artifact.platform])

  const postAuthor = React.useMemo(() => {
    if (author) return author
    const name =
      user?.full_name || (user?.email ? user.email.split("@")[0] : "Ashwath N")
    const username = user?.email ? user.email.split("@")[0] : "admin"
    return {
      name,
      username,
    }
  }, [author, user])

  const publishMutation = useMutation({
    mutationFn: async (postId: string) =>
      PostsService.publishExistingPost({ postId }),
    onSuccess: () => {
      showSuccessToast("Post published successfully!")
      queryClient.invalidateQueries({ queryKey: ["posts"] })
    },
    onError: () => {
      showErrorToast("Failed to publish post")
    },
  })

  const handlePublish = React.useCallback(
    (postId: string) => {
      if (onPublish) {
        onPublish(artifact)
      } else if (postId && postId !== "draft-artifact") {
        publishMutation.mutate(postId)
      }
    },
    [artifact, onPublish, publishMutation],
  )

  const handlePreview = React.useCallback(
    (_postId?: string) => {
      setPreviewOpen(true)
      onPreview?.(artifact)
    },
    [artifact, onPreview],
  )

  const handleEdit = React.useCallback(
    (_postId: string) => {
      onSendToComposer?.(artifact)
    },
    [artifact, onSendToComposer],
  )

  const handleDelete = React.useCallback(
    (_postId: string) => {
      onDelete?.(artifact)
    },
    [artifact, onDelete],
  )

  const postData: DraftPostData = React.useMemo(() => {
    return {
      id: artifact.id || artifact.postId || "draft-artifact",
      author: postAuthor,
      content: artifact.content,
      createdAt: new Date().toISOString(),
      platform: currentPlatform,
      status: "draft",
      type: "draft",
    }
  }, [artifact, postAuthor, currentPlatform])

  const previewData: PreviewPostData = React.useMemo(() => {
    return {
      id: postData.id,
      author: {
        name: postData.author.name,
        username: postData.author.username,
        avatarUrl: postData.author.avatarUrl ?? undefined,
      },
      content: postData.content,
      imageUrl: postData.imageUrl ?? undefined,
      createdAt: postData.createdAt,
      likes: postData.likes,
      reposts: postData.reposts,
      comments: postData.comments,
    }
  }, [postData])

  return (
    <div className={cn("w-full", className)}>
      <DraftPost
        post={postData}
        onPlatformChange={(_, p) => setCurrentPlatform(p)}
        onPublish={handlePublish}
        onPreview={handlePreview}
        onEdit={onSendToComposer ? handleEdit : undefined}
        onDelete={onDelete ? handleDelete : undefined}
        isPublishing={publishMutation.isPending}
      />
      <PostPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        post={previewData}
        platform={currentPlatform}
      />
    </div>
  )
}
