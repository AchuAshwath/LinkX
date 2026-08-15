import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Loader2 } from "lucide-react"
import * as React from "react"
import { PostsService, TrendingService } from "@/client"
import type { Platform } from "@/components/Common/PlatformSelector"
import type { PostedData } from "@/components/Post/Posted"
import { Posted } from "@/components/Post/Posted"
import {
  PostPreviewDialog,
  type PreviewPostData,
} from "@/components/Post/Previews"
import type { ScheduledPostData } from "@/components/Post/ScheduledPost"
import { ScheduledPost } from "@/components/Post/ScheduledPost"
import { PostInputBox } from "@/components/PostInput/PostInputBox"
import { TrendingTopics } from "@/components/Timeline"
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
import { LoadingButton } from "@/components/ui/loading-button"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { transformToPostedPost, transformToScheduledPost } from "@/utils"

// Union type for timeline posts
type TimelinePost =
  | (PostedData & { type: "posted" })
  | (ScheduledPostData & { type: "scheduled" })

export const Route = createFileRoute("/_layout/home")({
  component: TimelinePage,
  head: () => ({
    meta: [
      {
        title: "Timeline",
      },
    ],
  }),
})

function TimelinePage() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  // Topic draft state for pre-filling composer
  const [draftContent, setDraftContent] = React.useState<string>("")

  // Edit state management
  const [editingPostId, setEditingPostId] = React.useState<string | null>(null)

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [postToDelete, setPostToDelete] = React.useState<{
    id: string
    type: "draft" | "scheduled" | "posted"
  } | null>(null)

  // Preview dialog state
  const [previewDialogOpen, setPreviewDialogOpen] = React.useState(false)
  const [previewPost, setPreviewPost] = React.useState<PreviewPostData | null>(
    null,
  )

  const { showSuccessToast, showErrorToast } = useCustomToast()

  // Fetch scheduled and published posts for timeline
  const { data: scheduledData, isLoading: isLoadingScheduled } = useQuery({
    queryKey: ["posts", "scheduled"],
    queryFn: async () => {
      return await PostsService.readPosts({
        status: "scheduled",
        skip: 0,
        limit: 100,
      })
    },
  })

  const { data: publishedData, isLoading: isLoadingPublished } = useQuery({
    queryKey: ["posts", "published"],
    queryFn: async () => {
      return await PostsService.readPosts({
        status: "published",
        skip: 0,
        limit: 100,
      })
    },
  })

  // Fetch live trending topics from DB
  const { data: trendingData } = useQuery({
    queryKey: ["trending"],
    queryFn: async () => {
      return await TrendingService.getTrending()
    },
  })
  const trendingTopics = trendingData?.data ?? []
  const latestScrapedAt = trendingTopics[0]?.scraped_at ?? null

  // Transform API data to timeline posts
  const posts: TimelinePost[] = React.useMemo(() => {
    const scheduled: TimelinePost[] = (scheduledData?.data || [])
      .filter((p) => p.status === "scheduled" && p.scheduled_at)
      .map((p) => ({
        ...transformToScheduledPost({
          id: p.id,
          author: p.author as {
            name: string
            username: string
            avatarUrl?: string | null
          } | null,
          content: p.content,
          image_url: p.image_url ?? null,
          created_at: p.created_at ?? new Date().toISOString(),
          scheduled_at: p.scheduled_at ?? null,
          platform: p.platform ?? "linkx",
        }),
        type: "scheduled" as const,
      }))

    const posted: TimelinePost[] = (publishedData?.data || [])
      .filter((p) => p.status === "published")
      .map((p) => ({
        ...transformToPostedPost({
          id: p.id,
          author: p.author as {
            name: string
            username: string
            avatarUrl?: string | null
          } | null,
          content: p.content,
          image_url: p.image_url ?? null,
          created_at: p.created_at ?? new Date().toISOString(),
          likes: p.likes ?? 0,
          reposts: p.reposts ?? 0,
          comments: p.comments ?? 0,
          platform: p.platform ?? "linkx",
        }),
        type: "posted" as const,
      }))

    return [...scheduled, ...posted]
  }, [scheduledData, publishedData])

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (postId: string) => {
      await PostsService.deleteExistingPost({ postId })
    },
    onSuccess: () => {
      if (postToDelete) {
        showSuccessToast("Post deleted successfully")
        setDeleteDialogOpen(false)
        setPostToDelete(null)
        // Invalidate and refetch posts
        queryClient.invalidateQueries({ queryKey: ["posts"] })
      }
    },
    onError: (error) => {
      console.error("Failed to delete post", error)
      showErrorToast("Failed to delete post")
    },
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({
      postId,
      data,
    }: {
      postId: string
      data: {
        persona_id?: string
        content?: string
        image_url?: string
        platform?: string
        scheduled_at?: string
        status?: string
      }
    }) => {
      return await PostsService.updateExistingPost({
        postId,
        requestBody: data,
      })
    },
    onSuccess: () => {
      showSuccessToast("Post updated successfully")
      setEditingPostId(null)
      queryClient.invalidateQueries({ queryKey: ["posts"] })
    },
    onError: (error) => {
      console.error("Failed to update post", error)
      showErrorToast("Failed to update post")
    },
  })

  const handleDelete = (
    postId: string,
    type: "draft" | "scheduled" | "posted",
  ) => {
    setPostToDelete({ id: postId, type })
    setDeleteDialogOpen(true)
  }

  const confirmDelete = () => {
    if (postToDelete) {
      deleteMutation.mutate(postToDelete.id)
    }
  }

  const handlePostAction = (action: string, postId: string) => {
    if (action === "delete") {
      handleDelete(postId, "posted")
    } else if (action === "preview") {
      handlePreview(postId)
    } else {
      // Handle post actions (like, repost, comment, share)
      console.log(`${action} post ${postId}`)
    }
  }

  const handleScheduledAction = (action: string, postId: string) => {
    if (action === "edit") {
      setEditingPostId(postId)
    } else if (action === "cancel" || action === "delete") {
      handleDelete(postId, "scheduled")
    } else if (action === "preview") {
      handlePreview(postId)
    } else {
      console.log(`${action} scheduled post ${postId}`)
    }
  }

  const handleSaveScheduled = (
    postId: string,
    data: { content: string; platform: Platform; scheduledAt?: Date | null },
  ) => {
    updateMutation.mutate({
      postId,
      data: {
        content: data.content,
        platform: data.platform,
        scheduled_at: data.scheduledAt
          ? data.scheduledAt.toISOString()
          : undefined,
      },
    })
  }

  const handleCancel = () => {
    setEditingPostId(null)
  }

  const handlePlatformChange = (postId: string, platform: Platform) => {
    updateMutation.mutate({
      postId,
      data: { platform },
    })
  }

  const convertToPreviewData = (post: TimelinePost): PreviewPostData => {
    if (post.type === "posted") {
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
    // scheduled
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
      scheduledAt: post.scheduledAt ?? undefined,
    }
  }

  const handlePreview = (postId: string) => {
    const post = posts.find((p) => p.id === postId)
    if (post) {
      setPreviewPost(convertToPreviewData(post))
      setPreviewDialogOpen(true)
    }
  }

  const handleTopicDraft = (topicTitle: string) => {
    setDraftContent(topicTitle)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const sortedPosts = React.useMemo(() => {
    const toTime = (d: Date | string) =>
      (typeof d === "string" ? new Date(d) : d).getTime()

    // Sort by relevant date: scheduledAt for scheduled posts, createdAt for posted posts
    return [...posts].sort((a, b) => {
      const aTime =
        a.type === "scheduled" && a.scheduledAt
          ? toTime(a.scheduledAt)
          : toTime(a.createdAt)
      const bTime =
        b.type === "scheduled" && b.scheduledAt
          ? toTime(b.scheduledAt)
          : toTime(b.createdAt)
      return bTime - aTime // Descending: newest first
    })
  }, [posts])

  const renderPost = (post: TimelinePost) => {
    const isEditing = editingPostId === post.id

    switch (post.type) {
      case "scheduled":
        return (
          <ScheduledPost
            key={post.id}
            post={post}
            isEditing={isEditing}
            onEdit={(id) => handleScheduledAction("edit", id)}
            onDelete={(id) => handleScheduledAction("delete", id)}
            onSave={handleSaveScheduled}
            onCancel={handleCancel}
            onPlatformChange={handlePlatformChange}
            onPreview={(id) => handleScheduledAction("preview", id)}
          />
        )
      case "posted":
        return (
          <Posted
            key={post.id}
            post={post}
            onLike={(id) => handlePostAction("like", id)}
            onRepost={(id) => handlePostAction("repost", id)}
            onComment={(id) => handlePostAction("comment", id)}
            onShare={(id) => handlePostAction("share", id)}
            onPreview={(id) => handlePostAction("preview", id)}
            onDelete={(id) => handlePostAction("delete", id)}
            onPlatformChange={handlePlatformChange}
          />
        )
    }
  }

  const handlePostCreated = () => {
    // Clear draftContent on successful create
    setDraftContent("")
    // Posts will be refetched automatically via query invalidation
    queryClient.invalidateQueries({ queryKey: ["posts"] })
  }

  return (
    <div className="flex w-full">
      {/* Feed Column - Center */}
      <div className="flex-1 min-w-0 max-w-2xl border-r">
        {/* Sticky top composer */}
        <div className="border-b p-4">
          <PostInputBox
            username={user?.full_name || user?.email || "User"}
            avatarUrl={undefined}
            initialContent={draftContent}
            onSubmit={handlePostCreated}
          />
        </div>

        {/* Feed Posts */}
        {isLoadingScheduled || isLoadingPublished ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">
              Loading timeline...
            </p>
          </div>
        ) : sortedPosts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <p className="text-sm text-muted-foreground">
              No posts in your timeline yet. Create a draft or schedule your
              first post!
            </p>
          </div>
        ) : (
          <div className="w-full pb-20">
            {sortedPosts.map((post) => renderPost(post))}
          </div>
        )}
      </div>

      {/* Right Column - Unified Trending Topics Card */}
      <div className="hidden w-80 md:block">
        <div className="sticky top-0 self-start p-4">
          <TrendingTopics
            topics={trendingTopics}
            lastScrapedAt={latestScrapedAt}
            onTopicDraft={handleTopicDraft}
          />
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Post</DialogTitle>
            <DialogDescription>
              This will remove the post record from your LinkX database.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button variant="outline" disabled={deleteMutation.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <LoadingButton
              variant="destructive"
              onClick={confirmDelete}
              loading={deleteMutation.isPending}
            >
              Delete
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      {previewPost && (
        <PostPreviewDialog
          open={previewDialogOpen}
          onOpenChange={setPreviewDialogOpen}
          post={previewPost}
          platform={
            posts.find((p) => p.id === previewPost.id)?.platform || "linkedin"
          }
        />
      )}
    </div>
  )
}

export default TimelinePage
