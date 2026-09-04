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

function resolveInitialPlatform(platform?: string): Platform {
  if (!platform || platform === "all") return "linkx"
  return platform as Platform
}

function resolvePostAuthor(
  author?: { name: string; username: string; avatarUrl?: string | null },
  user?: { full_name?: string | null; email?: string | null } | null,
) {
  if (author) return author
  const emailPrefix = user?.email ? user.email.split("@")[0] : ""
  const name = user?.full_name || emailPrefix || "Ashwath N"
  const username = emailPrefix || "admin"
  return { name, username }
}

function createDraftPostData({
  artifact,
  author,
  platform,
}: {
  artifact: DraftArtifact
  author: { name: string; username: string; avatarUrl?: string | null }
  platform: Platform
}): DraftPostData {
  return {
    id: artifact.id || artifact.postId || "draft-artifact",
    author,
    content: artifact.content,
    createdAt: new Date().toISOString(),
    platform,
    status: "draft",
    type: "draft",
  }
}

function createPreviewPostData(post: DraftPostData): PreviewPostData {
  return {
    id: post.id,
    author: {
      name: post.author.name,
      username: post.author.username,
      avatarUrl: post.author.avatarUrl ?? undefined,
    },
    content: post.content,
    imageUrl: post.imageUrl ?? undefined,
    createdAt: post.createdAt,
    likes: post.likes,
    reposts: post.reposts,
    comments: post.comments,
  }
}

function usePublishPostMutation() {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  return useMutation({
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
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [currentPlatform, setCurrentPlatform] = React.useState<Platform>(() =>
    resolveInitialPlatform(artifact.platform),
  )

  React.useEffect(() => {
    if (artifact.platform) {
      setCurrentPlatform(resolveInitialPlatform(artifact.platform))
    }
  }, [artifact.platform])

  const postAuthor = React.useMemo(
    () => resolvePostAuthor(author, user),
    [author, user],
  )

  const publishMutation = usePublishPostMutation()

  const handlePublish = React.useCallback(
    (postId: string) => {
      if (onPublish) {
        onPublish(artifact)
        return
      }
      if (postId && postId !== "draft-artifact") {
        publishMutation.mutate(postId)
      }
    },
    [artifact, onPublish, publishMutation],
  )

  const handlePreview = React.useCallback(() => {
    setPreviewOpen(true)
    onPreview?.(artifact)
  }, [artifact, onPreview])

  const postData = React.useMemo(
    () =>
      createDraftPostData({
        artifact,
        author: postAuthor,
        platform: currentPlatform,
      }),
    [artifact, postAuthor, currentPlatform],
  )

  const previewData = React.useMemo(
    () => createPreviewPostData(postData),
    [postData],
  )

  return (
    <div className={cn("w-full", className)}>
      <DraftPost
        post={postData}
        onPlatformChange={(_, p) => setCurrentPlatform(p)}
        onPublish={handlePublish}
        onPreview={handlePreview}
        onEdit={onSendToComposer ? () => onSendToComposer(artifact) : undefined}
        onDelete={onDelete ? () => onDelete(artifact) : undefined}
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
